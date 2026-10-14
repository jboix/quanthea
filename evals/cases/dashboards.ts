/**
 * The dashboard cases: questions a person asks about the dev data's checkout incident, deploy #481
 * of checkout-svc, yesterday at 12:02 UTC, rolled back 36 minutes later. They ask as a person
 * would, so each takes any reasonable dashboard: code checks that it was built and runs, and the
 * rubric says what it must show. Add one only when a failure surprises you.
 */
import {
  type DashboardCheck,
  dashboardHas,
  hasMarkers,
  markersFrom,
  markerTopic,
  maxRepairs,
  panelCount,
  queries,
  topic,
  variablesLabelled,
} from '../checks/dashboard.ts';
import type { CaseOn } from '../core/case.ts';
import { baseWorld } from '../fixtures/fixtures.ts';
import { incidentHour, zurich } from '../world/incident.ts';

const prometheus = 'prometheus-dev';
const postgres = 'postgres-orders';

/**
 * A question about the dev data, asked in a new thread of a world with nothing made yet.
 *
 * @param id - The case's id.
 * @param turn - What the person asks.
 * @param checks - What code checks beside the surface's own checks.
 * @param rubric - What the dashboard must show, one claim per sentence.
 * @param reply - How the person answers a question of the agent; its first option when left out.
 * @returns The case.
 */
function question(
  id: string,
  turn: string,
  checks: readonly DashboardCheck[],
  rubric: readonly string[],
  reply?: string,
): CaseOn<'dashboard'> {
  const input = { surface: 'dashboard' as const, turns: [turn], ...(reply ? { reply } : {}) };
  return { id, bucket: 'realistic', given: baseWorld, input, checks, rubric };
}

/** The dashboard cases, in the order they run. */
export const dashboardCases: readonly CaseOn<'dashboard'>[] = [
  question(
    'q1',
    `What happened to checkout yesterday around ${incidentHour(zurich)}?`,
    [
      panelCount(3, 8),
      maxRepairs(2),
      queries(prometheus),
      topic(/error|5xx/i),
      topic(/latency|p95|duration/i),
    ],
    [
      'A panel shows the errors or the failed requests of checkout over time.',
      'A panel shows the latency or the duration of checkout requests over time.',
    ],
    'Errors and latency of checkout, from the metrics.',
  ),
  question(
    'q2',
    'Show the error rate of every service over yesterday, in prod.',
    [panelCount(1, 6), maxRepairs(1), queries(prometheus), topic(/error|5xx/i)],
    [
      'A panel shows an error rate over time, with one series per service.',
      'The queries keep to the prod environment.',
    ],
  ),
  question(
    'q3',
    'How many orders failed yesterday, and for which reasons?',
    [panelCount(1, 6), maxRepairs(1), queries(postgres), topic(/fail/i), topic(/reason/i)],
    ['A panel shows how many orders failed.', 'A panel breaks the failed orders down by reason.'],
  ),
  question(
    'q4',
    'p95 latency of each checkout route yesterday, in prod.',
    [panelCount(1, 6), maxRepairs(1), queries(prometheus), topic(/p95|latency|quantile/i)],
    [
      'A panel shows the 95th percentile of the latency, with one series or one row per route.',
      'The queries keep to the checkout service.',
    ],
  ),
  question(
    'q5',
    'Which deploys happened yesterday, and did 5xx errors follow them?',
    [
      // Errors on a chart with the deploys as markers is a good answer in one panel.
      panelCount(1, 8),
      maxRepairs(2),
      queries(postgres),
      queries(prometheus),
      topic(/deploy/i),
      topic(/error|5xx/i),
    ],
    [
      'The deploys of yesterday are shown, in a panel or as markers on a chart.',
      'A panel shows the 5xx errors over time, so they can be read against the deploys.',
    ],
  ),
  question(
    'q6',
    'Payment errors by provider yesterday.',
    [panelCount(1, 6), maxRepairs(1), queries(postgres), topic(/payment|provider/i)],
    ['A panel shows the failed payments or the payment errors, broken down by provider.'],
  ),
  question(
    'q7',
    'Revenue per country over the last 7 days.',
    [
      panelCount(1, 6),
      maxRepairs(1),
      queries(postgres),
      topic(/revenue|total|amount/i),
      topic(/country/i),
    ],
    ['A panel shows the revenue broken down by country.', 'The dashboard covers the last 7 days.'],
  ),
  question(
    'q8',
    'The 5 slowest endpoints yesterday, in prod.',
    [panelCount(1, 6), maxRepairs(1), queries(prometheus), topic(/slow|latency|p95|quantile/i)],
    [
      'A panel ranks the endpoints or the routes by how slow they are.',
      'It keeps to the 5 slowest.',
    ],
  ),
  question(
    'q9',
    'Refunds by reason over the last 7 days.',
    [panelCount(1, 6), maxRepairs(1), queries(postgres), topic(/refund/i)],
    ['A panel shows the refunds broken down by reason.'],
  ),
  question(
    'q10',
    'Compare the request rate of prod and staging yesterday.',
    [panelCount(1, 6), maxRepairs(1), queries(prometheus), topic(/request|traffic|rps|rate/i)],
    ['A panel shows the request rate of prod and of staging, so the two can be compared.'],
  ),
  question(
    'q11',
    'Which 5xx status codes did checkout return during yesterday’s incident?',
    [panelCount(1, 6), maxRepairs(1), queries(prometheus), topic(/5xx|code|status/i)],
    ['A panel shows the 5xx responses of checkout, broken down by status code.'],
  ),
  question(
    'q12',
    'Orders per hour yesterday, with the share that failed.',
    [panelCount(1, 6), maxRepairs(1), queries(postgres), topic(/order/i), topic(/fail/i)],
    ['A panel shows the orders per hour.', 'A panel shows the share of the orders that failed.'],
  ),
  question(
    'q13',
    'Show the 5xx errors per service yesterday, in prod, with the deploys marked.',
    [
      panelCount(1, 6),
      maxRepairs(1),
      queries(prometheus),
      queries(postgres),
      topic(/error|5xx/i),
      // The deploys belong on the error charts as markers from the deploys table, not in a panel.
      hasMarkers,
      markerTopic(/deploy/i),
      markersFrom(postgres),
    ],
    ['A panel shows the 5xx errors over time, with one series per service.'],
  ),
  question(
    'q14',
    'Request rate and error rate in prod over the last 6 hours, where I can pick the service and the rate window.',
    [
      panelCount(1, 6),
      maxRepairs(1),
      queries(prometheus),
      dashboardHas('variables.kind=interval'),
      // Each chip shows words a person reads, such as "Service", not $service.
      variablesLabelled(),
    ],
    [
      'The dashboard has a variable that picks the service, and the panels follow it.',
      'The dashboard has a variable that picks the rate window.',
    ],
  ),
];
