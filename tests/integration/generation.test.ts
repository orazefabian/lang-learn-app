import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./helpers/database";

/**
 * AI generation and the approval gate.
 *
 * The rule the whole feature exists to protect is one line long: generated
 * content never reaches her deck until the teacher approves it. Several of the
 * tests below do nothing but check that, from different directions, because it
 * is the rule that would be expensive to discover broken.
 */
let database: TestDatabase;
let db: typeof import("@/db/client").db;
let schema: typeof import("@/db/schema");
let generate: typeof import("@/lib/ai/generate");
let review: typeof import("@/lib/ai/review");
let assist: typeof import("@/lib/ai/assist");
let drizzle: typeof import("drizzle-orm");

let learnerId: string;
let teacherId: string;

/** A stub in place of the Anthropic API: no key, no network, same code path. */
function stubClient(payload: unknown, options: { model?: string } = {}) {
  const calls: unknown[] = [];
  return {
    client: {
      model: options.model ?? "claude-test",
      async callTool(request: unknown) {
        calls.push(request);
        return { data: payload, model: options.model ?? "claude-test", inputTokens: 120, outputTokens: 340 };
      },
    },
    calls,
  };
}

const GOOD_BATCH = {
  lexemes: [{ slovene: "kruh", german: ["Brot"], partOfSpeech: "noun", gender: "m" }],
  phrases: [
    {
      slovene: "Rada bi kavo, prosim.",
      german: "Ich hätte gern einen Kaffee, bitte.",
      contextNote: "Im Café, wenn du bestellst.",
      cloze: { blank: "kavo", focusCase: "accusative", hintDe: "was? → Akkusativ" },
    },
  ],
  notes: "kavo ist Akkusativ von kava.",
};

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.url;
  process.env.SESSION_SECRET = "integration-test-secret-that-is-long-enough";
  process.env.MEDIA_ROOT = await mkdtemp(path.join(tmpdir(), "slo-generation-"));

  db = (await import("@/db/client")).db;
  schema = await import("@/db/schema");
  generate = await import("@/lib/ai/generate");
  review = await import("@/lib/ai/review");
  assist = await import("@/lib/ai/assist");
  drizzle = await import("drizzle-orm");

  const users = await db
    .insert(schema.users)
    .values([
      { email: "lernende@test.local", displayName: "Lernende", role: "learner" },
      { email: "lehrer@test.local", displayName: "Fabian", role: "teacher" },
    ])
    .returning({ id: schema.users.id, role: schema.users.role });
  learnerId = users.find((u) => u.role === "learner")!.id;
  teacherId = users.find((u) => u.role === "teacher")!.id;
  await db.insert(schema.userSettings).values({ userId: learnerId });
});

afterAll(async () => {
  await database?.stop();
});

async function cardCount(): Promise<number> {
  const rows = await db
    .select({ id: schema.cards.id })
    .from(schema.cards)
    .where(drizzle.eq(schema.cards.userId, learnerId));
  return rows.length;
}

