/**
 * Reads the shape of Loki: the stream labels with their value counts, the fields Loki detects in
 * the lines, and how many lines there are, over the last day. One entity, `logs`, holds them.
 */
import type { FieldType } from '@quanthea/shared';
import type { SchemaField, SchemaSnapshot } from '../_shared/index.ts';
import type { LokiApi } from './api.ts';

/** A field Loki detects in the lines. */
interface DetectedField {
  /** Its name in a query, such as `route` or `level_extracted`. */
  readonly label: string;
  /** Its type: `string`, `int`, `float`, `duration`, `bytes` or `boolean`. */
  readonly type: string;
  /** How many values it has, estimated. */
  readonly cardinality?: number;
  /** The parsers that extract it, such as `json`; none for structured metadata. */
  readonly parsers?: readonly string[] | null;
}

/** A label or field name Loki allows. */
export const labelPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** How far back the catalog looks, in milliseconds. */
const windowMs = 86_400_000;

/** The most labels whose values are counted. */
const maxLabels = 50;

/** Detected field types whose values are numbers. */
const numberTypes = new Set(['int', 'float', 'duration', 'bytes']);

/**
 * The time window of the catalog, in nanoseconds.
 *
 * @returns The start and end parameters.
 */
export function catalogWindow(): { start: string; end: string } {
  const end = BigInt(Date.now()) * 1_000_000n;
  return { start: `${end - BigInt(windowMs) * 1_000_000n}`, end: `${end}` };
}

/**
 * The stream labels, without Loki's internal ones.
 *
 * @param api - The API.
 * @param signal - The caller's signal.
 * @returns The label names.
 */
export async function streamLabels(api: LokiApi, signal: AbortSignal): Promise<string[]> {
  const answer = await api.get<{ data?: string[] }>('/loki/api/v1/labels', catalogWindow(), signal);
  return (answer.data ?? []).filter((name) => !name.startsWith('__') && labelPattern.test(name));
}

/**
 * The schema field of a stream label, with its value count.
 *
 * @param api - The API.
 * @param name - The label.
 * @param signal - The caller's signal.
 * @returns The field.
 */
async function labelField(api: LokiApi, name: string, signal: AbortSignal): Promise<SchemaField> {
  const answer = await api
    .get<{ data?: string[] }>(`/loki/api/v1/label/${name}/values`, catalogWindow(), signal)
    .catch(() => ({ data: undefined }));
  const count = answer.data?.length;
  return {
    name,
    nativeType: 'stream label',
    type: 'string',
    ...(count === undefined ? {} : { distinctEstimate: count }),
  };
}

/**
 * The schema field of a detected field.
 *
 * @param field - The detected field.
 * @returns The field.
 */
function detectedField(field: DetectedField): SchemaField {
  const parsers = field.parsers?.length ? field.parsers.join(', ') : 'structured metadata';
  const type: FieldType = numberTypes.has(field.type) ? 'number' : 'string';
  return {
    name: field.label,
    nativeType: `${parsers} ${field.type}`,
    type,
    ...(field.cardinality === undefined ? {} : { distinctEstimate: field.cardinality }),
  };
}

/**
 * Reads the schema.
 *
 * @param api - The API.
 * @param signal - The caller's signal.
 * @returns One entity, `logs`, with the labels and the detected fields.
 */
export async function describeLoki(api: LokiApi, signal: AbortSignal): Promise<SchemaSnapshot> {
  const labels = await streamLabels(api, signal);
  if (labels.length === 0) return { entities: [] };
  const selector = `{${labels.includes('service_name') ? 'service_name' : labels[0]}=~".+"}`;
  const window = { ...catalogWindow(), query: selector };
  const [labelFields, detected, stats] = await Promise.all([
    Promise.all(labels.slice(0, maxLabels).map((name) => labelField(api, name, signal))),
    api
      .get<{ fields?: DetectedField[] }>('/loki/api/v1/detected_fields', window, signal)
      .catch(() => ({ fields: [] })),
    api
      .get<{ entries?: number }>('/loki/api/v1/index/stats', window, signal)
      .catch((): { entries?: number } => ({})),
  ]);
  const fields = (detected.fields ?? []).filter((field) => !labels.includes(field.label));
  const entity = {
    name: 'logs',
    kind: 'index' as const,
    description:
      'Select streams by label, such as {service="checkout"}; parse the other fields with | json or | logfmt.',
    ...(stats.entries === undefined ? {} : { rowEstimate: stats.entries }),
    fields: [...labelFields, ...fields.map(detectedField)],
  };
  return { entities: [entity] };
}
