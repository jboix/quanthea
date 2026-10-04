/**
 * The tools of an alert thread: propose what to watch, write the alert, and replay it. The
 * thread's state machine decides whether a write may run; the alerts service checks the spec and
 * runs its query once; what the model learns of the result passes through the gate.
 */
import type { AlertPlan, AlertSpec, Repair } from '@quanthea/shared';
import { tool } from 'ai';
import { z } from 'zod';
import { AppError } from '../lib/errors.ts';
import {
  type AlertEdit,
  alertEditSchema,
  currentAlert,
  mergeAlert,
  unknownChannels,
} from './alert-edit.ts';
import type { AlertAuthoring, RunContext } from './run-context.ts';
import { providerSchema } from './tool-schema.ts';

/** An issue with a spec: where, and what is wrong. */
type Issue = { readonly path: string; readonly message: string };

/** Validates what `propose_alert` takes: the alert plan, with channels by id. */
const proposeAlertSchema = z.strictObject({
  title: z.string().min(1).max(200),
  watch: z.string().min(1).max(300),
  connector: z.string().min(1).max(100),
  condition: z.string().min(1).max(300),
  every: z.string().min(1).max(100),
  channels: z.array(z.string().min(1).max(64)).max(20),
  notify: z.string().max(300).optional(),
});

/**
 * The tool that proposes an alert plan.
 *
 * @param context - The run.
 * @returns The tool.
 */
function proposeAlertTool(context: RunContext) {
  return tool({
    description:
      'Propose the alert before writing it: its title, what it watches (in words) on which connector, when it fires (such as "above 2% for 5 minutes"), how often it checks, and the channels by id. The person approves it; then you write it. Call it once, as your last action.',
    inputSchema: providerSchema(proposeAlertSchema),
    execute: (input) => {
      const issues = unknownChannels(context, input.channels);
      if (issues.length > 0) return { error: issues.map((issue) => issue.message).join(' ') };
      const channels = context.channels?.() ?? [];
      const named = input.channels.map((id) => ({
        id,
        name: channels.find((channel) => channel.id === id)?.name ?? id,
      }));
      const body: AlertPlan = { kind: 'alert', ...input, channels: named };
      const autoApprove = !context.settings.behaviour.planApproval;
      const proposed = context.threads.proposePlan(context.threadId, body, autoApprove);
      context.writer.write({
        type: 'data-alertPlan',
        id: proposed.id,
        data: { planId: proposed.id, body },
      });
      context.counters.planPending = !autoApprove;
      const next = autoApprove
        ? 'Approved. Write it now with edit_alert.'
        : 'Waiting for the person to approve. Stop here.';
      return { planId: proposed.id, status: proposed.status, next };
    },
  });
}

/**
 * Why the thread may not write the alert now, if it may not.
 *
 * @param context - The run.
 * @returns The reason, or `undefined` when the write may go ahead.
 */
function alertRefusal(context: RunContext): string | undefined {
  const { state } = context.threads.row(context.threadId);
  if (state === 'building' || state === 'ready') return undefined;
  if (state === 'plan_pending') return 'A plan waits for approval. Stop and let the person decide.';
  return 'Propose the alert with propose_alert first.';
}

/**
 * Counts a failed write, streams it for the build log, and says what the model does next.
 *
 * @param context - The run.
 * @param error - What failed.
 * @param issues - The spec's issues.
 * @returns The failure the model sees.
 */
function failAlert(context: RunContext, error: string, issues: readonly Issue[]) {
  context.counters.failedWrites += 1;
  const attempt = context.counters.failedWrites;
  const of = context.settings.limits.repairAttempts;
  const outcome: Repair['outcome'] = attempt >= of ? 'exhausted' : 'failed';
  const lines = issues.map(({ path, message }) => `${path}: ${message}`).slice(0, 20);
  context.writer.write({
    type: 'data-repair',
    data: { attempt, of, outcome, panels: [], issues: lines },
  });
  const next =
    attempt < of
      ? `Fix it and write again (${of - attempt} attempts left).`
      : 'No attempts left: stop and explain the problem.';
  return { ok: false as const, error: `${error} ${next}`, issues };
}

/**
 * Saves a checked spec as the thread's next alert version, and streams it.
 *
 * @param context - The run.
 * @param spec - The checked spec.
 * @param note - What changed.
 * @returns The alert and the version.
 */
function saveAlert(context: RunContext, spec: AlertSpec, note: string) {
  const alerts = context.alerts as NonNullable<RunContext['alerts']>;
  const alertId = currentAlert(context)?.alertId;
  const { seed } = context.threads.row(context.threadId);
  const input = { spec, note, threadId: context.threadId, ...(alertId ? { alertId } : { seed }) };
  const saved = alerts.saveVersion(input, context.actor);
  context.threads.apply(context.threadId, 'built');
  context.threads.name(context.threadId, spec.title);
  context.writer.write({ type: 'data-alertVersion', data: { ...saved, note } });
  if (context.counters.failedWrites > 0) {
    const { failedWrites: attempt } = context.counters;
    const of = context.settings.limits.repairAttempts;
    const data = { attempt, of, outcome: 'repaired' as const, panels: [], issues: [] };
    context.writer.write({ type: 'data-repair', data });
  }
  return saved;
}

