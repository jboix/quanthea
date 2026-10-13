/**
 * Tones and value mappings: how a value becomes a text and a colour. A tone names a colour of the
 * theme, so a spec never holds a colour of its own and reads well in the light and the dark
 * scheme. A threshold is a list of mappings whose matches are ranges.
 */
import { z } from 'zod';

/**
 * The tones a value can take: a state (`good`, `warning`, `bad`), no state (`neutral`), or one of
 * the eight series colours.
 */
export const tones = [
  'neutral',
  'good',
  'warning',
  'bad',
  'series1',
  'series2',
  'series3',
  'series4',
  'series5',
  'series6',
  'series7',
  'series8',
] as const;

/** A tone: the name of a theme colour. */
export type Tone = (typeof tones)[number];

/** What a match must be, said once for every way of getting it wrong. */
const matchProblem =
  'A match is one of { "value": a text, a number or a boolean }, { "null": true }, or a range of numbers { "from"?, "to"? } with at least one bound and "from" below "to".';

/**
 * What a mapping matches, in one flat form: a value, no value, or a range of numbers whose `from`
 * is included and whose `to` is not. It is a type alias, so it reads as the JSON it is.
 */
type Match = {
  /** The value to equal, as it reads. */
  value?: string | number | boolean | undefined;
  /** `true` to match no value. */
  null?: true | undefined;
  /** The start of a range, included. */
  from?: number | undefined;
  /** The end of a range, excluded. */
  to?: number | undefined;
};

/** The keys a match may hold. */
const matchKeys = new Set(['value', 'null', 'from', 'to']);

/**
 * Whether a part of a match is a bound of a range, or left out.
 *
 * @param bound - The part.
 * @returns Whether it is a finite number or nothing.
 */
function isBound(bound: unknown): boolean {
  return bound === undefined || (typeof bound === 'number' && Number.isFinite(bound));
}

/**
 * Whether a part of a match is a value to equal, or left out.
 *
 * @param value - The part.
 * @returns Whether it is a text of at most 200 characters, a number, a boolean or nothing.
 */
function isMatchValue(value: unknown): boolean {
  if (typeof value === 'string') return value.length <= 200;
  return value === undefined || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * Whether every part of a match has the type it takes, and no other part is there.
 *
 * @param match - The match, as written.
 * @returns Whether its parts are well formed.
 */
function hasMatchParts(match: Readonly<Record<string, unknown>>): boolean {
  if (!Object.keys(match).every((key) => matchKeys.has(key))) return false;
  if (match.null !== undefined && match.null !== true) return false;
  return isMatchValue(match.value) && isBound(match.from) && isBound(match.to);
}

/**
 * Whether a match says exactly one thing: a value, no value, or a range that holds a number.
 *
 * @param match - A match whose parts are well formed.
 * @returns Whether it is one kind of match, and a range that is not empty.
 */
function isOneMatch(match: Match): boolean {
  const ranged = match.from !== undefined || match.to !== undefined;
  const kinds = [match.value !== undefined, match.null === true, ranged];
  if (kinds.filter(Boolean).length !== 1) return false;
  return match.from === undefined || match.to === undefined || match.from < match.to;
}

/**
 * Whether something is a match. It is checked in code and not by a schema of its fields, so every
 * way of getting it wrong gets the one sentence that says what a match is.
 *
 * @param input - What a spec holds as a match.
 * @returns Whether it is a match.
 */
function isMatch(input: unknown): input is Match {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const match = input as Readonly<Record<string, unknown>>;
  return hasMatchParts(match) && isOneMatch(match as Match);
}

/** Validates what a mapping matches. */
const matchSchema = z.custom<Match>(isMatch, matchProblem);

/**
 * Validates a mapping: what it matches, and the text or the tone a matching value takes, or both.
 */
const mappingSchema = z
  .strictObject({
    match: matchSchema,
    text: z
      .string()
      .max(100)
      .regex(/\S/, 'The "text" of a mapping holds something to show.')
      .optional(),
    tone: z.enum(tones).optional(),
  })
  .refine(
    (mapping) => mapping.text !== undefined || mapping.tone !== undefined,
    'A mapping gives a "text", a "tone", or both.',
  );

/** A mapping: what it matches, and the text and the tone of a value that matches. */
export type Mapping = z.infer<typeof mappingSchema>;

/** Validates the mappings of a column, a stat or a gauge: at most twenty, read in order. */
export const mappingsSchema = z.array(mappingSchema).max(20);

/** Validates how a tone is drawn: as the colour of the text, or as a tint behind it. */
export const toneAsSchema = z.enum(['text', 'background']);

/** How a tone is drawn. */
export type ToneAs = z.infer<typeof toneAsSchema>;

/** A text that writes a plain decimal number, such as `12`, `-0.5` or the `200.00` of a SQL source. */
const decimalText = /^-?\d+(\.\d+)?$/;

/**
 * The number a value stands for.
 *
 * @param value - A value of a result.
 * @returns The number, or `undefined` for anything that is not a finite number or a text that
 *   writes a plain decimal, such as the decimals a SQL source returns as text. An identifier
 *   that happens to read as a number in another notation, such as `0x1F` or `1e3`, is no number.
 */
function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !decimalText.test(value.trim())) return undefined;
  return Number(value);
}

/**
 * Whether a value is in a range.
 *
 * @param match - The range: `from` included, `to` excluded, either left out for an open end.
 * @param value - A value of a result.
 * @returns Whether the value is a number in the range.
 */
function inRange(match: Match, value: unknown): boolean {
  const number = numberOf(value);
  if (number === undefined) return false;
  return number >= (match.from ?? -Infinity) && number < (match.to ?? Infinity);
}

/**
 * Whether a value is the one a match names. A text, a number and a boolean are compared as they
 * read, so `"200"` matches the number 200 and `true` matches the text `"true"`. A number is also
 * equal to a text that writes it another way, so 200 matches `"200.00"`.
 *
 * @param expected - The value the match names.
 * @param value - A value of a result.
 * @returns Whether they read the same.
 */
function sameValue(expected: string | number | boolean, value: unknown): boolean {
  if (!['string', 'number', 'boolean'].includes(typeof value)) return false;
  if (String(value) === String(expected)) return true;
  if (typeof expected !== 'number' && typeof value !== 'number') return false;
  const number = numberOf(value);
  return number !== undefined && number === numberOf(expected);
}

/**
 * Whether a mapping's match holds for a value.
 *
 * @param match - The match.
 * @param value - A value of a result.
 * @returns Whether the value matches.
 */
function matches(match: Match, value: unknown): boolean {
  if (match.null) return value === null || value === undefined;
  if (match.value !== undefined) return sameValue(match.value, value);
  return inRange(match, value);
}

/**
 * The mapping of a value: the first whose match holds.
 *
 * @param mappings - The mappings, in order; none when left out.
 * @param value - A value of a result, as the source returned it, before any format.
 * @returns The first mapping that matches, or `undefined` when none does.
 */
export function mapValue(
  mappings: readonly Mapping[] | undefined,
  value: unknown,
): Mapping | undefined {
  return mappings?.find((mapping) => matches(mapping.match, value));
}

/**
 * Whether a mapping is a step of a dial: a range with a tone. A dial draws no text and places no
 * single value, so a gauge takes no other mapping.
 *
 * @param mapping - The mapping.
 * @returns Whether a dial can draw it.
 */
export function isStep(mapping: Mapping): boolean {
  const { from, to } = mapping.match;
  return mapping.tone !== undefined && (from !== undefined || to !== undefined);
}
