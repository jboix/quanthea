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
const tones = [
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
  'A match is one of { "value": a text, a number or a boolean }, { "null": true }, or a range { "from"?, "to"? } with at least one bound and "from" below "to".';

/**
 * What a mapping matches, in one flat form: a value, no value, or a range of numbers whose `from`
 * is included and whose `to` is not.
 */
const matchSchema = z
  .strictObject({
    value: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
    null: z.literal(true).optional(),
    from: z.number().optional(),
    to: z.number().optional(),
  })
  .refine(isOneMatch, matchProblem);

/** What a mapping matches. */
type Match = z.infer<typeof matchSchema>;

/**
 * Whether a match says exactly one thing: a value, no value, or a range that holds a number.
 *
 * @param match - The match, with any of its fields.
 * @returns Whether it is one kind of match, and a range that is not empty.
 */
function isOneMatch(match: {
  value?: unknown;
  null?: true | undefined;
  from?: number | undefined;
  to?: number | undefined;
}): boolean {
  const ranged = match.from !== undefined || match.to !== undefined;
  const kinds = [match.value !== undefined, match.null === true, ranged];
  if (kinds.filter(Boolean).length !== 1) return false;
  return match.from === undefined || match.to === undefined || match.from < match.to;
}

/**
 * Validates a mapping: what it matches, and the text or the tone a matching value takes, or both.
 */
const mappingSchema = z
  .strictObject({
    match: matchSchema,
    text: z.string().max(100).optional(),
    tone: z.enum(tones).optional(),
  })
  .refine(
    (mapping) => mapping.text !== undefined || mapping.tone !== undefined,
    'A mapping gives a "text", a "tone", or both.',
  );

/** A mapping: what it matches, and the text and the tone of a value that matches. */
export type Mapping = z.infer<typeof mappingSchema>;

/** Validates the mappings of a column: at most twenty, read in order. */
export const mappingsSchema = z.array(mappingSchema).max(20);

/** Validates how a tone is drawn: as the colour of the text, or as a tint behind it. */
export const toneAsSchema = z.enum(['text', 'background']);

/** How a tone is drawn. */
export type ToneAs = z.infer<typeof toneAsSchema>;

/**
 * The number a value stands for, for a range.
 *
 * @param value - A value of a result.
 * @returns The number, or `undefined` for anything that is not a finite number or a text that
 *   writes one, such as the decimals a SQL source returns as text.
 */
function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
 * read, so `"200"` matches the number 200 and `true` matches the text `"true"`.
 *
 * @param expected - The value the match names.
 * @param value - A value of a result.
 * @returns Whether they read the same.
 */
function sameValue(expected: string | number | boolean, value: unknown): boolean {
  if (!['string', 'number', 'boolean'].includes(typeof value)) return false;
  return String(value) === String(expected);
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