/**
 * Writes the alert: merges the edit over the draft, checks it and runs its query once, saves a new
 * version, and tells the model what the gate lets through of the series.
 *
 * @param context - The run.
 * @param edit - The edit.
 * @returns What the model learns.
 */
async function editAlert(context: RunContext, edit: AlertEdit) {
  const refused = alertRefusal(context);
  if (refused !== undefined || !context.alerts)
    return { ok: false, error: refused ?? 'Alerts are off.' };
  const channelIssues = unknownChannels(context, edit.channels);
  if (channelIssues.length > 0) return failAlert(context, 'Unknown channels.', channelIssues);
  const check = await context.alerts.check(mergeAlert(currentAlert(context)?.spec, edit));
  if (!check.ok) return failAlert(context, 'The alert does not work yet.', check.issues);
  return saveChecked(context, check, edit.note);
}

/**
 * Saves a checked alert, or fails the write when the save refuses it, such as a channel deleted
 * meanwhile.
 *
 * @param context - The run.
 * @param check - The check, passed.
 * @param note - What changed.
 * @returns What the model learns.
 */
function saveChecked(
  context: RunContext,
  check: Extract<Awaited<ReturnType<AlertAuthoring['check']>>, { ok: true }>,
  note: string,
) {
  try {
    const { version } = saveAlert(context, check.spec, note);
    const series = context.modelView.alertCheck(check.spec.query.connector, check.series);
    return { ok: true, version, now: series, truncated: check.truncated };
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'bad_request') throw error;
    return failAlert(context, error.message, issuesOf(error));
  }
}

/**
 * The issues an application error carries, if any.
 *
 * @param error - The error.
 * @returns The issues.
 */
function issuesOf(error: AppError): Issue[] {
  if (!Array.isArray(error.details)) return [];
  return (error.details as Issue[]).map(({ path, message }) => ({ path, message }));
}

/**
 * The tool that writes the alert.
 *
 * @param context - The run.
 * @returns The tool.
 */
function editAlertTool(context: RunContext) {
  return tool({
    description:
      'Write the alert as a new draft version: the whole alert the first time, then only the fields that change, with a one-line note. The server checks the spec and runs the query once; you get the series it would watch now, as your access level allows, or the issues to fix.',
    inputSchema: providerSchema(alertEditSchema),
    execute: (edit) => editAlert(context, edit),
  });
}

/** How far back a replay looks. */
const replayWindows = { '24h': 86_400_000, '7d': 7 * 86_400_000 } as const;

/**
 * The spec to replay: the draft, at another threshold when one is given.
 *
 * @param spec - The draft's spec.
 * @param threshold - Another threshold to try, if any.
 * @returns The spec, or why the threshold cannot be tried.
 */
function replayed(spec: AlertSpec, threshold: number | undefined): AlertSpec | string {
  if (threshold === undefined) return spec;
  if (spec.condition.kind !== 'threshold') return 'This alert has no threshold to move.';
  return { ...spec, condition: { ...spec.condition, value: threshold } };
}

/**
 * Replays the draft and summarizes it through the gate.
 *
 * @param context - The run.
 * @param window - How far back.
 * @param threshold - Another threshold to try, if any.
 * @param now - The current instant.
 * @returns The summary, or why not.
 */
async function replayAlert(
  context: RunContext,
  window: keyof typeof replayWindows,
  threshold: number | undefined,
  now: number,
) {
  const draft = currentAlert(context);
  if (!draft || !context.alerts)
    return { ok: false, error: 'Write the alert with edit_alert first.' };
  const spec = replayed(draft.spec, threshold);
  if (typeof spec === 'string') return { ok: false, error: spec };
  try {
    const request = { from: now - replayWindows[window], to: now };
    const replay = await context.alerts.replaySpec(spec, request);
    return context.modelView.alertReplay(spec.query.connector, replay);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { ok: false, error: error.message };
  }
}

/**
 * The tool that replays the draft.
 *
 * @param context - The run.
 * @param now - The clock.
 * @returns The tool.
 */
function replayAlertTool(context: RunContext, now: () => number) {
  return tool({
    description:
      'Replay the draft over the last 24 hours or 7 days: how many times it would have fired, for how long, and the spikes too short to fire, for the series that fired most. Pass a threshold to try another one without saving it.',
    inputSchema: z.strictObject({
      window: z.enum(['24h', '7d']).default('7d'),
      threshold: z.number().optional(),
    }),
    execute: ({ window, threshold }) => replayAlert(context, window, threshold, now()),
  });
}

/**
 * Creates the alert tools of a run.
 *
 * @param context - The run.
 * @param now - The clock, for the replay's window.
 * @returns The tools.
 */
export function alertTools(context: RunContext, now: () => number) {
  return {
    propose_alert: proposeAlertTool(context),
    edit_alert: editAlertTool(context),
    replay_alert: replayAlertTool(context, now),
  };
}
