/**
 * What `edit_alert` takes and how it lands on the draft: the fields to set, merged over the
 * thread's latest alert version. `value`, `notify` and `message` merge field by field; the rest
 * replace, `quietHours: 'default'` takes the alert's own quiet hours away, and
 * `dividedBy: 'none'` the second query of a ratio. The merged spec is
 * checked as a whole by the alerts service.
 */
import {
  type AlertSpec,
  alertConditionInputSchema,
  alertQuietHoursSchema,
  alertSeverities,
  alertSpecSchema,
  alertVariableSchema,
  durationSchema,
  maxTemplateFields,
  namedFormatterSchema,
  queryTemplateSchema,
  ratioZeroRules,
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

/**
 * Validates the second query of a ratio, as an edit sets it: the whole of it, replaced. `none`
 * takes the ratio away.
 */
const dividedByEditSchema = z.union([
  z.literal('none'),
  z.strictObject({
    query: queryTemplateSchema,
    field: z.string().min(1).max(200).optional(),
    by: z.array(z.string().min(1).max(200)).max(10).optional(),
    whenZero: z.enum(ratioZeroRules).optional(),
  }),
]);

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
    .max(maxTemplateFields)
    .optional(),
});

/** Validates an edit of the alert: what changed in a line, and the fields to set. */
export const alertEditSchema = z.strictObject({
  /** What changed, in one line, for the version's note. */
  note: z.string().min(1).max(200),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  query: queryTemplateSchema.optional(),
  /** The second query of a ratio, or `none` to watch the query alone again. */
  dividedBy: dividedByEditSchema.optional(),
  value: valueEditSchema.optional(),
  variables: z.array(alertVariableSchema).max(20).optional(),
  /** The condition, in the smaller schema of a tool's input; the spec's check holds it. */
  condition: alertConditionInputSchema.optional(),
  every: durationSchema.optional(),
  lookback: durationSchema.optional(),
  severity: z.enum(alertSeverities).optional(),
  channels: z.array(z.string().min(1).max(64)).max(20).optional(),
  notify: notifyEditSchema.optional(),
  message: messageEditSchema.optional(),
  timezone: z.string().min(1).max(64).optional(),
  /** Its own quiet hours, `none` to always notify, or `default` to follow the alert settings. */
  quietHours: z.union([z.literal('default'), alertQuietHoursSchema]).optional(),
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
 * A merged spec with the quiet hours it keeps: its own, or none of its own for `default`.
 *
 * @param merged - The merged spec, without quiet hours.
 * @param quietHours - What the edit or the draft says of them.
 * @returns The spec.
 */
function withQuietHours(merged: Record<string, unknown>, quietHours: unknown): unknown {
  const followsDefault = quietHours === undefined || quietHours === 'default';
  return followsDefault ? merged : { ...merged, quietHours };
}

/**
 * A merged spec with the second query of a ratio the edit asks for: the edit's, with the refId
 * alerts give it, the draft's when the edit says nothing, or none for `none`.
 *
 * @param merged - The merged spec, with the draft's second query if it has one.
 * @param edit - What the edit says of it.
 * @returns The spec.
 */
function withDivisor(
  merged: Record<string, unknown>,
  edit: AlertEdit['dividedBy'],
): Record<string, unknown> {
  if (edit === undefined) return merged;
  const { dividedBy: _dividedBy, ...rest } = merged;
  if (edit === 'none') return rest;
  return { ...rest, dividedBy: { ...edit, query: { ...edit.query, refId: 'B' } } };
}

/**
 * Merges an edit over the draft: `value`, `notify` and `message` field by field, the rest
 * replaced. A query gets the refId alerts use, `quietHours: 'default'` leaves the spec without
 * quiet hours of its own, and `dividedBy: 'none'` without a second query.
 *
 * @param current - The draft's spec, if any.
 * @param edit - The edit.
 * @returns The merged spec, as JSON for the alerts service to check.
 */
export function mergeAlert(current: AlertSpec | undefined, edit: AlertEdit): unknown {
  const { note: _note, value, notify, message, query, dividedBy, ...replaced } = edit;
  const base: Record<string, unknown> = current ? { ...current } : { specVersion: 1 };
  const { quietHours, ...merged } = {
    ...base,
    ...replaced,
    ...(query ? { query: { ...query, refId: 'A' } } : {}),
    ...(value ? { value: { ...(current?.value ?? {}), ...value } } : {}),
    ...(notify ? { notify: { ...(current?.notify ?? {}), ...notify } } : {}),
    ...(message ? { message: { ...(current?.message ?? {}), ...message } } : {}),
  };
  return withQuietHours(withDivisor(merged, dividedBy), quietHours);
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
