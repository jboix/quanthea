/**
 * The report cases: a report conversation about the dev data's orders, and questions about the run
 * it made. The dev Postgres holds 60 days of a shop's orders, with the checkout incident (deploy
 * #481 of checkout-svc, yesterday at 12:02 UTC) failing many of them for 36 minutes. The cases
 * report on yesterday, compared with the day before. Each says what a good report or answer holds.
 */
import type { AccessLevel, ReportPeriod, Weekday } from '@quanthea/shared';
import { incidentHour, zurich } from './questions.ts';

/** The schedule a good report runs on; a field left out takes any value. */
export interface ScheduleExpectation {
  /** Every day or every week. */
  readonly every: 'day' | 'week';
  /** The weekday of a weekly schedule. */
  readonly weekday?: Weekday;
  /** The time of day, such as `07:00`. */
  readonly at: string;
  /** The time zone of its clock. */
  readonly timezone: string;
}

/** What a good report, and the conversation that wrote it, hold. */
export interface ReportExpectation {
  /** The connector every panel's query runs on. */
  readonly connector: string;
  /** When it runs. */
  readonly schedule: ScheduleExpectation;
  /** The period each run covers. */
  readonly period: ReportPeriod;
  /** What each run compares with. */
  readonly compare: 'previous_period' | 'none';
  /** What the headline panels show: each pattern matches a summary panel's title or query. */
  readonly summaryTopics: readonly RegExp[];
  /** Whether the case must save a new version of a report that has one already. */
  readonly newVersion?: boolean;
  /** Whether a run of the saved version must hold the orders and revenue the database holds. */
  readonly checkRun?: boolean;
}

/** One report case: a turn of a report conversation. */
export interface ReportCase {
  /** Its id, for `--only`. */
  readonly id: string;
  /** Marks a report conversation apart from a question about a run. */
  readonly mode: 'write';
  /** What the person says first. */
  readonly question: string;
  /** The person's time zone. */
  readonly timeZone: string;
  /** How the person answers the agent's question. */
  readonly answer: string;
  /** The access level both dev connectors have while the case runs. */
  readonly accessLevel: AccessLevel;
  /** The case whose thread this one continues, if any. */
  readonly follows?: string;
  /** What a good report holds. */
  readonly expect: ReportExpectation;
}

/** What a good answer about a run holds. */
export interface RunAnswerExpectation {
  /** What the text must mention: each pattern matches the text. */
  readonly topics: readonly RegExp[];
  /** Whether a citation must point at a read of the run's frozen results. */
  readonly citesFrozenRead?: boolean;
  /** Whether the text must say it cannot read the numbers. */
  readonly admitsNoData?: boolean;
  /** Whether the text must quote no measurement (see `dataNumbers`). */
  readonly noDataNumbers?: boolean;
  /** Whether the answer must carry one to three follow-up cards. */
  readonly followUps?: boolean;
}

/** One question about the run, in the order a conversation asks them. */
export interface RunAsk {
  /** What the person asks. */
  readonly question: string;
  /** What a good answer holds. */
  readonly expect: RunAnswerExpectation;
}

/** One run case: a conversation about the run a report case made. */
export interface RunAnswerCase {
  /** Its id, for `--only`. */
  readonly id: string;
  /** Marks a question about a run apart from a report conversation. */
  readonly mode: 'ask';
  /** The report case whose run it asks about. */
  readonly run: string;
  /** The access level both dev connectors have while the case runs. */
  readonly accessLevel: AccessLevel;
  /** The questions, each following up on the one before. */
  readonly asks: readonly RunAsk[];
}

/** A report case or a run case. */
export type AnyReportCase = ReportCase | RunAnswerCase;

const postgres = 'postgres-orders';

/** How the person answers when the agent asks: the source, the definitions and the channel. */
const scripted =
  'From postgres-orders. Count every order attempt, revenue from paid orders, and the failed ones apart. Send it to the Evals test channel.';

/** The daily report r1 writes. */
const daily: ReportExpectation = {
  connector: postgres,
  schedule: { every: 'day', at: '07:00', timezone: zurich },
  period: 'previous_day',
  compare: 'previous_period',
  summaryTopics: [/order|count/i, /revenue|sales|total_cents|amount/i],
  checkRun: true,
};

/**
 * A clock time within an hour of an hour, such as `13:xx`, `14:xx` or `15:xx` around `14:00`.
 *
 * @param hour - The hour, such as `14:00`.
 * @returns The pattern's source.
 */
function aroundHour(hour: string): string {
  const middle = Number(hour.slice(0, 2));
  const hours = [middle - 1, middle, middle + 1].map((each) => String(each).padStart(2, '0'));
  return `\\b(?:${hours.join('|')}):\\d{2}\\b`;
}

/** The incident, by name or by its hour in Zurich. */
const theIncident = new RegExp(
  `incident|outage|deploy|spike|${aroundHour(incidentHour(zurich))}`,
  'i',
);

/** The question of r3 and r4. */
const whatStoodOut = 'What stood out yesterday?';

/** The report cases and the run cases, in the order they run, after the alert cases. */
export const reportCases: readonly AnyReportCase[] = [
  {
    id: 'r1',
    mode: 'write',
    question:
      "Every morning at 7:00, yesterday's orders: how many, revenue, and failed orders, compared with the day before.",
    timeZone: zurich,
    answer: scripted,
    accessLevel: 3,
    expect: daily,
  },
  {
    id: 'r2',
    mode: 'write',
    question: 'Make it weekly on Mondays, covering the previous week.',
    timeZone: zurich,
    answer: scripted,
    accessLevel: 3,
    follows: 'r1',
    expect: {
      ...daily,
      schedule: { every: 'week', weekday: 'monday', at: '07:00', timezone: zurich },
      period: 'previous_week',
      newVersion: true,
      checkRun: false,
    },
  },
  {
    id: 'r3',
    mode: 'ask',
    run: 'r1',
    accessLevel: 3,
    asks: [
      {
        question: whatStoodOut,
        expect: { topics: [/fail|error/i, theIncident], citesFrozenRead: true },
      },
      { question: 'What should we keep an eye on?', expect: { topics: [], followUps: true } },
    ],
  },
  {
    id: 'r4',
    mode: 'ask',
    run: 'r1',
    accessLevel: 2,
    asks: [
      { question: whatStoodOut, expect: { topics: [], admitsNoData: true, noDataNumbers: true } },
    ],
  },
];

/**
 * The report and run cases `--only` keeps, in their order. A follow-up runs the case it follows
 * first when that case is not kept, and a run case the report case whose run it asks about.
 *
 * @param only - The ids to keep, or none for every case.
 * @returns The cases.
 */
export function selectReportCases(only: readonly string[]): readonly AnyReportCase[] {
  if (only.length === 0) return reportCases;
  return reportCases.filter((each) => only.includes(each.id));
}

/**
 * The text a case asks, for the report: its first message, or its questions about the run.
 *
 * @param reportCase - The case.
 * @returns The text.
 */
export function reportCaseText(reportCase: AnyReportCase): string {
  if (reportCase.mode === 'write') return reportCase.question;
  const asked = reportCase.asks.map((ask) => ask.question).join(' Then: ');
  return `${asked} (about the run of ${reportCase.run})`;
}