describe("generating", () => {
  let runId: string;

  it("writes everything as a draft, from the AI, attributed to the teacher", async () => {
    const summary = await generate.generateDrafts(db, {
      requestedBy: teacherId,
      input: { topic: "im Café bestellen", kind: "mixed", count: 4 },
      client: stubClient(GOOD_BATCH).client,
    });
    runId = summary.runId;

    expect(summary.drafted).toBe(2);
    expect(summary.duplicates).toBe(0);
    expect(summary.modelNotes).toContain("Akkusativ");

    const [phrase] = await db
      .select()
      .from(schema.phrases)
      .where(drizzle.eq(schema.phrases.slovene, "Rada bi kavo, prosim."));
    expect(phrase?.status).toBe("draft");
    expect(phrase?.source).toBe("ai");
    expect(phrase?.createdBy).toBe(teacherId);

    const [lexeme] = await db
      .select()
      .from(schema.lexemes)
      .where(drizzle.eq(schema.lexemes.slovene, "kruh"));
    expect(lexeme?.status).toBe("draft");
    expect(lexeme?.gender).toBe("m");
  });

  /** The one that matters. */
  it("gives her nothing to study", async () => {
    expect(await cardCount()).toBe(0);
  });

  it("keeps the model's usage and its own words on the run", async () => {
    const [run] = await db
      .select()
      .from(schema.generationRuns)
      .where(drizzle.eq(schema.generationRuns.id, runId));

    expect(run?.status).toBe("succeeded");
    expect(run?.model).toBe("claude-test");
    expect(run?.outputTokens).toBe(340);
    expect(run?.topic).toBe("im Café bestellen");
  });

  it("stores what the model proposed next to what it became", async () => {
    const proposals = await review.listProposals(db, { runId });
    const phraseProposal = proposals.find((p) => p.kind === "phrase");

    expect(proposals).toHaveLength(2);
    expect(phraseProposal?.draft?.slovene).toBe("Rada bi kavo, prosim.");
    expect(phraseProposal?.decision).toBe("pending");
  });

  it("turns the cloze into a blank at the right position, still a draft", async () => {
    const proposals = await review.listProposals(db, { runId });
    const withCloze = proposals.find((p) => p.cloze);

    expect(withCloze?.cloze?.answer).toBe("kavo");
    expect(withCloze?.cloze?.position).toBe(2);

    const [cloze] = await db
      .select()
      .from(schema.clozeItems)
      .where(drizzle.eq(schema.clozeItems.id, withCloze!.cloze!.id));
    expect(cloze?.status).toBe("draft");
    expect(cloze?.focusCase).toBe("accusative");
  });
});

describe("what the model gets wrong", () => {
  it("keeps the phrase but drops a blank that is not in the sentence", async () => {
    const summary = await generate.generateDrafts(db, {
      requestedBy: teacherId,
      input: { topic: "Getränke", kind: "phrases", count: 1 },
      client: stubClient({
        phrases: [
          {
            slovene: "Hvala lepa.",
            german: "Vielen Dank.",
            cloze: { blank: "prosim", focusCase: "accusative" },
          },
        ],
      }).client,
    });

    expect(summary.drafted).toBe(1);
    expect(summary.warnings.join(" ")).toContain("Hvala lepa.");

    const proposals = await review.listProposals(db, { runId: summary.runId });
    expect(proposals[0]?.draft?.slovene).toBe("Hvala lepa.");
    expect(proposals[0]?.cloze).toBeNull();
  });

  it("fails the whole run rather than inserting something off-schema", async () => {
    const before = await db.select({ id: schema.phrases.id }).from(schema.phrases);

    await expect(
      generate.generateDrafts(db, {
        requestedBy: teacherId,
        input: { topic: "kaputt", kind: "mixed", count: 2 },
        client: stubClient({ phrases: [{ slovene: "Dober dan." }] }).client,
      }),
    ).rejects.toThrow(/did not match the schema/);

    const after = await db.select({ id: schema.phrases.id }).from(schema.phrases);
    expect(after).toHaveLength(before.length);

    const [run] = await db
      .select()
      .from(schema.generationRuns)
      .where(drizzle.eq(schema.generationRuns.topic, "kaputt"));
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("german");
  });

  it("records the reason when the API itself is unreachable", async () => {
    await expect(
      generate.generateDrafts(db, {
        requestedBy: teacherId,
        input: { topic: "offline", kind: "mixed", count: 2 },
        client: {
          model: "claude-test",
          callTool: async () => {
            throw new Error("connection refused");
          },
        },
      }),
    ).rejects.toThrow(/connection refused/);

    const [run] = await db
      .select()
      .from(schema.generationRuns)
      .where(drizzle.eq(schema.generationRuns.topic, "offline"));
    expect(run?.status).toBe("failed");
  });
});

