/**
 * The catalog: every connector's schema in a few compact lines, with the values of its
 * low-cardinality fields, as far as each access level allows. It goes into the agent's
 * instructions, so the model starts out knowing the data instead of exploring it call by call.
 */
import type { ConnectorInstance, SchemaSnapshot } from '../connectors/_shared/index.ts';
import { focusedEntities } from './catalog-focus.ts';
import { type ModelEntity, modelSchema } from './model-schema.ts';
import { sampleForModel } from './sample.ts';
import type { GateSubject } from './subject.ts';

/** The most entities the catalog lists per connector; `describe` reaches the rest. */
const maxEntities = 80;

/** Fields with at most this many distinct values get their values listed. */
const listedValues = 20;

/** The most fields sampled per connector. */
const maxSamples = 30;

/** How long sampled values stay fresh. */
const valuesTtlMs = 10 * 60_000;

/** The longest value shown; longer ones are cut. */
const maxValueLength = 40;

/** The longest entity description shown; longer ones are cut. */
const maxDescriptionLength = 200;

/** Control characters, line and paragraph separators, and the runs of spaces around them. */
const breaks = /[\s\p{Cc}\u2028\u2029]+/gu;

/**
 * Text from a source on one line: control characters and line breaks become one space.
 *
 * @param text - The text.
 * @returns The text on one line.
 */
function oneLine(text: string): string {
  return text.replace(breaks, ' ').trim();
}

/**
 * Text from a source on one line, cut to a length.
 *
 * @param text - The text.
 * @param length - The longest text kept.
 * @returns The text, with `…` when cut.
 */
function cut(text: string, length: number): string {
  const line = oneLine(text);
  return line.length > length ? `${line.slice(0, length)}…` : line;
}

/**
 * An entity's description for its line: one line, at most {@link maxDescriptionLength} long.
 *
 * @param entity - The entity.
 * @returns Such as ` Orders.`, or nothing without a description.
 */
function aboutText(entity: ModelEntity): string {
  return entity.description ? ` ${cut(entity.description, maxDescriptionLength)}.` : '';
}

/** One connector as the catalog reads it. */
export interface CatalogSource {
  /** The connector as the gate sees it. */
  readonly subject: GateSubject;
  /** Its query language. */
  readonly language: string;
  /** What its access level lets the model see, in words. */
  readonly access: string;
  /** Its cached schema, or `undefined` when it cannot be read. */
  readonly snapshot: SchemaSnapshot | undefined;
  /** An open instance to sample from, or `undefined` when it cannot be reached. */
  readonly instance: ConnectorInstance | undefined;
}

/** The values of sampled fields, by field key. */
type SampledValues = ReadonlyMap<string, readonly string[]>;

/** A field to sample: where it is, and the key its values are kept under. */
interface SampleTarget {
  /** The key, shared by every metric that carries the same label. */
  readonly key: string;
  /** The entity to sample through. */
  readonly entity: string;
  /** The field. */
  readonly field: string;
}

/**
 * The key a field's values are kept under. Prometheus counts a label's values across all
 * metrics, so a label is sampled once per connector; other fields are sampled per entity.
 *
 * @param entity - The entity.
 * @param field - The field name.
 * @returns The key.
 */
function valueKey(entity: ModelEntity, field: string): string {
  return entity.kind === 'metric' ? `label:${field}` : `${entity.name}.${field}`;
}

/**
 * The fields worth sampling: the ones with few distinct values, once per key, up to the cap.
 *
 * @param entities - The entities as the model sees them (distinct counts only from level 2).
 * @returns The targets.
 */
function sampleTargets(entities: readonly ModelEntity[]): SampleTarget[] {
  const targets = new Map<string, SampleTarget>();
  for (const entity of entities) {
    for (const field of entity.fields) {
      const count = field.distinctValues ?? 0;
      const key = valueKey(entity, field.name);
      if (count < 1 || count > listedValues || targets.has(key)) continue;
      targets.set(key, { key, entity: entity.name, field: field.name });
    }
  }
  return [...targets.values()].slice(0, maxSamples);
}

/**
 * A value list for a line: the values, each cut to a readable length.
 *
 * @param values - The values.
 * @returns Such as `[checkout-svc, cart-svc]`.
 */
function valueList(values: readonly string[]): string {
  return `[${values.map((value) => cut(value, maxValueLength)).join(', ')}]`;
}

/**
 * One table-like entity: its name, kind, size and columns with their types and values.
 *
 * @param entity - The entity.
 * @param values - The sampled values.
 * @returns The line.
 */
function tableLine(entity: ModelEntity, values: SampledValues): string {
  const size = entity.rows === undefined ? '' : `, ~${entity.rows} rows`;
  const columns = entity.fields.map((field) => {
    const listed = values.get(valueKey(entity, field.name));
    return `${oneLine(field.name)} ${field.type}${listed ? ` ${valueList(listed)}` : ''}`;
  });
  return `- ${oneLine(entity.name)} (${entity.kind}${size}):${aboutText(entity)} ${columns.join(', ')}`;
}

