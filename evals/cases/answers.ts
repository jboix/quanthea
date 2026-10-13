/**
 * The answer cases: questions and explanations about a pinned dashboard, through the dashboard
 * answering service rather than a thread. Most are about the dev seed's checkout incident: deploy
 * #481 of checkout-svc, yesterday at 12:02 UTC (14:02 in Zurich in summer, 13:02 in winter),
 * rolled back 36 minutes later. One asks about the player events on the dev OpenSearch, and runs
 * only with the search connector.
 */
import type { TimeRangeExpression } from '@quanthea/shared';
import {
  admitsNoData,
  mentions,
  namesTwoTimes,
  noCitations,
  quotesNoData,
  readsData,
  readsNothing,
} from '../checks/answer.ts';
import type { CaseOn } from '../core/case.ts';
import {
  aroundTheIncident,
  eventsDashboardPinned,
  incidentAnswered,
  incidentDashboard,
  yesterdayDaytime,
} from '../fixtures/fixtures.ts';

/** What happened: the error rate. */
const whatHappened = /error|5xx|fail/i;

/** The deploy that started it. */
const theDeploy = /deploy|#481|release|rollout/i;

/** The last 24 hours, as seen from the evals' clock. */
const lastDay: TimeRangeExpression = { from: 'now-24h', to: 'now' };

/** An hour of the day: a clock time, or an hour with am, pm or h. */
const anHourOfTheDay = /\b\d{1,2}(?::\d{2}|\s*(?:am|pm|h)\b)/i;

/**
 * Whether it repeats: that the busiest hours come back day after day, that the traffic is even, or
 * that the data covers too few days to tell.
 */
const whetherItRepeats =
  /consisten|repeat|recur|every day|each day|day to day|daily|steady|stable|flat|even\b|same|one day|single day|not enough|too short|too few/i;

/** How long something lasted: a duration, or a clock time to another. */
const aDuration =
  /\d+\s*(?:min|minute|hour|h\b)|half an hour|\d{1,2}:\d{2}\s*(?:to|until|till|-|–)\s*\d{1,2}:\d{2}/i;

/** The answer and explanation cases, in the order they run, after the dashboard cases. */
export const answerCases: readonly (CaseOn<'answer'> | CaseOn<'explanation'>)[] = [
  {
    id: 'a1',
    bucket: 'realistic',
    given: incidentDashboard,
    input: {
      surface: 'answer',
      turns: [aroundTheIncident],
      time: yesterdayDaytime,
      accessLevel: 3,
    },
    checks: [readsData, mentions(whatHappened), mentions(theDeploy), namesTwoTimes],
    rubric: [
      'The answer says that the errors of checkout rose.',
      'The answer attributes the rise to a deploy.',
      'The answer says when it happened.',
    ],
  },
  {
    id: 'a2',
    bucket: 'capability',
    given: incidentDashboard,
    // At schema and metadata only, no source shows numbers: the answer must not read or quote any.
    input: {
      surface: 'answer',
      turns: [aroundTheIncident],
      time: yesterdayDaytime,
      accessLevel: 2,
    },
    checks: [readsNothing, admitsNoData, quotesNoData],
    rubric: ['The answer says it cannot read the numbers.'],
  },
  {
    id: 'a3',
    bucket: 'capability',
    given: incidentDashboard,
    // Readable sources show that an explanation reads nothing even when it could.
    input: { surface: 'explanation', turns: [], panel: 'error-rate-by-service', accessLevel: 3 },
    checks: [
      readsNothing,
      mentions(/rate|ratio|share|proportion/i),
      mentions(/5xx|5\.\.|server error|error/i),
      mentions(/request/i),
      quotesNoData,
      noCitations,
    ],
    rubric: [
      'The explanation says the panel shows the share of the requests that ended in a server error.',
    ],
  },
  {
    id: 'a4',
    bucket: 'realistic',
    // The incident question is already asked and answered: this one follows up on it.
    given: incidentAnswered,
    input: {
      surface: 'answer',
      turns: ['How long did it last?'],
      time: yesterdayDaytime,
      accessLevel: 3,
    },
    checks: [mentions(aDuration)],
    rubric: ['The answer says how long the incident lasted, between 20 and 45 minutes.'],
  },
  {
    id: 'a5',
    bucket: 'realistic',
    given: eventsDashboardPinned,
    input: {
      surface: 'answer',
      turns: ['When do we have the most traffic during the day, and is it consistent?'],
      time: lastDay,
      accessLevel: 3,
    },
    checks: [readsData, mentions(anHourOfTheDay), mentions(whetherItRepeats)],
    rubric: [
      'The answer says when the traffic is highest.',
      'The answer says whether the pattern repeats, or that the data is too short to tell.',
    ],
  },
];
