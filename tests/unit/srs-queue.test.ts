import { describe, expect, it } from "vitest";
import {
  buildSessionQueue,
  displayDueCount,
  prioritizeReviews,
  relativeOverdue,
  type QueueCandidate,
  type QueueSettings,
} from "@/lib/srs/queue";

const NOW = new Date("2026-03-01T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const SETTINGS: QueueSettings = {
  reviewCap: 20,
  dailyNewLimit: 8,
  newMaterialBacklogThreshold: 60,
};

function card(partial: Partial<QueueCandidate> & { id: string }): QueueCandidate {
  return {
    due: new Date(NOW.getTime() - DAY),
    scheduledDays: 10,
    stability: 10,
    state: "review",
    ...partial,
  };
}

function backlog(count: number, daysLate = 30): QueueCandidate[] {
  return Array.from({ length: count }, (_, i) =>
    card({
      id: `card-${i}`,
      due: new Date(NOW.getTime() - daysLate * DAY),
      stability: 5 + i,
      scheduledDays: 10,
    }),
  );
}

describe("backlog capping", () => {
  it("never queues more reviews than the cap, however deep the backlog", () => {
    const result = buildSessionQueue({ due: backlog(400), newCards: [], settings: SETTINGS });
    expect(result.reviewIds).toHaveLength(20);
    expect(result.queue).toHaveLength(20);
  });

  /** The rule the whole design rests on: she is never shown "400 due". */
  it("reports a capped count to the UI, never the raw backlog", () => {
    const result = buildSessionQueue({ due: backlog(400), newCards: [], settings: SETTINGS });
    expect(result.displayedDueCount).toBe(20);
    expect(result.displayedDueCount).toBeLessThanOrEqual(SETTINGS.reviewCap);
    expect(result.hasMoreThanShown).toBe(true);
    // The true number stays available for the digest, which is not her screen.
    expect(result.totalDueCount).toBe(400);
  });

  it("shows the real number when it is below the cap", () => {
    const result = buildSessionQueue({ due: backlog(7), newCards: [], settings: SETTINGS });
    expect(result.displayedDueCount).toBe(7);
    expect(result.hasMoreThanShown).toBe(false);
  });

  it("caps the home-screen count independently of the queue builder", () => {
    expect(displayDueCount(400, 20)).toBe(20);
    expect(displayDueCount(3, 20)).toBe(3);
    expect(displayDueCount(0, 20)).toBe(0);
  });

  it("ignores cards that are not due yet", () => {
    const result = buildSessionQueue({
      due: [
        card({ id: "due", due: new Date(NOW.getTime() - DAY) }),
        card({ id: "future", due: new Date(NOW.getTime() + 5 * DAY) }),
      ],
      newCards: [],
      settings: SETTINGS,
      now: NOW,
    });
    expect(result.queue).toEqual(["due"]);
    expect(result.totalDueCount).toBe(1);
  });

  it("handles an empty deck without producing anything odd", () => {
    const result = buildSessionQueue({ due: [], newCards: [], settings: SETTINGS });
    expect(result.queue).toEqual([]);
    expect(result.displayedDueCount).toBe(0);
    expect(result.hasMoreThanShown).toBe(false);
  });
});

