/**
 * One turn in an alert thread: its instructions and its tools. The instructions carry what lasts
 * first (who the agent is there, its rules, the catalog), then the turn's facts: the time, the
 * channels it may notify, the draft, the panel the thread started from, whether a replay can be
 * read, and what the phase asks.
 */
import {
  type AlertPlan,
  isDashboardPlan,
  type PlanView,
  queryText,
  resolveTime,
} from '@quanthea/shared';
import type { Instructions } from 'ai';
import { currentAlert } from './alert-edit.ts';
import {
  alertBuildingRules,
  alertEditingRules,
  alertGuide,
  alertPersona,
  alertPlanningRules,
  alertRules,
  noReplayRule,
  replayRule,
} from './alert-prompt.ts';
import { alertTools } from './alert-tools.ts';
import { askPersonTool } from './ask-tool.ts';
import { cachedInstructions } from './cache.ts';
import { dataTools } from './data-tools.ts';
import { guideTools } from './guide-tools.ts';
import { linkLines, proposeLinkTool } from './link-tool.ts';
import { alertPhaseTools, phaseOf, type ToolName } from './phases.ts';
import { nowLine } from './prompt.ts';
import type { RunContext } from './run-context.ts';

/**
 * Whether the model may read a replay: some connector shows aggregates or more.
 *
 * @param context - The run.
 * @returns Whether `replay_alert` is offered.
 */
function canReplay(context: RunContext): boolean {
  return context.modelView.connectors().some((connector) => connector.accessLevel >= 3);
}

/**
 * The channels the alert may notify, in a line.
 *
 * @param context - The run.
 * @returns The line.
 */
function channelsLine(context: RunContext): string {
  const channels = context.channels?.() ?? [];
  if (channels.length === 0)
    return 'Channels: none yet. An admin adds them in Settings → Notifications; leave "channels" empty.';
  const listed = channels.map((channel) => `${channel.id} ("${channel.name}", ${channel.kind})`);
  return `Channels you may notify, by id: ${listed.join(', ')}.`;
}

/**
 * The panel the thread started from, if it did: its title and queries.
 *
 * @param context - The run.
 * @returns The line, or nothing.
 */
function seedLines(context: RunContext): string[] {
  const { seed } = context.threads.row(context.threadId);
  if (seed === null) return [];
  try {
    const version = context.dashboards.getVersion(seed.dashboardId, seed.version, 'editor');
    const panel = version.spec.panels.find((each) => each.id === seed.panelId);
    if (!panel) return [];
    const queries = panel.queries.map((query) => `${query.connector}: ${queryText(query)}`);
    return [
      `The person started this alert from the panel "${panel.title}" of the dashboard "${version.spec.title}". Its queries:\n${queries.join('\n')}`,
      'Keep its query exactly as written, $variables included, and give each variable its value in the alert\'s "variables" (the one the person asked for, else the dashboard\'s default). Never write a value into the query: the alert then stays the same query as the panel it watches.',
    ];
  } catch {
    return [];
  }
}

/**
 * What the thread's phase asks of the agent now.
 *
 * @param context - The run.
 * @param plan - The latest alert plan, if any, and its status.
 * @returns The phase's rules.
 */
function phaseLine(context: RunContext, plan: { body: AlertPlan; status: string } | undefined) {
  const { state } = context.threads.row(context.threadId);
  if (state === 'plan_pending')
    return `${alertPlanningRules}\nA plan waits for the person to approve it. Answer questions about it, and propose a new one if they ask for changes.`;
  if (state === 'building' && plan?.status === 'approved')
    return `${alertBuildingRules}\nThe approved plan:\n${JSON.stringify(plan.body)}`;
  if (state === 'ready') return alertEditingRules;
  return `${alertPlanningRules}\nNo plan yet.`;
}

/**
 * The latest plan of the thread, when it is an alert plan.
 *
 * @param plans - The thread's plans.
 * @returns The plan and its status.
 */
function latestAlertPlan(plans: readonly PlanView[]) {
  const latest = plans.at(-1);
  if (!latest || isDashboardPlan(latest.body)) return undefined;
  return { body: latest.body, status: latest.status };
}

/**
 * The instructions of a turn in an alert thread.
 *
 * @param context - The run.
 * @param plans - The thread's plans.
 * @param hints - The person's time zone.
 * @param now - The current instant.
 * @param questions - The person's messages, which trim big connectors' catalogs.
 * @returns The instructions, split for the provider's cache.
 */
export async function alertInstructions(
  context: RunContext,
  plans: readonly PlanView[],
  hints: { readonly timeZone?: string | undefined },
  now: number,
  questions: string,
): Promise<Instructions> {
  const catalog = await context.modelView.catalog(context.signal, questions);
  const draft = currentAlert(context);
  const facts = [
    nowLine(now, hints.timeZone),
    channelsLine(context),
    ...(draft ? [`Current draft, version ${draft.version}:\n${JSON.stringify(draft.spec)}`] : []),
    ...seedLines(context),
    ...linkLines(context),
    canReplay(context) ? replayRule : noReplayRule,
    phaseLine(context, latestAlertPlan(plans)),
  ];
  const lasting = [
    alertPersona,
    alertRules,
    `Connectors and their data (the catalog):\n${catalog}`,
  ];
  const parts = { lasting: lasting.join('\n\n'), turn: facts.join('\n\n') };
  return cachedInstructions(parts, context.settings.provider);
}

/**
 * Every tool of an alert thread; the phase decides which ones a step offers.
 *
 * @param context - The run.
 * @param now - The clock.
 * @returns The tools.
 */
export function alertTurnTools(context: RunContext, now: () => number) {
  const guides = [...context.modelView.guides(), { kind: 'alert', text: alertGuide }];
  return {
    ...dataTools(context, (expression) => resolveTime(expression, now())),
    ...guideTools(guides),
    ...alertTools(context, now),
    ask_person: askPersonTool(context),
    propose_link: proposeLinkTool(context),
  };
}

/**
 * The tools a step of an alert thread offers in a state: the phase's, without the replay when no
 * connector shows numbers, and without `propose_link` when no pinned panel matches the draft.
 *
 * @param context - The run.
 * @returns The tool names.
 */
export function alertActiveTools(context: RunContext): ToolName[] {
  const { state } = context.threads.row(context.threadId);
  const left = new Set<ToolName>();
  if (!canReplay(context)) left.add('replay_alert');
  if (linkLines(context).length === 0) left.add('propose_link');
  return alertPhaseTools[phaseOf(state)].filter((name) => !left.has(name));
}
