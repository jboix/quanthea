/** How the schema panel counts and labels entities and fields. */
import { lowCardinalityLimit, type SchemaView, timeOrDayTime } from '@quanthea/shared';

/** One entity of a schema view. */
type SchemaEntity = SchemaView['entities'][number];

/** One field of a schema entity. */
type SchemaField = SchemaEntity['fields'][number];

/** The word for an entity's fields, by entity kind. */
const fieldNouns: Readonly<Record<SchemaEntity['kind'], string>> = {
  table: 'column',
  view: 'column',
  metric: 'label',
  index: 'field',
  endpoint: 'field',
  collection: 'field',
};

/** Row counts in full up to this, compact (`8.2M`) above. */
const compactFrom = 1_000_000;

/**
 * Counts things in words.
 *
 * @param count - How many.
 * @param noun - The singular noun.
 * @returns Such as `1 column` or `14 columns`.
 */
export function countOf(count: number, noun: string): string {
  return `${count.toLocaleString('en')} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Formats a row count.
 *
 * @param rows - The estimated row count.
 * @returns Such as `3,410` or `8.2M`.
 */
function rowCount(rows: number): string {
  const notation = rows >= compactFrom ? 'compact' : 'standard';
  return new Intl.NumberFormat('en', { notation, maximumFractionDigits: 1 }).format(rows);
}

/**
 * The line to the right of an entity's name.
 *
 * @param entity - The entity.
 * @returns Such as `14 columns · 8.2M rows` or `11 columns · 1 hidden`.
 */
export function entitySummary(entity: SchemaEntity): string {
  const fields = countOf(entity.fields.length, fieldNouns[entity.kind]);
  const hidden = entity.fields.filter((field) => field.hidden).length;
  if (hidden > 0) return `${fields} · ${hidden} hidden`;
  if (entity.rows !== undefined) return `${fields} · ${rowCount(entity.rows)} rows`;
  return fields;
}

/**
 * The line that counts a schema's entities.
 *
 * @param schema - The schema.
 * @returns Such as `6 tables` or `412 metrics`.
 */
export function schemaSummary(schema: SchemaView): string {
  const kinds = new Set(schema.entities.map((entity) => entity.kind));
  const [kind] = kinds;
  const noun = kinds.size === 1 && kind !== undefined ? kind : 'entity';
  return noun === 'entity'
    ? `${schema.entities.length} entities`
    : countOf(schema.entities.length, noun);
}

/** What the panel says about a field, and how. */
export interface FieldMarker {
  /** The words. */
  readonly text: string;
  /** `accent` for values the model gets, `danger` for hidden, `muted` otherwise. */
  readonly tone: 'accent' | 'danger' | 'muted';
}

/**
 * What the panel says about what the model gets of a field.
 *
 * @param field - The field.
 * @returns The marker, or `undefined` when the model gets the name only, as usual.
 */
export function fieldMarker(field: SchemaField): FieldMarker | undefined {
  if (field.hidden) return { text: 'hidden', tone: 'danger' };
  const distinct = field.distinctValues;
  if (distinct === undefined) return undefined;
  if (field.modelSees === 'values')
    return { text: `${countOf(distinct, 'value')} shared`, tone: 'accent' };
  if (distinct > lowCardinalityLimit) return { text: 'high cardinality', tone: 'muted' };
  return undefined;
}

/**
 * When the schema was read, in words.
 *
 * @param readAt - Epoch milliseconds.
 * @param now - The current time.
 * @returns The time for today, else the date and time.
 */
export function readTime(readAt: number, now = Date.now()): string {
  return timeOrDayTime(readAt, now);
}
