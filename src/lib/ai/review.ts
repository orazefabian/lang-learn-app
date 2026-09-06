import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  clozeItems,
  generationItems,
  generationRuns,
  lexemes,
  phrases,
  users,
} from "@/db/schema";
import { normalizeSlovene } from "@/lib/seed/schemas";
import { createCardsForItems } from "@/lib/srs/cards";

/**
 * The approval gate.
 *
 * Generated content is a draft until it passes through here. Approving is the
 * only path from `draft` to `active`, and creating cards happens on that side
 * of the gate and nowhere else.
 */

export type ProposalItem = {
  kind: "phrase" | "lexeme";
  id: string;
  slovene: string;
  german: string;
  contextNote: string | null;
  register: string;
  partOfSpeech: string | null;
  gender: string | null;
  status: "draft" | "active" | "archived";
};

export type Proposal = {
  id: string;
  runId: string;
  kind: "phrase" | "lexeme";
  decision: "pending" | "approved" | "rejected";
  createdAt: Date;
  /** What the model actually proposed, before anyone edited anything. */
  proposed: { slovene: string; german: string; contextNote: string | null };
  /** The draft row, or null when the proposal collided with something existing. */
  draft: ProposalItem | null;
  cloze: {
    id: string;
    answer: string;
    position: number;
    hintDe: string | null;
    focusCase: string | null;
  } | null;
  /** What it collided with, shown next to it so nothing is silently dropped. */
  duplicateOf: ProposalItem | null;
};

export type RunOverview = {
  id: string;
  topic: string;
  kind: string;
  status: "pending" | "succeeded" | "failed";
  error: string | null;
  modelNotes: string | null;
  model: string;
  requestedByName: string | null;
  proposedCount: number;
  draftedCount: number;
  duplicateCount: number;
  pendingCount: number;
  createdAt: Date;
};

/**
 * The proposal as the model wrote it.
 *
 * Used when a proposal collides with something that already exists: the
 * existing entry keeps everything it has, and this is what fills its gaps.
 */
function readPayload(payload: Record<string, unknown>): {
  slovene: string;
  german: string;
  contextNote: string | null;
} {
  const german = payload.german;
  return {
    slovene: typeof payload.slovene === "string" ? payload.slovene : "",
    german: Array.isArray(german)
      ? german.filter((part): part is string => typeof part === "string").join(", ")
      : typeof german === "string"
        ? german
        : "",
    contextNote:
      typeof payload.contextNote === "string"
        ? payload.contextNote
        : typeof payload.notes === "string"
          ? payload.notes
          : null,
  };
}

async function toItems(
  db: Db,
  ids: { phraseIds: string[]; lexemeIds: string[] },
): Promise<Map<string, ProposalItem>> {
  const map = new Map<string, ProposalItem>();

  if (ids.phraseIds.length) {
    const rows = await db.select().from(phrases).where(inArray(phrases.id, ids.phraseIds));
    for (const row of rows) {
      map.set(row.id, {
        kind: "phrase",
        id: row.id,
        slovene: row.slovene,
        german: row.german,
        contextNote: row.contextNote,
        register: row.register,
        partOfSpeech: null,
        gender: null,
        status: row.status,
      });
    }
  }

  if (ids.lexemeIds.length) {
    const rows = await db.select().from(lexemes).where(inArray(lexemes.id, ids.lexemeIds));
    for (const row of rows) {
      map.set(row.id, {
        kind: "lexeme",
        id: row.id,
        slovene: row.slovene,
        german: row.german.join(", "),
        contextNote: row.notes,
        register: row.register,
        partOfSpeech: row.partOfSpeech,
        gender: row.gender,
        status: row.status,
      });
    }
  }

  return map;
}

export async function listProposals(
  db: Db,
  options: { runId?: string; decision?: "pending" | "approved" | "rejected" | "all" } = {},
): Promise<Proposal[]> {
  const decision = options.decision ?? "pending";
  const conditions = [];
  if (options.runId) conditions.push(eq(generationItems.runId, options.runId));
  if (decision !== "all") conditions.push(eq(generationItems.decision, decision));

  const rows = await db
    .select()
    .from(generationItems)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(generationItems.createdAt));

  const phraseIds = rows
    .flatMap((row) => [row.phraseId, row.duplicateOfPhraseId])
    .filter((id): id is string => Boolean(id));
  const lexemeIds = rows
    .flatMap((row) => [row.lexemeId, row.duplicateOfLexemeId])
    .filter((id): id is string => Boolean(id));
  const clozeIds = rows.map((row) => row.clozeItemId).filter((id): id is string => Boolean(id));

  const items = await toItems(db, { phraseIds, lexemeIds });
  const clozeRows = clozeIds.length
    ? await db.select().from(clozeItems).where(inArray(clozeItems.id, clozeIds))
    : [];
  const clozeById = new Map(clozeRows.map((row) => [row.id, row]));

  return rows.map((row): Proposal => {
    const draftId = row.phraseId ?? row.lexemeId;
    const duplicateId = row.duplicateOfPhraseId ?? row.duplicateOfLexemeId;
    const cloze = row.clozeItemId ? clozeById.get(row.clozeItemId) : undefined;

    return {
      id: row.id,
      runId: row.runId,
      kind: row.kind === "lexeme" ? "lexeme" : "phrase",
      decision: row.decision,
      createdAt: row.createdAt,
      proposed: readPayload(row.payload),
      draft: draftId ? (items.get(draftId) ?? null) : null,
      cloze: cloze
        ? {
            id: cloze.id,
            answer: cloze.answer,
            position: cloze.position,
            hintDe: cloze.hintDe,
            focusCase: cloze.focusCase,
          }
        : null,
      duplicateOf: duplicateId ? (items.get(duplicateId) ?? null) : null,
    };
  });
}

