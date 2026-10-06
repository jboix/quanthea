/**
 * Fills the screenshot instance through its API, with the real agent: three pinned dashboards,
 * two alerts, two reports with a run each, questions about a dashboard and a run, a panel
 * explanation, a snapshot, notification channels and a thread in the bin. It writes what it made
 * to `.state/scenario.json`, which the shots read.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Api,
  build,
  converse,
  personClient,
  progress,
  shortened,
  timeZone,
  untilPlan,
} from './client.ts';
import { step } from './steps.ts';

/** What the scenario made, for the shots. */
export interface Scenario {
  readonly shop: string;
  readonly checkout: string;
  readonly payments: string;
  readonly checkoutThread: string;
  /** A thread whose plan waits for approval. */
  readonly planThread: string;
  readonly alert: string;
  readonly alertThread: string;
  readonly report: string;
  readonly reportThread: string;
  readonly snapshot: string;
}

/** Where the scenario's result goes. */
export const scenarioFile = join(import.meta.dir, '.state', 'scenario.json');

/**
 * Builds a dashboard in a thread and pins its latest version.
 *
 * @param api - The person's client.
 * @param text - What they ask for.
 * @param panels - How many panels it asks for.
 * @returns The dashboard and the thread.
 */
async function pinned(api: Api, text: string, panels: number): Promise<Made> {
  progress(`Dashboard: ${shortened(text)}`);
  const thread = await build(api, 'dashboard', text);
  await complete(api, thread.id, panels);
  if (!thread.dashboardId) throw new Error(`No dashboard came of "${text}".`);
  const detail = await api<{ versions: { version: number }[] }>(
    'GET',
    `/dashboards/${thread.dashboardId}`,
  );
  const version = Math.max(...detail.versions.map((each) => each.version));
  await api('POST', `/dashboards/${thread.dashboardId}/pin`, { version });
  progress(`    pinned v${version}`);
  return { dashboard: thread.dashboardId, thread: thread.id, version };
}

/**
 * Asks the agent, at most twice, for the panels a build left out.
 *
 * @param api - The person's client.
 * @param threadId - The thread.
 * @param panels - How many panels the dashboard should have.
 */
async function complete(api: Api, threadId: string, panels: number): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const thread = await api<{ dashboardId?: string }>('GET', `/threads/${threadId}`);
    const detail = await api<{ versions: { version: number }[] }>(
      'GET',
      `/dashboards/${thread.dashboardId}`,
    );
    const latest = Math.max(...detail.versions.map((each) => each.version));
    const path = `/dashboards/${thread.dashboardId}/versions/${latest}`;
    const { spec } = await api<{ spec: { panels: unknown[] } }>('GET', path);
    if (spec.panels.length >= panels) return;
    progress(`    ${spec.panels.length} of ${panels} panels: asking for the rest`);
    await converse(api, threadId, 'Some panels I asked for are missing. Add them back.');
  }
}

/** A pinned dashboard, the thread that made it, and the version pinned. */
interface Made {
  readonly dashboard: string;
  readonly thread: string;
  readonly version: number;
}

/**
 * Builds an alert or a report in a thread and activates its latest version.
 *
 * @param api - The person's client.
 * @param kind - `alerts` or `reports`.
 * @param text - What they ask for.
 * @returns The alert or report, and the thread.
 */
async function activated(api: Api, kind: 'alerts' | 'reports', text: string) {
  progress(`${kind === 'alerts' ? 'Alert' : 'Report'}: ${shortened(text)}`);
  const thread = await build(api, kind === 'alerts' ? 'alert' : 'report', text);
  const id = kind === 'alerts' ? thread.alertId : thread.reportId;
  if (!id) throw new Error(`Nothing came of "${text}".`);
  const detail = await api<{ versions: { version: number }[] }>('GET', `/${kind}/${id}`);
  const version = Math.max(...detail.versions.map((each) => each.version));
  await api('POST', `/${kind}/${id}/activate`, { version });
  progress(`    activated v${version}`);
  return { id, thread: thread.id };
}

/**
 * Adds the notification channels: two webhooks to the local receiver the shots start.
 *
 * @param api - An admin's client.
 */
async function channels(api: Api): Promise<void> {
  progress('Notification channels: On-call and Ops bot');
  const target = 'http://127.0.0.1:3991/quanthea';
  await api('POST', '/settings/notification-channels', {
    name: 'On-call',
    kind: 'webhook',
    target,
  });
  await api('POST', '/settings/notification-channels', {
    name: 'Ops bot',
    kind: 'webhook',
    target,
  });
}

/**
 * Asks questions about a dashboard in one conversation, each following up on the one before.
 *
 * @param api - An analyst's client.
 * @param made - The dashboard and its pinned version.
 * @param questions - The questions.
 */
async function ask(api: Api, made: Made, questions: readonly string[]): Promise<void> {
  const { dashboard, version } = made;
  const base = { version, timeZone };
  let conversationId: string | undefined;
  for (const question of questions) {
    progress(`Question: ${question}`);
    await api('POST', `/dashboards/${dashboard}/questions`, { ...base, question, conversationId });
    const list = await api<{ conversations: { id: string }[] }>(
      'GET',
      `/dashboards/${dashboard}/conversations`,
    );
    conversationId = list.conversations[0]?.id;
  }
}

/**
 * Has the first panel of a dashboard explained.
 *
 * @param api - An analyst's client.
 * @param made - The dashboard and its pinned version.
 */
async function explain(api: Api, made: Made): Promise<void> {
  const path = `/dashboards/${made.dashboard}/versions/${made.version}`;
  const { spec } = await api<{ spec: { panels: { id: string }[] } }>('GET', path);
  const panel = spec.panels[0]?.id;
  if (!panel) return;
  progress('Explanation of a panel');
  await api('POST', `${path}/panels/${panel}/explanation`, { replaces: null });
}

