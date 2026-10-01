/**
 * The static checks of a connector kind: what it declares, without a source. The loader runs them
 * on every plugin's kinds at startup, the installer before it keeps a plugin, and the conformance
 * suite in every kind's tests, so a kind that passes its own tests passes the loader. A plugin may
 * return an object it did not build with `defineConnector`, so nothing is taken for granted.
 */
import { queryLanguages } from '@querent/shared';
import { z } from 'zod';
import { sqlDialects, sqlPlaceholderStyles, sqlRowLimits } from './queries.ts';

/** What a kind identifier looks like. */
const kindPattern = /^[a-z][a-z0-9-]{0,39}$/;

/** SVG path data: commands and numbers, nothing else. */
const pathPattern = /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,\s+-]+$/;

/** A colour as `#rrggbb`. */
const colorPattern = /^#[0-9a-fA-F]{6}$/;

/** The longest query guide, which the agent reads whole. */
const maxGuideLength = 8192;

/** A kind as the checks read it, whatever it really is. */
type Candidate = Readonly<Record<string, unknown>>;

/**
 * Whether a list holds a value.
 *
 * @param list - The list.
 * @param value - The value.
 * @returns `true` when it does.
 */
function oneOf(list: readonly string[], value: unknown): boolean {
  return typeof value === 'string' && list.includes(value);
}

/** A check: whether a kind breaks it, and what to say. */
type Check = readonly [(kind: Candidate) => boolean, string];

/** The checks of the identifier, the name, the aliases and the guide. */
const namingChecks: readonly Check[] = [
  [
    (kind) => typeof kind.kind !== 'string' || !kindPattern.test(kind.kind),
    'kind must be lowercase letters, digits and dashes, up to 40 characters',
  ],
  [
    (kind) => typeof kind.displayName !== 'string' || kind.displayName.trim() === '',
    'displayName must be a name',
  ],
  [
    (kind) => {
      const aliases = kind.aliases ?? [];
      return !Array.isArray(aliases) || !aliases.every((alias) => typeof alias === 'string');
    },
    'aliases must be a list of names',
  ],
  [
    (kind) =>
      kind.queryGuide !== undefined &&
      (typeof kind.queryGuide !== 'string' || kind.queryGuide.length > maxGuideLength),
    `queryGuide must be text of at most ${maxGuideLength} characters`,
  ],
];

/** The checks of the language and, for SQL, the dialect and its styles. */
const languageChecks: readonly Check[] = [
  [
    (kind) => !oneOf(queryLanguages, kind.language),
    `language must be one of ${queryLanguages.join(', ')}`,
  ],
  [
    (kind) => kind.language === 'sql' && !oneOf(sqlDialects, kind.dialect),
    `a SQL kind's dialect must be one of ${sqlDialects.join(', ')}`,
  ],
  [
    (kind) => kind.language !== 'sql' && kind.dialect !== undefined,
    'only a SQL kind declares a dialect',
  ],
  [
    (kind) =>
      kind.placeholders !== undefined &&
      !(kind.dialect === 'ansi' && oneOf(sqlPlaceholderStyles, kind.placeholders)),
    `placeholders is for ansi only: ${sqlPlaceholderStyles.join(', ')}`,
  ],
  [
    (kind) =>
      kind.rowLimit !== undefined &&
      !(kind.dialect === 'ansi' && oneOf(sqlRowLimits, kind.rowLimit)),
    'rowLimit is for ansi only: fetch or limit',
  ],
];

/**
 * Whether a value is an icon: path data and a colour.
 *
 * @param icon - The value.
 * @returns `true` for an icon.
 */
function isIcon(icon: unknown): boolean {
  if (typeof icon !== 'object' || icon === null) return false;
  const { path, color } = icon as { path?: unknown; color?: unknown };
  return (
    typeof path === 'string' &&
    pathPattern.test(path) &&
    typeof color === 'string' &&
    colorPattern.test(color)
  );
}

/** The checks of the icon and the functions. */
const shapeChecks: readonly Check[] = [
  [
    (kind) => kind.icon !== undefined && !isIcon(kind.icon),
    'icon must be SVG path data and a #rrggbb colour',
  ],
  [(kind) => typeof kind.open !== 'function', 'open must be a function'],
  [
    (kind) => kind.describeTarget !== undefined && typeof kind.describeTarget !== 'function',
    'describeTarget must be a function',
  ],
];

/**
 * The property names of an object schema, or `undefined` when it is not one the forms can use.
 *
 * @param schema - The schema.
 * @returns The names.
 */
function propertiesOf(schema: unknown): string[] | undefined {
  if (!(schema instanceof z.ZodType)) return undefined;
  try {
    const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as {
      type?: unknown;
      properties?: Record<string, unknown>;
    };
    return json.type === 'object' ? Object.keys(json.properties ?? {}) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The problems of the two schemas: object schemas built with the kit's Zod, the configuration
 * with at least one field, and no credential among the configuration's fields.
 *
 * @param kind - The kind.
 * @returns The problems.
 */
function schemaProblems(kind: Candidate): string[] {
  const config = propertiesOf(kind.configSchema);
  const secret = propertiesOf(kind.secretSchema);
  const problems: string[] = [];
  if (!config || config.length === 0)
    problems.push("configSchema must be an object schema with fields, built with the kit's z");
  if (!secret) problems.push("secretSchema must be an object schema, built with the kit's z");
  const shared = (config ?? []).filter((name) => (secret ?? []).includes(name));
  if (shared.length > 0) problems.push(`credentials in configSchema: ${shared.join(', ')}`);
  return problems;
}

/**
 * Everything wrong with what a kind declares.
 *
 * @param kind - The kind, as a plugin returned it.
 * @returns The problems, empty when it passes.
 */
export function kindProblems(kind: unknown): string[] {
  if (typeof kind !== 'object' || kind === null) return ['a kind must be an object'];
  const candidate = kind as Candidate;
  const failed = [...namingChecks, ...languageChecks, ...shapeChecks]
    .filter(([breaks]) => breaks(candidate))
    .map(([, message]) => message);
  return [...failed, ...schemaProblems(candidate)];
}
