import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  clozeItems,
  grammarNoteLinks,
  grammarNotes,
  lessonItems,
  lessonProgress,
  lessons,
  lexemes,
  phrases,
  units,
} from "@/db/schema";
import { getAudioForItem, type PlayableAudio } from "@/lib/audio/resolve";
import { createCardsForLesson } from "@/lib/srs/cards";

/**
 * Lessons introduce; the scheduler reviews. Completing a lesson is the moment
 * its items become cards and are handed to FSRS.
 *
 * Lessons are ordered but never gated. She can open any of them; skipping just
 * earns a quiet warning, not a locked door.
 */

export type LessonStatus = "not_started" | "in_progress" | "completed";

export type LessonSummary = {
  id: string;
  slug: string;
  titleDe: string;
  goalDe: string | null;
  position: number;
  estimatedMinutes: number;
  itemCount: number;
  status: LessonStatus;
  /** True when the lesson introduces the dual — worth marking. */
  teachesDual: boolean;
};

export type UnitSummary = {
  id: string;
  slug: string;
  titleDe: string;
  descriptionDe: string | null;
  position: number;
  lessons: LessonSummary[];
  completedCount: number;
};

export async function listUnits(db: Db, userId: string): Promise<UnitSummary[]> {
  const unitRows = await db.select().from(units).orderBy(asc(units.position));

  const lessonRows = await db
    .select()
    .from(lessons)
    .where(eq(lessons.status, "active"))
    .orderBy(asc(lessons.position));

  const progressRows = await db
    .select()
    .from(lessonProgress)
    .where(eq(lessonProgress.userId, userId));
  const progressByLesson = new Map(progressRows.map((row) => [row.lessonId, row]));

  const lessonIds = lessonRows.map((row) => row.id);
  const itemRows = lessonIds.length
    ? await db
        .select({
          lessonId: lessonItems.lessonId,
          phraseId: lessonItems.phraseId,
          lexemeId: lessonItems.lexemeId,
        })
        .from(lessonItems)
        .where(inArray(lessonItems.lessonId, lessonIds))
    : [];

  const counts = new Map<string, number>();
  for (const item of itemRows) {
    counts.set(item.lessonId, (counts.get(item.lessonId) ?? 0) + 1);
  }

  // A lesson "teaches the dual" when it links the grammar note that explains it.
  const dualLessonIds = new Set(
    (
      await db
        .select({ lessonId: grammarNoteLinks.lessonId })
        .from(grammarNoteLinks)
        .innerJoin(grammarNotes, eq(grammarNotes.id, grammarNoteLinks.noteId))
        .where(
          and(
            isNotNull(grammarNoteLinks.lessonId),
            or(
              eq(grammarNotes.slug, "dvojina-grundlagen"),
              eq(grammarNotes.slug, "dual-erste-begegnung"),
            ),
          ),
        )
    )
      .map((row) => row.lessonId)
      .filter((id): id is string => Boolean(id)),
  );

  return unitRows.map((unit) => {
    const own = lessonRows
      .filter((lesson) => lesson.unitId === unit.id)
      .map((lesson): LessonSummary => {
        const progress = progressByLesson.get(lesson.id);
        return {
          id: lesson.id,
          slug: lesson.slug,
          titleDe: lesson.titleDe,
          goalDe: lesson.goalDe,
          position: lesson.position,
          estimatedMinutes: lesson.estimatedMinutes,
          itemCount: counts.get(lesson.id) ?? 0,
          status: progress?.completedAt
            ? "completed"
            : progress
              ? "in_progress"
              : "not_started",
          teachesDual: dualLessonIds.has(lesson.id),
        };
      });

    return {
      id: unit.id,
      slug: unit.slug,
      titleDe: unit.titleDe,
      descriptionDe: unit.descriptionDe,
      position: unit.position,
      lessons: own,
      completedCount: own.filter((lesson) => lesson.status === "completed").length,
    };
  });
}

