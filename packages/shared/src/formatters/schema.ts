/**
 * The formatters a spec may name: an ECharts string template such as `{value} ms`, or a named
 * formatter such as `{ "$fmt": "percent", "decimals": 1 }`. There is no way to write code.
 */
import { z } from 'zod';

/** Validates the decimals of a formatter. */
const decimalsSchema = z.int().min(0).max(10).optional();

/** Validates a named formatter, picked by `$fmt`. */
export const namedFormatterSchema = z.discriminatedUnion('$fmt', [
  z.strictObject({
    $fmt: z.literal('number'),
    decimals: decimalsSchema,
    compact: z.boolean().optional(),
  }),
  z.strictObject({
    $fmt: z.literal('percent'),
    decimals: decimalsSchema,
    input: z.enum(['ratio', 'percent']).optional(),
  }),
  z.strictObject({
    $fmt: z.literal('bytes'),
    base: z.literal([1000, 1024]).optional(),
    decimals: decimalsSchema,
  }),
  z.strictObject({
    $fmt: z.literal('duration'),
    unit: z.enum(['ns', 'us', 'ms', 's']),
    decimals: decimalsSchema,
  }),
  z.strictObject({
    $fmt: z.literal('si'),
    unit: z.string().max(20).optional(),
    decimals: decimalsSchema,
  }),
  z.strictObject({
    $fmt: z.literal('currency'),
    code: z.string().regex(/^[A-Z]{3}$/, 'Use an ISO 4217 code such as EUR.'),
    decimals: decimalsSchema,
  }),
  z.strictObject({
    $fmt: z.literal('datetime'),
    pattern: z.enum(['time', 'date', 'datetime', 'relative']).optional(),
  }),
]);

/** A named formatter. */
export type NamedFormatter = z.infer<typeof namedFormatterSchema>;

/** Validates a formatter: an ECharts string template, or a named formatter. */
export const formatterSchema = z.union([z.string().max(200), namedFormatterSchema]);

/** A formatter: an ECharts string template such as `{value} ms`, or a named formatter. */
export type Formatter = z.infer<typeof formatterSchema>;