/**
 * One metric: its name, description and label names. Label values are listed once, apart.
 *
 * @param entity - The metric.
 * @returns The line.
 */
function metricLine(entity: ModelEntity): string {
  const labels = entity.fields.map((field) => oneLine(field.name)).join(', ');
  return `- ${oneLine(entity.name)}:${aboutText(entity)} labels ${labels || 'none'}`;
}

/**
 * The label values of a connector's metrics, one line.
 *
 * @param values - The sampled values.
 * @returns The line, or nothing when no label was sampled.
 */
function labelValuesLine(values: SampledValues): string[] {
  const labels = [...values]
    .filter(([key]) => key.startsWith('label:'))
    .map(([key, listed]) => `${key.slice('label:'.length)} ${valueList(listed)}`);
  return labels.length === 0 ? [] : [`Label values: ${labels.join('; ')}`];
}

/**
 * One connector's part of the catalog.
 *
 * @param source - The connector.
 * @param entities - Its entities as the model sees them.
 * @param values - The sampled values.
 * @param total - How many entities the connector has, when only some are listed.
 * @returns The lines.
 */
export function connectorCatalog(
  source: Pick<CatalogSource, 'subject' | 'language' | 'access'>,
  entities: readonly ModelEntity[] | undefined,
  values: SampledValues,
  total = entities?.length ?? 0,
): string {
  const { subject } = source;
  const head = `## ${subject.name} (${subject.kind}, ${source.language}): ${source.access}`;
  if (entities === undefined) return `${head}\nThe schema cannot be read right now.`;
  const shown = entities.slice(0, maxEntities);
  const lines = shown.map((entity) =>
    entity.kind === 'metric' ? metricLine(entity) : tableLine(entity, values),
  );
  const more = total - shown.length;
  const rest = more > 0 ? [`(${more} more: call describe with a scope to see them)`] : [];
  return [head, ...lines, ...labelValuesLine(values), ...rest].join('\n');
}

/**
 * Keeps sampled values for a while, so every turn does not sample again.
 *
 * @param now - The clock.
 * @returns Reads a fresh entry, and stores one.
 */
export function createValueCache(now: () => number = Date.now) {
  const entries = new Map<string, { values: readonly string[]; at: number }>();
  return {
    get(key: string): readonly string[] | undefined {
      const entry = entries.get(key);
      return entry && now() - entry.at < valuesTtlMs ? entry.values : undefined;
    },
    set(key: string, values: readonly string[]): void {
      entries.set(key, { values, at: now() });
    },
  };
}

/** The value cache {@link createValueCache} returns. */
export type ValueCache = ReturnType<typeof createValueCache>;

/**
 * Samples a connector's low-cardinality fields, from the cache when fresh. A field that cannot be
 * sampled (level 1, hidden, too many values, an error) is left out.
 *
 * @param source - The connector.
 * @param entities - Its entities as the model sees them.
 * @param cache - The value cache.
 * @param signal - Aborted when the run stops.
 * @returns The values by key.
 */
async function sampleConnector(
  source: CatalogSource,
  entities: readonly ModelEntity[],
  cache: ValueCache,
  signal: AbortSignal,
): Promise<SampledValues> {
  const { instance, subject } = source;
  if (!instance) return new Map();
  const sampled = await Promise.all(
    sampleTargets(entities).map(async (target) => {
      const cacheKey = `${subject.name}:${target.key}`;
      const cached = cache.get(cacheKey);
      if (cached) return [target.key, cached] as const;
      const reference = { entity: target.entity, field: target.field };
      const result = await sampleForModel(subject, instance, reference, listedValues, signal);
      if (!result.ok) return undefined;
      cache.set(cacheKey, result.values);
      return [target.key, result.values] as const;
    }),
  );
  return new Map(sampled.filter((entry) => entry !== undefined));
}

/**
 * The catalog of the connectors.
 *
 * @param sources - The connectors.
 * @param cache - The value cache.
 * @param signal - Aborted when the run stops.
 * @param question - The person's questions in the thread, to trim big connectors to.
 * @returns The catalog text, one section per connector.
 */
export async function buildCatalog(
  sources: readonly CatalogSource[],
  cache: ValueCache,
  signal: AbortSignal,
  question = '',
): Promise<string> {
  if (sources.length === 0) return 'No connectors are set up.';
  const sections = await Promise.all(
    sources.map(async (source) => {
      const all = source.snapshot && modelSchema(source.subject, source.snapshot);
      const entities = all && focusedEntities(all, question);
      const values = entities ? await sampleConnector(source, entities, cache, signal) : new Map();
      return connectorCatalog(source, entities, values, all?.length);
    }),
  );
  return sections.join('\n\n');
}