export type LessonItemView = {
  id: string;
  kind: "phrase" | "lexeme";
  slovene: string;
  german: string;
  contextNote: string | null;
  teachingNoteDe: string | null;
  notes: string | null;
  register: string;
  regionLabel: string | null;
  partOfSpeech: string | null;
  gender: string | null;
  audio: PlayableAudio[];
  /** Cloze practice attached to this phrase, if any. */
  practice: { position: number; answer: string; hintDe: string | null } | null;
};

export type LessonView = {
  id: string;
  slug: string;
  titleDe: string;
  goalDe: string | null;
  introDe: string | null;
  estimatedMinutes: number;
  unit: { slug: string; titleDe: string } | null;
  items: LessonItemView[];
  grammarNotes: { slug: string; titleDe: string; bodyDe: string }[];
  status: LessonStatus;
  cursor: number;
  /** Earlier lessons she has not finished. Empty when she is in sequence. */
  skippedLessons: { slug: string; titleDe: string }[];
};

export async function getLesson(
  db: Db,
  userId: string,
  slug: string,
): Promise<LessonView | null> {
  const [lesson] = await db.select().from(lessons).where(eq(lessons.slug, slug)).limit(1);
  if (!lesson) return null;

  const [unit] = lesson.unitId
    ? await db.select().from(units).where(eq(units.id, lesson.unitId)).limit(1)
    : [];

  const itemRows = await db
    .select()
    .from(lessonItems)
    .where(eq(lessonItems.lessonId, lesson.id))
    .orderBy(asc(lessonItems.position));

  const phraseIds = itemRows.map((row) => row.phraseId).filter((id): id is string => Boolean(id));
  const lexemeIds = itemRows.map((row) => row.lexemeId).filter((id): id is string => Boolean(id));

  const phraseRows = phraseIds.length
    ? await db.select().from(phrases).where(inArray(phrases.id, phraseIds))
    : [];
  const lexemeRows = lexemeIds.length
    ? await db.select().from(lexemes).where(inArray(lexemes.id, lexemeIds))
    : [];
  const clozeRows = phraseIds.length
    ? await db.select().from(clozeItems).where(inArray(clozeItems.phraseId, phraseIds))
    : [];

  const phraseById = new Map(phraseRows.map((row) => [row.id, row]));
  const lexemeById = new Map(lexemeRows.map((row) => [row.id, row]));
  const clozeByPhrase = new Map(clozeRows.map((row) => [row.phraseId, row]));

  const items: LessonItemView[] = [];
  for (const row of itemRows) {
    if (row.phraseId) {
      const phrase = phraseById.get(row.phraseId);
      if (!phrase) continue;
      const cloze = clozeByPhrase.get(phrase.id);
      items.push({
        id: row.id,
        kind: "phrase",
        slovene: phrase.slovene,
        german: phrase.german,
        contextNote: phrase.contextNote,
        teachingNoteDe: row.teachingNoteDe,
        notes: phrase.notes,
        register: phrase.register,
        regionLabel: phrase.regionLabel,
        partOfSpeech: null,
        gender: null,
        audio: await getAudioForItem(db, { phraseId: phrase.id }),
        practice: cloze
          ? { position: cloze.position, answer: cloze.answer, hintDe: cloze.hintDe }
          : null,
      });
      continue;
    }

    if (row.lexemeId) {
      const lexeme = lexemeById.get(row.lexemeId);
      if (!lexeme) continue;
      items.push({
        id: row.id,
        kind: "lexeme",
        slovene: lexeme.slovene,
        german: lexeme.german.join(", "),
        contextNote: null,
        teachingNoteDe: row.teachingNoteDe,
        notes: lexeme.notes,
        register: lexeme.register,
        regionLabel: lexeme.regionLabel,
        partOfSpeech: lexeme.partOfSpeech,
        gender: lexeme.gender,
        audio: await getAudioForItem(db, { lexemeId: lexeme.id }),
        practice: null,
      });
    }
  }

  const noteRows = await db
    .select({
      slug: grammarNotes.slug,
      titleDe: grammarNotes.titleDe,
      bodyDe: grammarNotes.bodyDe,
    })
    .from(grammarNoteLinks)
    .innerJoin(grammarNotes, eq(grammarNotes.id, grammarNoteLinks.noteId))
    .where(eq(grammarNoteLinks.lessonId, lesson.id));

  const [progress] = await db
    .select()
    .from(lessonProgress)
    .where(and(eq(lessonProgress.userId, userId), eq(lessonProgress.lessonId, lesson.id)))
    .limit(1);

  return {
    id: lesson.id,
    slug: lesson.slug,
    titleDe: lesson.titleDe,
    goalDe: lesson.goalDe,
    introDe: lesson.introDe,
    estimatedMinutes: lesson.estimatedMinutes,
    unit: unit ? { slug: unit.slug, titleDe: unit.titleDe } : null,
    items,
    grammarNotes: noteRows,
    status: progress?.completedAt ? "completed" : progress ? "in_progress" : "not_started",
    cursor: progress?.cursor ?? 0,
    skippedLessons: await findSkippedLessons(db, userId, lesson.id),
  };
}