export async function listRuns(db: Db, limit = 20): Promise<RunOverview[]> {
  const runs = await db
    .select()
    .from(generationRuns)
    .orderBy(desc(generationRuns.createdAt))
    .limit(limit);
  if (!runs.length) return [];

  const pending = await db
    .select({ runId: generationItems.runId, id: generationItems.id })
    .from(generationItems)
    .where(
      and(
        inArray(
          generationItems.runId,
          runs.map((run) => run.id),
        ),
        eq(generationItems.decision, "pending"),
      ),
    );

  const pendingByRun = new Map<string, number>();
  for (const row of pending) {
    pendingByRun.set(row.runId, (pendingByRun.get(row.runId) ?? 0) + 1);
  }

  const requesterIds = [
    ...new Set(runs.map((run) => run.requestedBy).filter((id): id is string => Boolean(id))),
  ];
  const requesters = requesterIds.length
    ? await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, requesterIds))
    : [];
  const nameById = new Map(requesters.map((row) => [row.id, row.displayName]));

  return runs.map((run) => ({
    id: run.id,
    topic: run.topic,
    kind: run.kind,
    status: run.status,
    error: run.error,
    modelNotes: run.modelNotes,
    model: run.model,
    requestedByName: run.requestedBy ? (nameById.get(run.requestedBy) ?? null) : null,
    proposedCount: run.proposedCount,
    draftedCount: run.draftedCount,
    duplicateCount: run.duplicateCount,
    pendingCount: pendingByRun.get(run.id) ?? 0,
    createdAt: run.createdAt,
  }));
}

export type ProposalEdits = {
  slovene?: string;
  german?: string;
  contextNote?: string | null;
  register?: "standard" | "colloquial" | "regional" | "formal";
};

export type ApprovalResult = {
  kind: "phrase" | "lexeme";
  itemId: string;
  slovene: string;
  /** True when the approval merged into an item that already existed. */
  merged: boolean;
  cardsCreated: number;
  /** Set when the text changed, so the caller knows to regenerate audio. */
  textChanged: boolean;
};

/**
 * Approves one proposal, with the teacher's edits applied first.
 *
 * Editing before approving is the normal case, not the exception: the model
 * proposes, the native speaker corrects, and what she gets is what he signed
 * off on.
 */
