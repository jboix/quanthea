/**
 * What `edit_alert` takes and how it lands on the draft: the fields to set, merged over the
 * thread's latest alert version. `value`, `notify` and `message` merge field by field; the rest
 * replace. The merged spec is checked as a whole by the alerts service.
 */
import {
  type AlertSpec,
  alertConditionSchema,
  alertSeverities,
  alertSpecSchema,
  alertVariableSchema,
  durationSchema,
  namedFormatterSchema,
  queryTemplateSchema,
} from '@quanthea/shared';
import { z } from 'zod';
import type { RunContext } from './run-context.ts';

/** Validates the fields of `value` to change; none has a default, so a field left out stays. */
const valueEditSchema = z.strictObject({
  field: z.string().min(1).max(200).optional(),
  reduce: z.enum(['last', 'max', 'min', 'mean', 'sum']).optional(),
  by: z.array(z.string().min(1).max(200)).max(10).optional(),
  maxSeries: z.int().min(1).max(1000).optional(),
  format: namedFormatterSchema.optional(),
});

/** Validates the fields of `notify` to change. */
const notifyEditSchema = z.strictObject({
  onResolved: z.boolean().optional(),
  repeatEvery: durationSchema.optional(),
});

/** Validates the parts of the message to change; placeholders are checked on the whole spec. */
const messageEditSchema = z.strictObject({
  title: z.string().min(1).max(150).optional(),
  body: z.string().min(1).max(1000).optional(),
  fields: z
    .array(z.strictObject({ label: z.string().min(1).max(60), value: z.string().min(1).max(200) }))
    .max(8)
    .optional(),
});

/** Validates an edit of the alert: what changed in a line, and the fields to set. */
export const alertEditSchema = z.strictObject({
  /** What changed, in one line, for the version's note. */
  note: z.string().min(1).max(200),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  query: queryTemplateSchema.optional(),
  value: valueEditSchema.optional(),
  variables: z.array(alertVariableSchema).max(20).optional(),
  condition: alertConditionSchema.optional(),
  every: durationSchema.optional(),
  lookback: durationSchema.optional(),
  severity: z.enum(alertSeverities).optional(),
  channels: z.array(z.string().min(1).max(64)).max(20).optional(),
  notify: notifyEditSchema.optional(),
  message: messageEditSchema.optional(),
  timezone: z.string().min(1).max(64).optional(),
});

/** An edit of the alert. */
export type AlertEdit = z.infer<typeof alertEditSchema>;

/** The thread's latest alert version. */
export interface AlertDraft {
  /** The alert. */
  readonly alertId: string;
  /** The version. */
  readonly version: number;
  /** Its spec. */
  readonly spec: AlertSpec;
}

/**
 * The thread's latest alert version, if it has one.
 *
 * @param context - The run.
 * @returns The draft.
 */
export function currentAlert(context: RunContext): AlertDraft | undefined {
  const { alertId } = context.threads.row(context.threadId);
  if (alertId === null || !context.alerts) return undefined;
  const { versions } = context.alerts.get(alertId, 'editor');
  const latest = versions.reduce<(typeof versions)[number] | undefined>(
    (found, each) => (found && found.version > each.version ? found : each),
    undefined,
  );
  if (!latest) return undefined;
  return { alertId, version: latest.version, spec: alertSpecSchema.parse(latest.spec) };
}

/**
 * Merges an edit over the draft: `value`, `notify` and `message` field by field, the rest
 * replaced. A query gets the refId alerts use.
 *
 * @param current - The draft's spec, if any.
 * @param edit - The edit.
 * @returns The merged spec, as JSON for the alerts service to check.
 */
export function mergeAlert(current: AlertSpec | undefined, edit: AlertEdit): unknown {
  const { note: _note, value, notify, message, query, ...replaced } = edit;
  const base: Record<string, unknown> = current ? { ...current } : { specVersion: 1 };
  return {
    ...base,
    ...replaced,
    ...(query ? { query: { ...query, refId: 'A' } } : {}),
    ...(value ? { value: { ...(current?.value ?? {}), ...value } } : {}),
    ...(notify ? { notify: { ...(current?.notify ?? {}), ...notify } } : {}),
    ...(message ? { message: { ...(current?.message ?? {}), ...message } } : {}),
  };
}

/**
 * The channel ids an edit names that no channel has.
 *
 * @param context - The run.
 * @param channels - The ids, if the edit sets them.
 * @returns The issues, at each unknown id's path.
 */
export function unknownChannels(
  context: RunContext,
  channels: readonly string[] | undefined,
): { path: string; message: string }[] {
  const known = new Set((context.channels?.() ?? []).map((channel) => channel.id));
  return (channels ?? []).flatMap((id, index) =>
    known.has(id)
      ? []
      : [{ path: `channels[${index}]`, message: `No channel "${id}". Use an id from the list.` }],
  );
}
