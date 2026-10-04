/**
 * One turn in a report thread: its instructions and its tools. The instructions carry what lasts
 * first (who the agent is there, its rules, the panel guide once it writes, the catalog), then the
 * turn's facts: the time, the channels it may send to, the pinned dashboards it may link, the
 * draft, and what the phase asks.
 */
import { type PlanView, type ReportPlan, resolveTime } from '@quanthea/shared';
import type { Instructions } from 'ai';
import { askPersonTool } from './ask-tool.ts';
import { cachedInstructions } from './cache.ts';
import { chartTools } from './chart-tools.ts';
import { dataTools } from './data-tools.ts';
import { guideTools } from './guide-tools.ts';
import { panelGuideFor } from './panel-guide.ts';
import { phaseOf, reportPhaseTools, type ToolName } from './phases.ts';
import { nowLine } from './prompt.ts';
import { currentReport } from './report-edit.ts';
import {
  reportBuildingRules,
  reportEditingRules,
  reportGuide,
  reportPersona,
  reportPlanningRules,
  reportRules,
} from './report-prompt.ts';
import { pinnedChoices, reportTools } from './report-tools.ts';
import type { RunContext } from './run-context.ts';

/** How the panel guide's tool reads in a report thread. */
const panelsInReports =
  'In this conversation, panels go into edit_report: everything said here of edit_dashboard and its panels holds for them, except the time range, which is the period.';

/**
 * The channels the report may be sent to, in a line.
 *
 * @param context - The run.
 * @returns The line.
 */
function channelsLine(context: RunContext): string {
  const channels = context.channels?.() ?? [];
  if (channels.length === 0)
    return 'Channels: none yet. An admin adds them in Settings → Notifications; leave "channels" empty.';
  const listed = channels.map((channel) => `${channel.id} ("${channel.name}", ${channel.kind})`);
  return `Channels you may send to, by id: ${listed.join(', ')}.`;
}

/**
 * The pinned dashboards the report may link to, in a line.
 *
 * @param context - The run.
 * @returns The line.
 */
function pinnedLine(context: RunContext): string {
  const pinned = pinnedChoices(context);
  if (pinned.length === 0) return 'Pinned dashboards: none yet; leave "seeAlso" empty.';
  const listed = pinned.map((dashboard) => `${dashboard.id} ("${dashboard.title}")`);
  return `Pinned dashboards you may link, by id: ${listed.join(', ')}.`;
}

/**
 * What the thread's phase asks of the agent now.
 *
 * @param context - The run.
 * @param plan - The latest report plan, if any, and its status.
 * @returns The phase's rules.
 */
function phaseLine(context: RunContext, plan: { body: ReportPlan; status: string } | undefined) {
  const { state } = context.threads.row(context.threadId);
  if (state === 'plan_pending')
    return `${reportPlanningRules}\nA plan waits for the person to approve it. Answer questions about it, and propose a new one if they ask for changes.`;
  if (state === 'building' && plan?.status === 'approved')
    return `${reportBuildingRules}\nThe approved plan:\n${JSON.stringify(plan.body)}`;
  if (state === 'ready') return reportEditingRules;
  return `${reportPlanningRules}\nNo plan yet.`;
}

/**
 * The latest plan of the thread, when it is a report plan.
 *
 * @param plans - The thread's plans.
 * @returns The plan and its status.
 */
function latestReportPlan(plans: readonly PlanView[]) {
  const body = plans.at(-1)?.body;
  if (!body || !('kind' in body) || body.kind !== 'report') return undefined;
  return { body, status: plans.at(-1)?.status ?? 'pending' };
}

/**
 * The panel guide, once the thread writes: the queries and charts the thread may use.
 *
 * @param context - The run.
 * @returns The guide, or nothing while planning.
 */
function writingGuide(context: RunContext): string[] {
  const { state } = context.threads.row(context.threadId);
  if (phaseOf(state) === 'planning') return [];
  const languages = [...new Set(context.modelView.connectors().map((each) => each.language))];
  const facts = { queries: context.queries, charts: context.charts, languages };
  return [panelGuideFor({ ...facts, guides: context.modelView.guides() }), panelsInReports];
}

/**
 * The instructions of a turn in a report thread.
 *
 * @param context - The run.
 * @param plans - The thread's plans.
 * @param hints - The person's time zone.
 * @param now - The current instant.
 * @param questions - The person's messages, which trim big connectors' catalogs.
 * @returns The instructions, split for the provider's cache.
 */
export async function reportInstructions(
  context: RunContext,
  plans: readonly PlanView[],
  hints: { readonly timeZone?: string | undefined },
  now: number,
  questions: string,
): Promise<Instructions> {
  const catalog = await context.modelView.catalog(context.signal, questions);
  const draft = currentReport(context);
  const facts = [
    nowLine(now, hints.timeZone),
    channelsLine(context),
    pinnedLine(context),
    ...(draft ? [`Current draft, version ${draft.version}:\n${JSON.stringify(draft.spec)}`] : []),
    phaseLine(context, latestReportPlan(plans)),
  ];
  const catalogPart = `Connectors and their data (the catalog):\n${catalog}`;
  const lasting = [reportPersona, reportRules, ...writingGuide(context), catalogPart];
  const parts = { lasting: lasting.join('\n\n'), turn: facts.join('\n\n') };
  return cachedInstructions(parts, context.settings.provider);
}

/**
 * Every tool of a report thread; the phase decides which ones a step offers.
 *
 * @param context - The run.
 * @param now - The clock.
 * @returns The tools.
 */
export function reportTurnTools(context: RunContext, now: () => number) {
  const guides = [...context.modelView.guides(), { kind: 'report', text: reportGuide }];
  return {
    ...dataTools(context, (expression) => resolveTime(expression, now())),
    ...guideTools(guides),
    ...chartTools(context.charts),
    ...reportTools(context, now),
    ask_person: askPersonTool(context),
  };
}

/**
 * The tools a step of a report thread offers in a state: the phase's.
 *
 * @param context - The run.
 * @returns The tool names.
 */
export function reportActiveTools(context: RunContext): ToolName[] {
  const { state } = context.threads.row(context.threadId);
  return [...reportPhaseTools[phaseOf(state)]];
}
