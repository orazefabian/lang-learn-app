/**
 * Session queue construction — the backlog rules from the brief, as one pure
 * function so they can be tested without a database.
 *
 * The principle: a long absence must never produce a wall of cards. She sees a
 * capped session, FSRS catches up over the following days, and nothing anywhere
 * in the UI reports the raw size of the backlog.
 */

export type QueueCandidate = {
  id: string;
  /** When the card became due. */
  due: Date;
  /** Interval the scheduler last granted, in days. */
  scheduledDays: number;
  stability: number;
  state: "new" | "learning" | "review" | "relearning";
};

export type QueueSettings = {
  /** Maximum review cards in one session. New material is added on top. */
  reviewCap: number;
  dailyNewLimit: number;
  /** Above this many overdue cards, no new material is introduced. Silently. */
  newMaterialBacklogThreshold: number;
};

export type BuildQueueInput = {
  due: QueueCandidate[];
  /** Cards that exist but have never been shown. */
  newCards: QueueCandidate[];
  settings: QueueSettings;
  /** New items already introduced today, so the daily limit survives restarts. */
  newIntroducedToday?: number;
  now?: Date;
};

export type BuildQueueResult = {
  /** Card ids in the order they should be shown. */
  queue: string[];
  reviewIds: string[];
  newIds: string[];
  /**
   * The number to show her. Capped on purpose: "400 due" is a debt notice,
   * not a study plan.
   */
  displayedDueCount: number;
  /** True when more reviews are waiting than this session shows. */
  hasMoreThanShown: boolean;
  /** Internal only — for the digest and logs, never for her screen. */
  totalDueCount: number;
  newIntroducedThisSession: number;
  /** Why new material was withheld, if it was. */
  newMaterialWithheld: "none" | "backlog" | "daily_limit";
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How late a card is, relative to the interval it was given. A card with a
 * two-day interval that is two days late (ratio 1.0) is more urgent than a
 * card with a year-long interval that is ten days late (ratio 0.03).
 */
export function relativeOverdue(card: QueueCandidate, now: Date): number {
  const lateMs = now.getTime() - card.due.getTime();
  if (lateMs <= 0) return 0;
  const intervalMs = Math.max(card.scheduledDays, 1) * DAY_MS;
  return lateMs / intervalMs;
}

/**
 * Ordering for an oversized backlog: most overdue relative to its own interval
 * first, then the shakiest memories, then the ones waiting longest.
 */
export function prioritizeReviews(cards: QueueCandidate[], now: Date): QueueCandidate[] {
  return [...cards].sort((a, b) => {
    const overdueDelta = relativeOverdue(b, now) - relativeOverdue(a, now);
    if (Math.abs(overdueDelta) > 1e-9) return overdueDelta;

    const stabilityDelta = a.stability - b.stability;
    if (Math.abs(stabilityDelta) > 1e-9) return stabilityDelta;

    return a.due.getTime() - b.due.getTime();
  });
}

export function buildSessionQueue(input: BuildQueueInput): BuildQueueResult {
  const now = input.now ?? new Date();
  const { reviewCap, dailyNewLimit, newMaterialBacklogThreshold } = input.settings;
  const introducedToday = input.newIntroducedToday ?? 0;

  const dueNow = input.due.filter((card) => card.due.getTime() <= now.getTime());
  const totalDueCount = dueNow.length;

  const reviewIds = prioritizeReviews(dueNow, now)
    .slice(0, Math.max(0, reviewCap))
    .map((card) => card.id);

  // Clear the debt before adding to it. She is never told this happened.
  let newMaterialWithheld: BuildQueueResult["newMaterialWithheld"] = "none";
  let newAllowance = 0;

  if (totalDueCount > newMaterialBacklogThreshold) {
    newMaterialWithheld = "backlog";
  } else {
    newAllowance = Math.max(0, dailyNewLimit - introducedToday);
    if (newAllowance === 0) newMaterialWithheld = "daily_limit";
  }

  const newIds = input.newCards.slice(0, newAllowance).map((card) => card.id);

  return {
    queue: [...reviewIds, ...newIds],
    reviewIds,
    newIds,
    displayedDueCount: Math.min(totalDueCount, Math.max(0, reviewCap)),
    hasMoreThanShown: totalDueCount > reviewIds.length,
    totalDueCount,
    newIntroducedThisSession: newIds.length,
    newMaterialWithheld,
  };
}

/**
 * The number the home screen shows. Separate from the queue builder because
 * the home screen must never be able to leak the raw count by accident.
 */
export function displayDueCount(totalDue: number, reviewCap: number): number {
  return Math.min(totalDue, Math.max(0, reviewCap));
}
