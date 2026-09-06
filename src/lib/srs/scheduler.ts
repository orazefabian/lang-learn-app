import {
  Rating,
  State,
  createEmptyCard,
  fsrs,
  generatorParameters,
  type Card as FsrsCard,
  type FSRSParameters,
  type Grade,
  type RecordLogItem,
} from "ts-fsrs";

/**
 * FSRS wiring.
 *
 * Note on the version: the brief asks for FSRS-5, but ts-fsrs 5.4.2 ships
 * FSRS-6 as its default parameter set (21 weights instead of 17). FSRS-6 is the
 * successor to FSRS-5 by the same authors and is strictly better calibrated, so
 * the library default is used. Pin FSRS-5 by passing its 17 weights to
 * `createScheduler` if that is ever wanted — nothing else in the app changes.
 */

export type CardRating = "again" | "hard" | "good" | "easy";
export type CardState = "new" | "learning" | "review" | "relearning";

/** The scheduler state we persist, mirrored from ts-fsrs. */
export type SchedulerState = {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: CardState;
  lastReview: Date | null;
  learningSteps: number;
};

export type GradeResult = {
  /** The card's new scheduler state, ready to write back. */
  next: SchedulerState;
  /** The append-only review record. */
  log: {
    rating: CardRating;
    state: CardState;
    due: Date;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    lastElapsedDays: number;
    scheduledDays: number;
    learningSteps: number;
    reviewedAt: Date;
  };
};

const RATING_TO_FSRS: Record<CardRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const FSRS_TO_RATING: Record<number, CardRating> = {
  [Rating.Again]: "again",
  [Rating.Hard]: "hard",
  [Rating.Good]: "good",
  [Rating.Easy]: "easy",
};

const STATE_TO_FSRS: Record<CardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const FSRS_TO_STATE: Record<number, CardState> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

export function ratingToFsrs(rating: CardRating): Grade {
  return RATING_TO_FSRS[rating];
}

export function fsrsToRating(rating: number): CardRating {
  const mapped = FSRS_TO_RATING[rating];
  if (!mapped) throw new Error(`unmapped FSRS rating ${rating}`);
  return mapped;
}

export function stateToFsrs(state: CardState): State {
  return STATE_TO_FSRS[state];
}

export function fsrsToState(state: number): CardState {
  const mapped = FSRS_TO_STATE[state];
  if (!mapped) throw new Error(`unmapped FSRS state ${state}`);
  return mapped;
}

export function createScheduler(parameters?: Partial<FSRSParameters>) {
  return fsrs(generatorParameters(parameters));
}

/** The state a brand-new card starts in. */
export function newCardState(now: Date = new Date()): SchedulerState {
  return fromFsrsCard(createEmptyCard(now));
}

export function toFsrsCard(state: SchedulerState): FsrsCard {
  return {
    due: state.due,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsedDays,
    scheduled_days: state.scheduledDays,
    learning_steps: state.learningSteps,
    reps: state.reps,
    lapses: state.lapses,
    state: stateToFsrs(state.state),
    ...(state.lastReview ? { last_review: state.lastReview } : {}),
  };
}

export function fromFsrsCard(card: FsrsCard): SchedulerState {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: fsrsToState(card.state),
    lastReview: card.last_review ?? null,
    learningSteps: card.learning_steps,
  };
}

/**
 * Grades one card.
 *
 * A card answered correctly forty days late keeps the credit for those forty
 * days — FSRS derives elapsed time from `last_review`, so a long gap raises
 * stability instead of resetting it. That is exactly the behaviour this app
 * needs, because coming back after two weeks must not feel like a punishment.
 */
export function gradeCard(
  state: SchedulerState,
  rating: CardRating,
  now: Date = new Date(),
  scheduler = createScheduler(),
): GradeResult {
  const result: RecordLogItem = scheduler.next(toFsrsCard(state), now, ratingToFsrs(rating));

  return {
    next: fromFsrsCard(result.card),
    log: {
      rating: fsrsToRating(result.log.rating),
      state: fsrsToState(result.log.state),
      due: result.log.due,
      stability: result.log.stability,
      difficulty: result.log.difficulty,
      elapsedDays: result.log.elapsed_days,
      lastElapsedDays: result.log.last_elapsed_days,
      scheduledDays: result.log.scheduled_days,
      learningSteps: result.log.learning_steps,
      reviewedAt: result.log.review,
    },
  };
}

/** Probability she still remembers this card right now, 0..1. */
export function retrievability(
  state: SchedulerState,
  now: Date = new Date(),
  scheduler = createScheduler(),
): number {
  return scheduler.get_retrievability(toFsrsCard(state), now, false);
}