describe("duplicates", () => {
  it("warns instead of adding a second copy, and keeps the proposal visible", async () => {
    const summary = await generate.generateDrafts(db, {
      requestedBy: teacherId,
      input: { topic: "nochmal Kaffee", kind: "phrases", count: 2 },
      client: stubClient({
        phrases: [
          {
            slovene: "Rada bi kavo, prosim.",
            german: "Ich möchte bitte einen Kaffee.",
            contextNote: "Beim Bestellen.",
          },
        ],
      }).client,
    });

    expect(summary.duplicates).toBe(1);
    expect(summary.drafted).toBe(0);

    const copies = await db
      .select({ id: schema.phrases.id })
      .from(schema.phrases)
      .where(drizzle.eq(schema.phrases.slovene, "Rada bi kavo, prosim."));
    expect(copies).toHaveLength(1);

    const proposals = await review.listProposals(db, { runId: summary.runId });
    expect(proposals[0]?.draft).toBeNull();
    expect(proposals[0]?.duplicateOf?.slovene).toBe("Rada bi kavo, prosim.");
  });

  it("catches a batch that repeats itself", async () => {
    const summary = await generate.generateDrafts(db, {
      requestedBy: teacherId,
      input: { topic: "doppelt", kind: "lexemes", count: 2 },
      client: stubClient({
        lexemes: [
          { slovene: "voda", german: ["Wasser"], partOfSpeech: "noun", gender: "f" },
          { slovene: "Voda", german: ["Wasser"], partOfSpeech: "noun", gender: "f" },
        ],
      }).client,
    });

    expect(summary.drafted).toBe(1);
    expect(summary.warnings.join(" ")).toContain("Voda");
  });
});

describe("approving", () => {
  it("still has given her nothing before anyone approves", async () => {
    expect(await cardCount()).toBe(0);
  });

  it("applies the teacher's corrections and only then makes cards", async () => {
    const proposals = await review.listProposals(db, {});
    const target = proposals.find((p) => p.draft?.slovene === "Rada bi kavo, prosim.")!;

    const result = await review.approveProposal(db, {
      proposalId: target.id,
      teacherId,
      edits: {
        slovene: "Rad bi kavo, prosim.",
        german: "Ich hätte gern einen Kaffee, bitte.",
        contextNote: "Im Café, wenn du bestellst.",
      },
    });

    expect(result.cardsCreated).toBeGreaterThan(0);
    expect(result.textChanged).toBe(true);

    const [phrase] = await db
      .select()
      .from(schema.phrases)
      .where(drizzle.eq(schema.phrases.id, result.itemId));
    expect(phrase?.status).toBe("active");
    // The correction is what she gets, not the model's version of it.
    expect(phrase?.slovene).toBe("Rad bi kavo, prosim.");
    expect(phrase?.sloveneNormalized).toBe("rad bi kavo, prosim.");
  });

  it("takes the cloze along with its phrase", async () => {
    const [cloze] = await db
      .select()
      .from(schema.clozeItems)
      .where(drizzle.eq(schema.clozeItems.answer, "kavo"));
    expect(cloze?.status).toBe("active");

    const clozeCards = await db
      .select({ id: schema.cards.id })
      .from(schema.cards)
      .where(drizzle.eq(schema.cards.clozeItemId, cloze!.id));
    expect(clozeCards.length).toBeGreaterThan(0);
  });

  it("fills in the gaps on a duplicate instead of overwriting the original", async () => {
    const [original] = await db
      .insert(schema.phrases)
      .values({
        slovene: "Lahko noč.",
        sloveneNormalized: "lahko noc.",
        german: "",
        status: "active",
        source: "teacher",
      })
      .returning({ id: schema.phrases.id });

    const summary = await generate.generateDrafts(db, {
      requestedBy: teacherId,
      input: { topic: "Abschied", kind: "phrases", count: 1 },
      client: stubClient({
        phrases: [
          {
            slovene: "Lahko noč.",
            german: "Gute Nacht.",
            contextNote: "Abends, bevor jemand schlafen geht.",
          },
        ],
      }).client,
    });

    const proposals = await review.listProposals(db, { runId: summary.runId });
    const approval = await review.approveProposal(db, {
      proposalId: proposals[0]!.id,
      teacherId,
    });
    expect(approval.merged).toBe(true);

    const [merged] = await db
      .select()
      .from(schema.phrases)
      .where(drizzle.eq(schema.phrases.id, original!.id));
    expect(merged?.german).toBe("Gute Nacht.");
    expect(merged?.contextNote).toContain("Abends");
    expect(merged?.source).toBe("teacher");
  });
});

