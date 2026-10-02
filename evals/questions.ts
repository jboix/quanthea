/**
 * The questions the agent answers, about the dev data's checkout incident: deploy #481 of
 * checkout-svc, yesterday at 12:02 UTC, rolled back 36 minutes later. Each says what a good answer
 * holds. Add one only when a failure surprises you; grow toward 50 when you compare models.
 */

/** What a good answer to a question holds. */
export interface Expectation {
  /** Connectors the dashboard must query, each at least once. */
  readonly connectors: readonly string[];
  /** How many panels the dashboard may have, at least and at most. */
  readonly panels: readonly [number, number];
  /** What the dashboard must show: each pattern matches a panel's title or query. */
  readonly topics: readonly RegExp[];
  /** How many failed writes the build may take. */
  readonly maxRepairs: number;
}

/** One question. */
export interface Question {
  /** Its id, for `--only`. */
  readonly id: string;
  /** What the person asks. */
  readonly question: string;
  /** The person's time zone: "14:00" in Zurich is 12:00 UTC, the incident. */
  readonly timeZone: string;
  /** How the person answers the agent's question; its first option when not given. */
  readonly answer?: string;
  /** What a good answer holds. */
  readonly expect: Expectation;
}

const zurich = 'Europe/Zurich';
const prometheus = 'prometheus-dev';
const postgres = 'postgres-orders';

/** The questions, in the order they run. */
export const questions: readonly Question[] = [
  {
    id: 'q1',
    question: 'What happened to checkout yesterday around 14:00?',
    timeZone: zurich,
    answer: 'Errors and latency of checkout, from the metrics.',
    expect: {
      connectors: [prometheus],
      panels: [3, 8],
      topics: [/error|5xx/i, /latency|p95|duration/i],
      maxRepairs: 2,
    },
  },
  {
    id: 'q2',
    question: 'Show the error rate of every service over yesterday, in prod.',
    timeZone: zurich,
    expect: { connectors: [prometheus], panels: [1, 6], topics: [/error|5xx/i], maxRepairs: 1 },
  },
  {
    id: 'q3',
    question: 'How many orders failed yesterday, and for which reasons?',
    timeZone: zurich,
    expect: { connectors: [postgres], panels: [1, 6], topics: [/fail/i, /reason/i], maxRepairs: 1 },
  },
  {
    id: 'q4',
    question: 'p95 latency of each checkout route yesterday, in prod.',
    timeZone: zurich,
    expect: {
      connectors: [prometheus],
      panels: [1, 6],
      topics: [/p95|latency|quantile/i],
      maxRepairs: 1,
    },
  },
  {
    id: 'q5',
    question: 'Which deploys happened yesterday, and did errors follow them?',
    timeZone: zurich,
    expect: {
      connectors: [postgres, prometheus],
      // Errors on a chart with the deploys as markers is a good answer in one panel.
      panels: [1, 8],
      topics: [/deploy/i, /error|5xx/i],
      maxRepairs: 2,
    },
  },
  {
    id: 'q6',
    question: 'Payment errors by provider yesterday.',
    timeZone: zurich,
    expect: {
      connectors: [postgres],
      panels: [1, 6],
      topics: [/payment|provider/i],
      maxRepairs: 1,
    },
  },
  {
    id: 'q7',
    question: 'Revenue per country over the last 7 days.',
    timeZone: zurich,
    expect: {
      connectors: [postgres],
      panels: [1, 6],
      topics: [/revenue|total|amount/i, /country/i],
      maxRepairs: 1,
    },
  },
  {
    id: 'q8',
    question: 'The 5 slowest endpoints yesterday, in prod.',
    timeZone: zurich,
    expect: {
      connectors: [prometheus],
      panels: [1, 6],
      topics: [/slow|latency|p95|quantile/i],
      maxRepairs: 1,
    },
  },
  {
    id: 'q9',
    question: 'Refunds by reason over the last 7 days.',
    timeZone: zurich,
    expect: { connectors: [postgres], panels: [1, 6], topics: [/refund/i], maxRepairs: 1 },
  },
  {
    id: 'q10',
    question: 'Compare the request rate of prod and staging yesterday.',
    timeZone: zurich,
    expect: {
      connectors: [prometheus],
      panels: [1, 6],
      topics: [/request|traffic|rps|rate/i],
      maxRepairs: 1,
    },
  },
  {
    id: 'q11',
    question: 'Which 5xx status codes did checkout return during yesterday’s incident?',
    timeZone: zurich,
    expect: {
      connectors: [prometheus],
      panels: [1, 6],
      topics: [/5xx|code|status/i],
      maxRepairs: 1,
    },
  },
  {
    id: 'q12',
    question: 'Orders per hour yesterday, with the share that failed.',
    timeZone: zurich,
    expect: { connectors: [postgres], panels: [1, 6], topics: [/order/i, /fail/i], maxRepairs: 1 },
  },
];

/**
 * The questions `--only` keeps, in their order.
 *
 * @param only - The ids to keep, or none for every question.
 * @returns The questions.
 * @throws {Error} When an id names no question.
 */
export function selectQuestions(only: readonly string[]): readonly Question[] {
  if (only.length === 0) return questions;
  const unknown = only.filter((id) => !questions.some((question) => question.id === id));
  if (unknown.length > 0) throw new Error(`No question ${unknown.join(', ')}.`);
  return questions.filter((question) => only.includes(question.id));
}
