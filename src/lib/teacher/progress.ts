import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { cards, studySessions, users } from "@/db/schema";
import { listUnits, type LessonSummary, type UnitSummary } from "@/lib/lessons/service";
import { getProgressSummary, type ProgressSummary } from "@/lib/progress/service";

/**
 * The teacher's live view of the learner: where she is right now, not the
 * weekly retrospective. The app is built for exactly one learner, so "the
 * learner" is simply the one account with that role.
 *
 * None of this changes what she herself sees — the backlog cap and the rest
 * of the no-guilt rules on her own screens are untouched. This is purely an
 * additional read path for the teacher.
 */

export type LearnerProgress = {
  learnerId: string;
  learnerName: string;
  summary: ProgressSummary;
  totalLessons: number;
  units: UnitSummary[];
  /** The lesson she is mid-way through, or the next unstarted one. Null once every lesson is done. */
  currentLesson: LessonSummary | null;
  /** Cards overdue right now — a number her own screens are deliberately capped and never show her. */
  cardsOverdue: number;
  lastActiveAt: string | null;
  daysSinceLastActive: number | null;
  /** A session that was started but never finished or abandoned. */
  hasOpenSession: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function findLearner(db: Db): Promise<{ id: string; displayName: string } | null> {
  const [learner] = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.role, "learner"))
    .orderBy(users.createdAt)
    .limit(1);
  return learner ?? null;
}

function findCurrentLesson(units: UnitSummary[]): LessonSummary | null {
  for (const unit of units) {
    const inProgress = unit.lessons.find((lesson) => lesson.status === "in_progress");
    if (inProgress) return inProgress;
  }
  for (const unit of units) {
    const notStarted = unit.lessons.find((lesson) => lesson.status === "not_started");
    if (notStarted) return notStarted;
  }
  return null;
}

export async function getLearnerProgress(
  db: Db,
  now = new Date(),
): Promise<LearnerProgress | null> {
  const learner = await findLearner(db);
  if (!learner) return null;

  const summary = await getProgressSummary(db, learner.id);
  const units = await listUnits(db, learner.id);

  const lastSessionRows = await db
    .select({ lastActiveAt: studySessions.lastActiveAt })
    .from(studySessions)
    .where(eq(studySessions.userId, learner.id))
    .orderBy(desc(studySessions.lastActiveAt))
    .limit(1);

  const [overdueRow] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(cards)
    .where(and(eq(cards.userId, learner.id), eq(cards.suspended, false), lte(cards.due, now)));

  const openSessionRows = await db
    .select({ id: studySessions.id })
    .from(studySessions)
    .where(and(eq(studySessions.userId, learner.id), eq(studySessions.status, "active")))
    .limit(1);

  const totalLessons = units.reduce((sum, unit) => sum + unit.lessons.length, 0);
  const lastSession = lastSessionRows[0];

  return {
    learnerId: learner.id,
    learnerName: learner.displayName,
    summary,
    totalLessons,
    units,
    currentLesson: findCurrentLesson(units),
    cardsOverdue: overdueRow?.value ?? 0,
    lastActiveAt: lastSession?.lastActiveAt.toISOString() ?? null,
    daysSinceLastActive: lastSession
      ? Math.floor((now.getTime() - lastSession.lastActiveAt.getTime()) / DAY_MS)
      : null,
    hasOpenSession: openSessionRows.length > 0,
  };
}
