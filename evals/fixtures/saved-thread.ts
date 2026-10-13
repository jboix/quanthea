/**
 * A thread that already wrote an alert or a report, built from a recorded one: what the person
 * asked, the plan they approved, the version saved and what the agent said. It is stored through
 * the app's own services and checked by its schemas, so a recording an app change made stale fails
 * when it loads, not quietly later. No model is called.
 */
import {
  type AlertPlan,
  alertPlanSchema,
  alertSpecSchema,
  type ReportPlan,
  reportPlanSchema,
  reportSpecSchema,
} from '@quanthea/shared';
import { zurich } from '../world/incident.ts';
import { type EvalWorld, evalsActor } from '../world/setup.ts';
import alertCheckoutShare from './data/alert-checkout-share.json' with { type: 'json' };
import reportDailyOrders from './data/report-daily-orders.json' with { type: 'json' };

/** The name a recording writes for the world's one notification channel. */
export const channelAlias = 'evals-channel';

/** What every recording holds. */
interface Recorded {
  /** What the person asked. */
  readonly ask: string;
  /** What the agent said once the version was saved. */
  readonly said: string;
  /** The plan the person approved, as JSON. */
  readonly plan: unknown;
  /** The version saved, as JSON. */
  readonly spec: unknown;
}

/** The recordings, by name. Each is a file a recording run rewrites (`--record`). */
export const recordings = {
  'alert-checkout-share': { kind: 'alert', data: alertCheckoutShare },
  'report-daily-orders': { kind: 'report', data: reportDailyOrders },
} as const;

/** The name of a recording. */
export type RecordingName = keyof typeof recordings;

/**
 * A recording with the world's channel in place of its alias.
 *
 * @param world - The world.
 * @param data - The recording, as its file holds it.
 * @returns The recording, ready for this world's services.
 * @throws {Error} When the recording holds no question or no answer.
 */
function inWorld(world: EvalWorld, data: unknown): Recorded {
  const text = JSON.stringify(data).replaceAll(channelAlias, world.channelId);
  const { ask, said, plan, spec } = JSON.parse(text) as Partial<Recorded>;
  if (typeof ask !== 'string' || typeof said !== 'string' || ask === '' || said === '')
    throw new Error('A recording needs what the person asked and what the agent said.');
  return { ask, said, plan, spec };
}

/**
 * The two messages of a recorded talk, as the thread stores them.
 *
 * @param ask - What the person asked.
 * @param said - What the agent said.
 * @returns The messages.
 */
function messagesOf(ask: string, said: string) {
  const metadata = { mentions: [], timeZone: zurich };
  return [
    { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: ask }], metadata },
    { id: crypto.randomUUID(), role: 'assistant', parts: [{ type: 'text', text: said }] },
  ];
}

/**
 * Starts a thread, stores the recorded talk, and approves the recorded plan.
 *
 * @param world - The world.
 * @param kind - What the thread writes.
 * @param talk - The recording.
 * @param plan - Its plan, checked.
 * @returns The thread's id, waiting for its version.
 */
function startThread(
  world: EvalWorld,
  kind: 'alert' | 'report',
  talk: Recorded,
  plan: AlertPlan | ReportPlan,
): string {
  const { threads } = world.services;
  const { id } = threads.create(evalsActor, null, undefined, { kind, seed: undefined });
  threads.saveMessages(id, messagesOf(talk.ask, talk.said), evalsActor);
  threads.proposePlan(id, plan, true);
  return id;
}

/**
 * A thread that wrote the recorded alert.
 *
 * @param world - The world.
 * @param name - The recording.
 * @returns The thread's id.
 */
export function alertThread(world: EvalWorld, name: RecordingName): string {
  const talk = inWorld(world, recordings[name].data);
  const threadId = startThread(world, 'alert', talk, alertPlanSchema.parse(talk.plan));
  const spec = alertSpecSchema.parse(talk.spec);
  world.services.alerts.saveVersion({ spec, threadId }, evalsActor);
  world.services.threads.apply(threadId, 'built');
  world.services.threads.name(threadId, spec.title);
  return threadId;
}

/**
 * A thread that wrote the recorded report.
 *
 * @param world - The world.
 * @param name - The recording.
 * @returns The thread's id and the report's.
 */
export function reportThread(
  world: EvalWorld,
  name: RecordingName,
): { threadId: string; reportId: string } {
  const talk = inWorld(world, recordings[name].data);
  const threadId = startThread(world, 'report', talk, reportPlanSchema.parse(talk.plan));
  const spec = reportSpecSchema.parse(talk.spec);
  const { reportId } = world.services.reports.saveVersion({ spec, threadId }, evalsActor);
  world.services.threads.apply(threadId, 'built');
  world.services.threads.name(threadId, spec.title);
  return { threadId, reportId };
}
