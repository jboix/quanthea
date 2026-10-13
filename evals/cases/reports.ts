/**
 * The report cases: report conversations about the dev data's orders, and questions about a run of
 * a report. The dev Postgres holds 60 days of a shop's orders, with the checkout incident (deploy
 * #481 of checkout-svc, yesterday at 12:02 UTC) failing many of them for 36 minutes. The reports
 * cover yesterday, compared with the day before.
 */
import {
  comparesWith,
  covers,
  headline,
  queriesOnly,
  type ReportCheck,
  runsOn,
  savesNewVersion,
} from '../checks/report.ts';
import { ordersOfRun, runMatchesDatabase } from '../checks/report-run.ts';
import {
  admitsNoData,
  citesFrozenRead,
  mentions,
  offersFollowUps,
  quotesNoData,
} from '../checks/run-answer.ts';
import type { CaseOn } from '../core/case.ts';
import { baseWorld, dailyOrdersReport, dailyOrdersRun } from '../fixtures/fixtures.ts';
import { orderTruth } from '../truth/orders.ts';
import { incidentHour, zurich } from '../world/incident.ts';

const postgres = 'postgres-orders';

/** How the person answers when the agent asks: the source, the definitions and the channel. */
const scripted =
  'From postgres-orders. Count every order attempt, revenue from paid orders, and the failed ones apart. Send it to the Evals test channel.';

/** What a daily report of the orders holds, whatever its schedule. */
const ordersReport: readonly ReportCheck[] = [
  queriesOnly(postgres),
  headline(/order|count/i),
  headline(/revenue|sales|total_cents|amount/i),
];

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

/** The report cases and the cases about a run, in the order they run, after the alert cases. */
export const reportCases: readonly (CaseOn<'report'> | CaseOn<'run-answer'>)[] = [
  {
    id: 'r1',
    bucket: 'capability',
    given: baseWorld,
    input: {
      surface: 'report',
      turns: [
        "Every morning at 7:00, yesterday's orders: how many, revenue, and failed orders, compared with the day before.",
      ],
      reply: scripted,
      accessLevel: 3,
    },
    checks: [
      runsOn({ every: 'day', at: '07:00', timezone: zurich }),
      covers('previous_day'),
      comparesWith('previous_period'),
      ...ordersReport,
      runMatchesDatabase(ordersOfRun(orderTruth)),
    ],
  },
  {
    id: 'r2',
    bucket: 'capability',
    // The thread already wrote the daily report of r1: this turn changes it.
    given: dailyOrdersReport,
    input: {
      surface: 'report',
      turns: ['Make it weekly on Mondays, covering the previous week.'],
      reply: scripted,
      accessLevel: 3,
    },
    checks: [
      runsOn({ every: 'week', weekday: 'monday', at: '07:00', timezone: zurich }),
      covers('previous_week'),
      comparesWith('previous_period'),
      ...ordersReport,
      savesNewVersion,
    ],
  },
  {
    id: 'r3',
    bucket: 'realistic',
    given: dailyOrdersRun,
    input: {
      surface: 'run-answer',
      turns: [whatStoodOut, 'What should we keep an eye on?'],
      accessLevel: 3,
    },
    checks: [
      citesFrozenRead(1),
      mentions(1, /fail|error/i),
      mentions(1, theIncident),
      offersFollowUps(2),
    ],
    rubric: [
      'The first answer says that the failed orders or the errors stood out.',
      'The first answer points at an incident, a spike or the time it happened.',
      'The second answer names something specific to watch.',
    ],
  },
  {
    id: 'r4',
    bucket: 'capability',
    given: dailyOrdersRun,
    // At schema and metadata only, the answer sees the results' shape but not their numbers.
    input: { surface: 'run-answer', turns: [whatStoodOut], accessLevel: 2 },
    checks: [admitsNoData(1), quotesNoData(1)],
    rubric: ['The answer says it cannot read the numbers.'],
  },
];