/**
 * Lessons she has not finished that come before this one. Used for a warning,
 * never for a lock — the brief is explicit that nothing is hard-gated.
 *
 * "Before" means the course order, which is (unit position, lesson position).
 * Lesson positions restart within each unit, so comparing them on their own
 * would call the third lesson of unit two a skip past every lesson numbered
 * one or two in the whole course.
 */
async function findSkippedLessons(
  db: Db,
  userId: string,
  lessonId: string,
): Promise<{ slug: string; titleDe: string }[]> {
  const ordered = await db
    .select({
      id: lessons.id,
      slug: lessons.slug,
      titleDe: lessons.titleDe,
    })
    .from(lessons)
    .leftJoin(units, eq(units.id, lessons.unitId))
    .where(eq(lessons.status, "active"))
    .orderBy(asc(units.position), asc(lessons.position));

  const index = ordered.findIndex((lesson) => lesson.id === lessonId);
  const earlier = index <= 0 ? [] : ordered.slice(0, index);

  if (!earlier.length) return [];

  const completed = new Set(
    (
      await db
        .select({ lessonId: lessonProgress.lessonId })
        .from(lessonProgress)
        .where(
          and(
            eq(lessonProgress.userId, userId),
            isNotNull(lessonProgress.completedAt),
            inArray(
              lessonProgress.lessonId,
              earlier.map((row) => row.id),
            ),
          ),
        )
    ).map((row) => row.lessonId),
  );

  return earlier
    .filter((lesson) => !completed.has(lesson.id))
    .map(({ slug, titleDe }) => ({ slug, titleDe }));
}

export async function startLesson(db: Db, userId: string, lessonId: string): Promise<void> {
  await db
    .insert(lessonProgress)
    .values({ userId, lessonId, cursor: 0 })
    .onConflictDoNothing();
}

export async function setLessonCursor(
  db: Db,
  userId: string,
  lessonId: string,
  cursor: number,
): Promise<void> {
  await db
    .insert(lessonProgress)
    .values({ userId, lessonId, cursor })
    .onConflictDoUpdate({
      target: [lessonProgress.userId, lessonProgress.lessonId],
      set: { cursor },
    });
}

/**
 * Finishing a lesson is what hands its items to FSRS. Running it twice is
 * harmless: the unique indexes on cards make the second pass a no-op.
 */
export async function completeLesson(
  db: Db,
  userId: string,
  lessonId: string,
  now = new Date(),
): Promise<{ cardsCreated: number }> {
  await db
    .insert(lessonProgress)
    .values({ userId, lessonId, cursor: 0, completedAt: now })
    .onConflictDoUpdate({
      target: [lessonProgress.userId, lessonProgress.lessonId],
      set: { completedAt: now },
    });

  const result = await createCardsForLesson(db, userId, lessonId);
  return { cardsCreated: result.created };
}

/** The lesson the home screen offers next: the first one not yet finished. */
export async function getNextLesson(db: Db, userId: string): Promise<LessonSummary | null> {
  const unitList = await listUnits(db, userId);
  for (const unit of unitList) {
    for (const lesson of unit.lessons) {
      if (lesson.status !== "completed") return lesson;
    }
  }
  return null;
}