export async function approveProposal(
  db: Db,
  input: { proposalId: string; teacherId: string; edits?: ProposalEdits },
): Promise<ApprovalResult> {
  const [row] = await db
    .select()
    .from(generationItems)
    .where(eq(generationItems.id, input.proposalId))
    .limit(1);
  if (!row) throw new Error("proposal not found");

  const merged = !row.phraseId && !row.lexemeId;
  const proposed = readPayload(row.payload);
  const targetPhraseId = row.phraseId ?? row.duplicateOfPhraseId;
  const targetLexemeId = row.lexemeId ?? row.duplicateOfLexemeId;

  let kind: "phrase" | "lexeme";
  let itemId: string;
  let slovene: string;
  let textChanged = false;

  if (targetPhraseId) {
    kind = "phrase";
    itemId = targetPhraseId;

    const [existing] = await db
      .select()
      .from(phrases)
      .where(eq(phrases.id, targetPhraseId))
      .limit(1);
    if (!existing) throw new Error("the drafted phrase is gone");

    /*
     * A merge fills in what is missing and overwrites nothing. The existing
     * entry may be something he wrote down at a family table; a model's version
     * of it does not get to replace that.
     */
    const nextSlovene = merged ? existing.slovene : (input.edits?.slovene?.trim() || existing.slovene);
    const nextGerman = merged
      ? existing.german || input.edits?.german?.trim() || proposed.german
      : (input.edits?.german?.trim() ?? existing.german);
    const nextNote = merged
      ? (existing.contextNote ?? input.edits?.contextNote ?? proposed.contextNote)
      : (input.edits?.contextNote ?? existing.contextNote);

    textChanged = nextSlovene !== existing.slovene;
    slovene = nextSlovene;

    await db
      .update(phrases)
      .set({
        slovene: nextSlovene,
        sloveneNormalized: normalizeSlovene(nextSlovene),
        german: nextGerman,
        contextNote: nextNote,
        ...(merged ? {} : { register: input.edits?.register ?? existing.register }),
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(phrases.id, targetPhraseId));
  } else if (targetLexemeId) {
    kind = "lexeme";
    itemId = targetLexemeId;

    const [existing] = await db
      .select()
      .from(lexemes)
      .where(eq(lexemes.id, targetLexemeId))
      .limit(1);
    if (!existing) throw new Error("the drafted word is gone");

    const nextSlovene = merged ? existing.slovene : (input.edits?.slovene?.trim() || existing.slovene);
    const editedGerman = input.edits?.german
      ?.split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const proposedGerman = proposed.german
      ? proposed.german.split(",").map((part) => part.trim()).filter(Boolean)
      : [];
    const nextGerman = merged
      ? (existing.german.length ? existing.german : (editedGerman ?? proposedGerman))
      : (editedGerman ?? existing.german);
    const nextNotes = merged
      ? (existing.notes ?? input.edits?.contextNote ?? proposed.contextNote)
      : (input.edits?.contextNote ?? existing.notes);

    textChanged = nextSlovene !== existing.slovene;
    slovene = nextSlovene;

    await db
      .update(lexemes)
      .set({
        slovene: nextSlovene,
        sloveneNormalized: normalizeSlovene(nextSlovene),
        german: nextGerman,
        notes: nextNotes,
        ...(merged ? {} : { register: input.edits?.register ?? existing.register }),
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(lexemes.id, targetLexemeId));
  } else {
    throw new Error("the proposal points at nothing");
  }

  // The cloze rides along with its phrase; a blank without its sentence is
  // nothing on its own.
  const clozeIds: string[] = [];
  if (row.clozeItemId) {
    await db
      .update(clozeItems)
      .set({ status: "active" })
      .where(eq(clozeItems.id, row.clozeItemId));
    clozeIds.push(row.clozeItemId);
  }

  await db
    .update(generationItems)
    .set({ decision: "approved", decidedBy: input.teacherId, decidedAt: new Date() })
    .where(eq(generationItems.id, input.proposalId));

  // Only now, on the far side of the gate, does anything become a card.
  let cardsCreated = 0;
  const learners = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "learner"));

  for (const learner of learners) {
    const result = await createCardsForItems(db, learner.id, {
      ...(kind === "phrase" ? { phraseIds: [itemId] } : { lexemeIds: [itemId] }),
      ...(clozeIds.length ? { clozeItemIds: clozeIds } : {}),
    });
    cardsCreated += result.created;
  }

  return { kind, itemId, slovene, merged, cardsCreated, textChanged };
}

/**
 * Rejects a proposal. The draft is archived rather than deleted: the run is an
 * audit trail, and "what did it propose that I threw out" is worth being able
 * to answer.
 */
export async function rejectProposal(
  db: Db,
  input: { proposalId: string; teacherId: string },
): Promise<void> {
  const [row] = await db
    .select()
    .from(generationItems)
    .where(eq(generationItems.id, input.proposalId))
    .limit(1);
  if (!row) throw new Error("proposal not found");

  if (row.phraseId) {
    await db
      .update(phrases)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(phrases.id, row.phraseId));
  }
  if (row.lexemeId) {
    await db
      .update(lexemes)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(lexemes.id, row.lexemeId));
  }
  if (row.clozeItemId) {
    await db
      .update(clozeItems)
      .set({ status: "archived" })
      .where(eq(clozeItems.id, row.clozeItemId));
  }

  await db
    .update(generationItems)
    .set({ decision: "rejected", decidedBy: input.teacherId, decidedAt: new Date() })
    .where(eq(generationItems.id, input.proposalId));
}

export type BatchResult = { approved: number; rejected: number; cardsCreated: number };

/**
 * Batch decisions over one run.
 *
 * Approving a whole batch is offered because reviewing ten good phrases one at
 * a time is friction with no safety in it — but it is still a person pressing
 * the button, per run, after reading them.
 */
export async function decideAll(
  db: Db,
  input: { runId: string; teacherId: string; decision: "approved" | "rejected" },
): Promise<BatchResult> {
  const pending = await db
    .select({ id: generationItems.id })
    .from(generationItems)
    .where(
      and(eq(generationItems.runId, input.runId), eq(generationItems.decision, "pending")),
    );

  const result: BatchResult = { approved: 0, rejected: 0, cardsCreated: 0 };

  for (const row of pending) {
    if (input.decision === "approved") {
      const approval = await approveProposal(db, {
        proposalId: row.id,
        teacherId: input.teacherId,
      });
      result.approved += 1;
      result.cardsCreated += approval.cardsCreated;
    } else {
      await rejectProposal(db, { proposalId: row.id, teacherId: input.teacherId });
      result.rejected += 1;
    }
  }

  return result;
}

/** How many proposals are waiting, for the badge on the teacher's screen. */
export async function countPendingProposals(db: Db): Promise<number> {
  const rows = await db
    .select({ id: generationItems.id })
    .from(generationItems)
    .where(eq(generationItems.decision, "pending"));
  return rows.length;
}