describe("rejecting", () => {
  it("archives the draft and leaves her deck alone", async () => {
    const summary = await generate.generateDrafts(db, {
      requestedBy: teacherId,
      input: { topic: "daneben", kind: "lexemes", count: 1 },
      client: stubClient({
        lexemes: [{ slovene: "bogataš", german: ["Reicher"], partOfSpeech: "noun" }],
      }).client,
    });

    const before = await cardCount();
    const proposals = await review.listProposals(db, { runId: summary.runId });
    await review.rejectProposal(db, { proposalId: proposals[0]!.id, teacherId });

    const [lexeme] = await db
      .select()
      .from(schema.lexemes)
      .where(drizzle.eq(schema.lexemes.slovene, "bogataš"));
    expect(lexeme?.status).toBe("archived");
    expect(await cardCount()).toBe(before);

    // The proposal survives as a record of what was thrown out.
    const decided = await review.listProposals(db, {
      runId: summary.runId,
      decision: "rejected",
    });
    expect(decided).toHaveLength(1);
    expect(decided[0]?.decision).toBe("rejected");
  });
});

describe("deciding a whole batch", () => {
  it("approves everything still pending in one run and nothing outside it", async () => {
    const summary = await generate.generateDrafts(db, {
      requestedBy: teacherId,
      input: { topic: "Familie", kind: "lexemes", count: 3 },
      client: stubClient({
        lexemes: [
          { slovene: "babica", german: ["Oma"], partOfSpeech: "noun", gender: "f" },
          { slovene: "dedek", german: ["Opa"], partOfSpeech: "noun", gender: "m" },
        ],
      }).client,
    });

    const otherPendingBefore = (await review.listProposals(db, {})).filter(
      (p) => p.runId !== summary.runId,
    ).length;

    const result = await review.decideAll(db, {
      runId: summary.runId,
      teacherId,
      decision: "approved",
    });
    expect(result.approved).toBe(2);
    expect(result.cardsCreated).toBeGreaterThan(0);

    const stillPending = await review.listProposals(db, {});
    expect(stillPending.filter((p) => p.runId === summary.runId)).toHaveLength(0);
    expect(stillPending).toHaveLength(otherPendingBefore);

    const [babica] = await db
      .select()
      .from(schema.lexemes)
      .where(drizzle.eq(schema.lexemes.slovene, "babica"));
    expect(babica?.status).toBe("active");
  });

  it("counts what is left for the badge", async () => {
    const pending = await review.countPendingProposals(db);
    const listed = await review.listProposals(db, {});
    expect(pending).toBe(listed.length);
  });
});

describe("the run list", () => {
  it("shows each batch with what is still waiting in it", async () => {
    const runs = await review.listRuns(db, 20);
    expect(runs.length).toBeGreaterThan(3);
    expect(runs[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(
      runs[runs.length - 1]!.createdAt.getTime(),
    );
    expect(runs.some((run) => run.status === "failed")).toBe(true);
    expect(runs.every((run) => run.requestedByName === "Fabian")).toBe(true);
  });
});

describe("quick-capture assist", () => {
  it("returns suggestions and writes nothing", async () => {
    const before = await db.select({ id: schema.phrases.id }).from(schema.phrases);

    const suggestion = await assist.suggestEntry("Dober tek!", {
      client: stubClient({
        german: ["Guten Appetit"],
        kind: "phrase",
        partOfSpeech: "phrase",
        register: "standard",
        contextNote: "Bevor alle anfangen zu essen.",
      }).client,
    });

    expect(suggestion.german).toEqual(["Guten Appetit"]);
    expect(suggestion.contextNote).toContain("essen");

    const after = await db.select({ id: schema.phrases.id }).from(schema.phrases);
    expect(after).toHaveLength(before.length);
  });

  it("refuses a suggestion that does not fit the schema", async () => {
    await expect(
      assist.suggestEntry("Dober tek!", {
        client: stubClient({ german: "Guten Appetit" }).client,
      }),
    ).rejects.toThrow();
  });
});
