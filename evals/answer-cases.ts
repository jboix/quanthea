/**
 * The answer cases: questions and explanations about the dev seed's checkout incident dashboard,
 * pinned, through the dashboard answering service rather than a thread. The incident is deploy
 * #481 of checkout-svc, yesterday at 12:02 UTC (14:02 in Zurich in summer, 13:02 in winter), rolled back 36
 * minutes later. Each case says what a good answer holds.
 */
import type { AccessLevel, TimeRangeExpression } from '@quanthea/shared';
import { incidentHour, zurich } from './questions.ts';

/** What a good answer or explanation holds. */
export interface AnswerExpectation {
  /** Whether the answer must read data (`some`) or must not (`none`); either when left out. */
  readonly reads?: 'some' | 'none';
  /** What the text must mention: each pattern matches the text. */
  readonly topics: readonly RegExp[];
  /** Whether the text must say it cannot read the numbers. */
  readonly admitsNoData?: boolean;
  /** Whether the text must state a time range, such as "14:02 to 14:38". */
  readonly timeRange?: boolean;
  /** Whether the text must quote no measurement (see `dataNumbers`). */
  readonly noDataNumbers?: boolean;
  /** Whether the text must carry no citation markers and the answer no citations. */
  readonly noCitations?: boolean;
}

/** What every answer case names. */
interface CaseBase {
  /** Its id, for `--only`. */
  readonly id: string;
  /** The access level both dev connectors have while the case runs. */
  readonly accessLevel: AccessLevel;
  /** What a good answer holds. */
  readonly expect: AnswerExpectation;
}

/** A question about the pinned dashboard's data. */
export interface AskCase extends CaseBase {
  /** A question. */
  readonly mode: 'ask';
  /** What the person asks. */
  readonly question: string;
  /** The person's time zone; the dashboard names none. */
  readonly timeZone: string;
  /** The range the person looks at, relative to the evals' clock (today, 10:00 UTC). */
  readonly time: TimeRangeExpression;
  /** The case whose question this one follows up on, if any. */
  readonly follows?: string;
}

/** An explanation of one panel of the pinned dashboard. */
export interface ExplainCase extends CaseBase {
  /** An explanation. */
  readonly mode: 'explain';
  /** The panel to explain. */
  readonly panelId: string;
}

/** One answer case. */
export type AnswerCase = AskCase | ExplainCase;

/** Yesterday from 06:00 to 18:00 UTC, as seen from the evals' clock. */
const yesterdayDaytime: TimeRangeExpression = { from: 'now-28h', to: 'now-16h' };

/** The question of a1 and a2, at the incident's hour in Zurich. */
const aroundTheIncident = `What happened around ${incidentHour(zurich)}?`;

/** What happened: the error rate. */
const whatHappened = /error|5xx|fail/i;

/** The deploy that started it. */
const theDeploy = /deploy|#481|release|rollout/i;

/** The answer cases, in the order they run, after the questions. */
export const answerCases: readonly AnswerCase[] = [
  {
    id: 'a1',
    mode: 'ask',
    question: aroundTheIncident,
    timeZone: zurich,
    time: yesterdayDaytime,
    accessLevel: 3,
    expect: { reads: 'some', topics: [whatHappened, theDeploy], timeRange: true },
  },
  {
    id: 'a2',
    mode: 'ask',
    question: aroundTheIncident,
    timeZone: zurich,
    time: yesterdayDaytime,
    accessLevel: 2,
    expect: { reads: 'none', topics: [], admitsNoData: true, noDataNumbers: true },
  },
  {
    id: 'a3',
    mode: 'explain',
    panelId: 'error-rate-by-service',
    // Readable sources show that an explanation reads nothing even when it could.
    accessLevel: 3,
    expect: {
      reads: 'none',
      topics: [/rate|ratio|share|proportion/i, /5xx|5\.\.|server error|error/i, /request/i],
      noDataNumbers: true,
      noCitations: true,
    },
  },
  {
    id: 'a4',
    mode: 'ask',
    question: 'How long did it last?',
    timeZone: zurich,
    time: yesterdayDaytime,
    accessLevel: 3,
    follows: 'a1',
    expect: { topics: [/\d+\s*(?:min|minute|hour|h\b)|half an hour/i] },
  },
];

/**
 * The answer cases `--only` keeps, in their order. A follow-up asks the case it follows first
 * when that case is not kept.
 *
 * @param only - The ids to keep, or none for every case.
 * @returns The cases.
 */
export function selectAnswerCases(only: readonly string[]): readonly AnswerCase[] {
  if (only.length === 0) return answerCases;
  return answerCases.filter((each) => only.includes(each.id));
}

/**
 * The text a case asks, for the report: its question, or the panel it explains.
 *
 * @param answerCase - The case.
 * @returns The text.
 */
export function caseText(answerCase: AnswerCase): string {
  return answerCase.mode === 'ask'
    ? answerCase.question
    : `Explain the panel ${answerCase.panelId}.`;
}