describe("prioritisation", () => {
  it("measures lateness against the card's own interval", () => {
    const shortInterval = card({ id: "a", scheduledDays: 2, due: new Date(NOW.getTime() - 2 * DAY) });
    const longInterval = card({ id: "b", scheduledDays: 365, due: new Date(NOW.getTime() - 10 * DAY) });
    expect(relativeOverdue(shortInterval, NOW)).toBeGreaterThan(relativeOverdue(longInterval, NOW));
  });

  it("puts the most relatively overdue card first", () => {
    const cards = [
      card({ id: "barely", scheduledDays: 365, due: new Date(NOW.getTime() - 10 * DAY) }),
      card({ id: "very", scheduledDays: 2, due: new Date(NOW.getTime() - 20 * DAY) }),
      card({ id: "middle", scheduledDays: 30, due: new Date(NOW.getTime() - 30 * DAY) }),
    ];
    expect(prioritizeReviews(cards, NOW).map((c) => c.id)).toEqual(["very", "middle", "barely"]);
  });

  it("breaks ties by lowest stability — the shakiest memory first", () => {
    const cards = [
      card({ id: "solid", stability: 50, due: new Date(NOW.getTime() - 10 * DAY), scheduledDays: 10 }),
      card({ id: "shaky", stability: 2, due: new Date(NOW.getTime() - 10 * DAY), scheduledDays: 10 }),
    ];
    expect(prioritizeReviews(cards, NOW).map((c) => c.id)).toEqual(["shaky", "solid"]);
  });

  it("breaks remaining ties by the oldest due date", () => {
    const cards = [
      card({ id: "newer", stability: 10, due: new Date(NOW.getTime() - 10 * DAY), scheduledDays: 10 }),
      card({ id: "older", stability: 10, due: new Date(NOW.getTime() - 10 * DAY - 1000), scheduledDays: 10 }),
    ];
    expect(prioritizeReviews(cards, NOW)[0]?.id).toBe("older");
  });

  it("does not mutate the input array", () => {
    const cards = backlog(5);
    const before = cards.map((c) => c.id);
    prioritizeReviews(cards, NOW);
    expect(cards.map((c) => c.id)).toEqual(before);
  });
});

describe("new material", () => {
  const newCards = Array.from({ length: 20 }, (_, i) =>
    card({ id: `new-${i}`, state: "new", stability: 0, scheduledDays: 0 }),
  );

  it("adds new items on top of the review cap", () => {
    const result = buildSessionQueue({ due: backlog(20), newCards, settings: SETTINGS });
    expect(result.reviewIds).toHaveLength(20);
    expect(result.newIds).toHaveLength(8);
    expect(result.queue).toHaveLength(28);
  });

  it("respects the daily new limit across sessions", () => {
    const result = buildSessionQueue({
      due: [],
      newCards,
      settings: SETTINGS,
      newIntroducedToday: 6,
    });
    expect(result.newIds).toHaveLength(2);
  });

  it("introduces nothing once the daily limit is used up", () => {
    const result = buildSessionQueue({
      due: [],
      newCards,
      settings: SETTINGS,
      newIntroducedToday: 8,
    });
    expect(result.newIds).toEqual([]);
    expect(result.newMaterialWithheld).toBe("daily_limit");
  });

  /** Clear the debt first, silently — she is never told this happened. */
  it("withholds new material while the backlog is over the threshold", () => {
    const result = buildSessionQueue({ due: backlog(61), newCards, settings: SETTINGS });
    expect(result.newIds).toEqual([]);
    expect(result.newMaterialWithheld).toBe("backlog");
    expect(result.queue).toHaveLength(20);
  });

  it("resumes new material as soon as the backlog is back under control", () => {
    const result = buildSessionQueue({ due: backlog(60), newCards, settings: SETTINGS });
    expect(result.newIds).toHaveLength(8);
    expect(result.newMaterialWithheld).toBe("none");
  });

  it("offers new material even when nothing is due", () => {
    const result = buildSessionQueue({ due: [], newCards, settings: SETTINGS });
    expect(result.queue).toHaveLength(8);
    expect(result.displayedDueCount).toBe(0);
  });

  it("never returns more new cards than exist", () => {
    const result = buildSessionQueue({ due: [], newCards: newCards.slice(0, 3), settings: SETTINGS });
    expect(result.newIds).toHaveLength(3);
  });
});

describe("settings edge cases", () => {
  it("treats a zero cap as no reviews rather than as unlimited", () => {
    const result = buildSessionQueue({
      due: backlog(50),
      newCards: [],
      settings: { ...SETTINGS, reviewCap: 0 },
    });
    expect(result.reviewIds).toEqual([]);
    expect(result.displayedDueCount).toBe(0);
  });

  it("survives a negative cap without producing a queue", () => {
    const result = buildSessionQueue({
      due: backlog(50),
      newCards: [],
      settings: { ...SETTINGS, reviewCap: -5 },
    });
    expect(result.reviewIds).toEqual([]);
    expect(result.displayedDueCount).toBe(0);
  });
});
