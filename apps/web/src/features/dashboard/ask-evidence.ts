/**
 * What an answer looked at, in a few readable lines: each read's result as the gate let it out,
 * summed up per field (the lowest, the highest and when, spikes, the top values) instead of the
 * raw JSON. A result in a shape this does not know says so in one line.
 */
import { z } from 'zod';
import { instantLabel } from './ask-words.ts';

/** How many frames and fields of a read the lines cover. */
const maxFrames = 3;
const maxFields = 4;

/** The summary of a numeric field. */
const numberSummarySchema = z.object({
  field: z.string(),
  type: z.literal('number'),
  min: z.number().optional(),
  max: z.number().optional(),
  mean: z.number().optional(),
  minAt: z.string().optional(),
  maxAt: z.string().optional(),
  spikeWindows: z
    .array(z.object({ from: z.string(), to: z.string(), peak: z.number() }))
    .optional(),
});

/** The summary of a text field. */
const stringSummarySchema = z.object({
  field: z.string(),
  type: z.literal('string'),
  distinct: z.number(),
  top: z.array(z.object({ value: z.string(), count: z.number() })),
});

/** The summary of a time field. */
const timeSummarySchema = z.object({
  field: z.string(),
  type: z.literal('time'),
  from: z.string().optional(),
  to: z.string().optional(),
});

/** The summary of a boolean field. */
const booleanSummarySchema = z.object({
  field: z.string(),
  type: z.literal('boolean'),
  count: z.number(),
  true: z.number(),
});

/** A field summary in any shape this knows. */
const summarySchema = z.discriminatedUnion('type', [
  numberSummarySchema,
  stringSummarySchema,
  timeSummarySchema,
  booleanSummarySchema,
]);

/** A read's result as the gate gives it. */
const resultSchema = z.union([
  z.object({ ok: z.literal(false), error: z.string() }),
  z.object({
    ok: z.literal(true),
    frames: z
      .array(
        z.object({
          rowCount: z.number(),
          truncated: z.boolean().optional(),
          summaries: z.array(z.unknown()).optional(),
          rows: z.array(z.unknown()).optional(),
        }),
      )
      .optional(),
  }),
]);

/**
 * Formats a number shortly: at most four significant digits, with thousands grouped.
 *
 * @param value - The number.
 * @returns Such as `8.412` or `18,410`.
 */
function shortNumber(value: number): string {
  return value.toLocaleString('en-GB', { maximumSignificantDigits: 4 });
}

/**
 * Formats an ISO time in the time zone, or leaves it as it is when it does not read as one.
 *
 * @param iso - An ISO 8601 time.
 * @param timeZone - An IANA time zone.
 * @returns Such as `26 Sep 14:05`.
 */
function shortTime(iso: string, timeZone: string): string {
  const instant = Date.parse(iso);
  return Number.isNaN(instant) ? iso : instantLabel(instant, timeZone);
}

/**
 * One line about a numeric field.
 *
 * @param summary - The summary.
 * @param timeZone - The time zone of the times.
 * @returns Such as `value min 0.3 · max 8.4 @26 Sep 14:05 · mean 2.1 · spike 14:04–14:41`.
 */
function numberLine(summary: z.infer<typeof numberSummarySchema>, timeZone: string): string {
  const at = (iso: string | undefined) => (iso ? ` @${shortTime(iso, timeZone)}` : '');
  const parts = [
    summary.min === undefined ? '' : `min ${shortNumber(summary.min)}${at(summary.minAt)}`,
    summary.max === undefined ? '' : `max ${shortNumber(summary.max)}${at(summary.maxAt)}`,
    summary.mean === undefined ? '' : `mean ${shortNumber(summary.mean)}`,
    ...(summary.spikeWindows ?? []).slice(0, 2).map((spike) => {
      const window = `${shortTime(spike.from, timeZone)}–${shortTime(spike.to, timeZone)}`;
      return `spike ${window} (peak ${shortNumber(spike.peak)})`;
    }),
  ];
  return `${summary.field} ${parts.filter(Boolean).join(' · ')}`;
}

/**
 * One line about a field.
 *
 * @param raw - The summary, as the gate gave it.
 * @param timeZone - The time zone of the times.
 * @returns The line, or `undefined` for a shape this does not know.
 */
function summaryLine(raw: unknown, timeZone: string): string | undefined {
  const parsed = summarySchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const summary = parsed.data;
  switch (summary.type) {
    case 'number':
      return numberLine(summary, timeZone);
    case 'string': {
      const top = summary.top.slice(0, 3).map((each) => `${each.value} (${each.count})`);
      return `${summary.field} top: ${top.join(', ')} · ${summary.distinct} distinct`;
    }
    case 'time':
      return summary.from && summary.to
        ? `${summary.field} ${shortTime(summary.from, timeZone)} – ${shortTime(summary.to, timeZone)}`
        : `${summary.field} no times`;
    default:
      return `${summary.field} true ${summary.true} of ${summary.count}`;
  }
}

/**
 * The lines of one result frame: its rows, then a line per summarized field.
 *
 * @param frame - The frame.
 * @param timeZone - The time zone of the times.
 * @returns The lines.
 */
function frameLines(
  frame: { rowCount: number; truncated?: boolean | undefined; summaries?: unknown[] | undefined },
  timeZone: string,
): string[] {
  const rows = `${shortNumber(frame.rowCount)} ${frame.rowCount === 1 ? 'row' : 'rows'}`;
  const fields = (frame.summaries ?? [])
    .slice(0, maxFields)
    .flatMap((summary) => summaryLine(summary, timeZone) ?? []);
  return [`${rows}${frame.truncated ? ', cut at the row limit' : ''}`, ...fields];
}

/**
 * Sums up a read's result in a few lines.
 *
 * @param result - What the gate let out.
 * @param timeZone - The time zone of the times.
 * @returns The lines, each once: the error, or the rows and the fields of each frame.
 */
export function evidenceLines(result: unknown, timeZone: string): string[] {
  const parsed = resultSchema.safeParse(result);
  if (!parsed.success) return ['A result in a shape this page cannot show.'];
  if (!parsed.data.ok) return [`Failed: ${parsed.data.error}`];
  const frames = parsed.data.frames ?? [];
  if (frames.length === 0) return ['It ran; its access level shows nothing more.'];
  // Lines repeat only when frames say the same thing; once is enough.
  return [...new Set(frames.slice(0, maxFrames).flatMap((frame) => frameLines(frame, timeZone)))];
}