/**
 * Runs the scenario.
 *
 * @param password - The people's password.
 * @returns What it made.
 */
export async function runScenario(password: string): Promise<Scenario> {
  const { api: ana } = await personClient('ana.keller@example.com', password);
  const { api: marco } = await personClient('marco.rossi@example.com', password);
  const { api: lea } = await personClient('lea.fischer@example.com', password);
  await step('channels', () => channels(ana));
  const shop = await step('shop', () => pinned(ana, requests.shop, 8));
  const checkout = await step('checkout', () => pinned(ana, requests.checkout, 5));
  const planThread = await step('plan', () => {
    progress('A thread left at its plan');
    return untilPlan(ana, requests.plan);
  });
  const payments = await step('payments', () => pinned(marco, requests.payments, 3));
  return { ...(await finish(ana, marco, lea, { shop, checkout, payments })), planThread };
}

/** What the dashboards are asked for. */
const requests = {
  shop: 'A sales overview of the last 30 days, in Swiss francs (CHF) without decimals: revenue, paid orders and the average basket as numbers, revenue per day, revenue by category, by sales channel and by country, and the 10 best-selling products.',
  checkout:
    "Yesterday's checkout incident, from 12:00 to 16:00 Zurich time, to fit one screen. First row, three numbers: the peak share of 5xx responses of checkout-svc, the failed orders in the range, and the peak p95 latency of checkout-svc. Below them, side by side at half width: the share of 5xx responses per service over time from http_requests_total (code label) as a line chart with the deploys from the deploys table marked, and the failed orders by failure_reason over the range from the orders table as a bar chart.",
  plan: "Today's orders by sales channel: orders per hour for web, app and marketplace, the share that failed, and the average basket of each channel in CHF.",
  payments:
    'Payment providers over the last 14 days: authorizations, declines and errors per provider per day, and the decline rate of each.',
} as const;

/** What the alerts and reports are asked for: by Ana, then by Marco. */
const asks = {
  alerts: [
    "Tell me when checkout's 5xx share stays above 2% for 5 minutes, on the On-call channel.",
    'Alert the Ops bot channel when more than 10% of orders fail over 15 minutes.',
  ],
  reports: [
    "Every Monday at 8:00, last week's sales in Swiss francs (the CHF currency format, no decimals): revenue, orders, average basket and the 5 best-selling products, compared with the week before. Link the sales overview.",
    "Every morning at 7:00, yesterday's failed payments by provider, compared with the day before.",
  ],
} as const;

/**
 * Makes the alerts and the reports, and runs each report once.
 *
 * @param ana - The admin.
 * @param marco - The editor.
 * @returns Ana's alert and report.
 */
async function watchers(ana: Api, marco: Api) {
  const alert = await step('alert-ana', () => activated(ana, 'alerts', asks.alerts[0]));
  await step('alert-marco', () => activated(marco, 'alerts', asks.alerts[1]));
  const report = await step('report-ana', () => activated(ana, 'reports', asks.reports[0]));
  const daily = await step('report-marco', () => activated(marco, 'reports', asks.reports[1]));
  await step('report-runs', async () => {
    progress('Running each report once');
    await ana('POST', `/reports/${report.id}/run`, { send: false });
    await ana('POST', `/reports/${daily.id}/run`, { send: false });
  });
  return { alert, report };
}

/**
 * Takes a snapshot of a dashboard that lives 30 days, and bins an empty thread.
 *
 * @param marco - The editor.
 * @param made - The dashboard and its pinned version.
 * @returns The snapshot's id.
 */
async function snapshotAndBin(marco: Api, made: Made): Promise<string> {
  const body = { dashboardId: made.dashboard, version: made.version, lifetime: '30d' };
  progress('A snapshot, and a draft thread in the bin');
  const snapshot = await marco<{ id: string }>('POST', '/snapshots', body);
  const draft = await marco<{ id: string }>('POST', '/threads', { kind: 'dashboard' });
  await marco('DELETE', `/threads/${draft.id}`);
  return snapshot.id;
}

/**
 * The scenario's second half: alerts, reports, questions, a snapshot and the bin.
 *
 * @param ana - The admin.
 * @param marco - The editor.
 * @param lea - The analyst.
 * @param made - The dashboards made so far.
 * @returns What it made.
 */
async function finish(
  ana: Api,
  marco: Api,
  lea: Api,
  made: Record<'shop' | 'checkout' | 'payments', Made>,
): Promise<Omit<Scenario, 'planThread'>> {
  const { alert, report } = await watchers(ana, marco);
  const incident = ['What happened around 14:00?', 'How long did it last?'];
  await step('ask-checkout', () => ask(lea, made.checkout, incident));
  await step('ask-shop', () => ask(lea, made.shop, ['Which category grew the most?']));
  await step('explain', () => explain(lea, made.shop));
  const snapshot = await step('snapshot', () => snapshotAndBin(marco, made.checkout));
  return {
    shop: made.shop.dashboard,
    checkout: made.checkout.dashboard,
    payments: made.payments.dashboard,
    checkoutThread: made.checkout.thread,
    alert: alert.id,
    alertThread: alert.thread,
    report: report.id,
    reportThread: report.thread,
    snapshot,
  };
}

/**
 * Saves what the scenario made.
 *
 * @param scenario - What it made.
 */
export function saveScenario(scenario: Scenario): void {
  writeFileSync(scenarioFile, `${JSON.stringify(scenario, null, 2)}\n`);
}
