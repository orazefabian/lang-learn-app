import { describe, expect, it } from "vitest";
import {
  createScheduler,
  gradeCard,
  newCardState,
  retrievability,
  type SchedulerState,
} from "@/lib/srs/scheduler";

const NOW = new Date("2026-03-01T09:00:00.000Z");
const scheduler = createScheduler();

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000);
}

/** A mature card: reviewed often, long interval, last seen `daysAgo` ago. */
function matureCard(daysAgo: number, stability = 30): SchedulerState {
  const lastReview = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    due: new Date(lastReview.getTime() + stability * 24 * 60 * 60 * 1000),
    stability,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: stability,
    reps: 8,
    lapses: 0,
    state: "review",
    lastReview,
    learningSteps: 0,
  };
}

describe("new cards", () => {
  it("start in the new state, due immediately", () => {
    const state = newCardState(NOW);
    expect(state.state).toBe("new");
    expect(state.reps).toBe(0);
    expect(state.lapses).toBe(0);
    expect(state.due.getTime()).toBe(NOW.getTime());
  });

  it("enter learning on the first Good and get a short step", () => {
    const { next } = gradeCard(newCardState(NOW), "good", NOW, scheduler);
    expect(next.state).toBe("learning");
    expect(next.reps).toBe(1);
    expect(daysBetween(NOW, next.due)).toBeLessThan(1);
  });

  it("gives Easy a longer first interval than Good", () => {
    const easy = gradeCard(newCardState(NOW), "easy", NOW, scheduler).next;
    const good = gradeCard(newCardState(NOW), "good", NOW, scheduler).next;
    expect(easy.due.getTime()).toBeGreaterThan(good.due.getTime());
  });
});

describe("ratings", () => {
  it("Again on a mature card counts a lapse and schedules it soon", () => {
    const card = matureCard(30);
    const { next } = gradeCard(card, "again", NOW, scheduler);
    expect(next.lapses).toBe(1);
    expect(next.state).toBe("relearning");
    expect(daysBetween(NOW, next.due)).toBeLessThan(1);
  });

  it("orders the four ratings by resulting interval", () => {
    const card = matureCard(30);
    const intervals = (["again", "hard", "good", "easy"] as const).map(
      (rating) => gradeCard(card, rating, NOW, scheduler).next.due.getTime(),
    );
    for (let i = 1; i < intervals.length; i += 1) {
      expect(intervals[i] as number).toBeGreaterThan(intervals[i - 1] as number);
    }
  });

  it("does not count a lapse when the answer was right", () => {
    const card = matureCard(30);
    for (const rating of ["hard", "good", "easy"] as const) {
      expect(gradeCard(card, rating, NOW, scheduler).next.lapses).toBe(0);
    }
  });
});

describe("long absences", () => {
  /**
   * The behaviour the whole app is designed around: she disappears for weeks,
   * comes back, still remembers a card — that must be rewarded, not reset.
   */
  it("gives credit for a card answered correctly 40 days late", () => {
    const onTime = matureCard(30);
    const veryLate = matureCard(70);

    const onTimeResult = gradeCard(onTime, "good", NOW, scheduler).next;
    const lateResult = gradeCard(veryLate, "good", NOW, scheduler).next;

    // Remembering after a longer gap is stronger evidence of retention.
    expect(lateResult.stability).toBeGreaterThan(onTimeResult.stability);
    expect(lateResult.state).toBe("review");
    expect(lateResult.lapses).toBe(0);
  });

  it("schedules a late-but-correct card further out, never back to zero", () => {
    const veryLate = matureCard(70);
    const { next } = gradeCard(veryLate, "good", NOW, scheduler);
    expect(daysBetween(NOW, next.due)).toBeGreaterThan(veryLate.scheduledDays);
  });

  it("still records a lapse if the long-delayed card was forgotten", () => {
    const { next } = gradeCard(matureCard(70), "again", NOW, scheduler);
    expect(next.lapses).toBe(1);
    expect(next.stability).toBeLessThan(70);
  });
});

describe("review log", () => {
  it("records the state as it was before scheduling", () => {
    const card = matureCard(30);
    const { log } = gradeCard(card, "good", NOW, scheduler);
    expect(log.rating).toBe("good");
    expect(log.state).toBe("review");
    expect(log.stability).toBeCloseTo(card.stability, 5);
    expect(log.reviewedAt.getTime()).toBe(NOW.getTime());
  });

  it("round-trips every rating through the log", () => {
    for (const rating of ["again", "hard", "good", "easy"] as const) {
      expect(gradeCard(matureCard(10), rating, NOW, scheduler).log.rating).toBe(rating);
    }
  });
});

describe("retrievability", () => {
  it("falls as a card gets more overdue", () => {
    const fresh = retrievability(matureCard(1), NOW, scheduler);
    const stale = retrievability(matureCard(120), NOW, scheduler);
    expect(fresh).toBeGreaterThan(stale);
    expect(stale).toBeGreaterThanOrEqual(0);
    expect(fresh).toBeLessThanOrEqual(1);
  });
});
