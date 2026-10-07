/**
 * The log lines of a LogQL log query, as one table: the time, the line, and a column per label,
 * the stream's and those the pipeline extracted, newest first.
 */
import type { Field, Frame } from '@quanthea/shared';
import { createFrameBuilder, type ExecutionContext } from '../_shared/index.ts';

/** One stream of a log query's answer. */
export interface Stream {
  /** The labels. */
  readonly stream: Readonly<Record<string, string>>;
  /** The entries: nanoseconds as text, and the line. */
  readonly values: readonly (readonly [string, string])[];
}

/** The most label columns a table of lines gets. */
const maxLabels = 50;

/** One line with its stream's labels. */
interface Entry {
  /** Epoch nanoseconds. */
  readonly nanoseconds: bigint;
  /** The line. */
  readonly line: string;
  /** The labels. */
  readonly labels: Readonly<Record<string, string>>;
}

/**
 * The label columns of the streams: every label but Loki's internal ones, in name order.
 *
 * @param streams - The streams.
 * @returns The label names.
 */
function labelNames(streams: readonly Stream[]): string[] {
  const names = new Set(streams.flatMap((stream) => Object.keys(stream.stream)));
  return [...names]
    .filter((name) => !name.startsWith('__'))
    .sort()
    .slice(0, maxLabels);
}

/**
 * The table of the lines a log query returned.
 *
 * @param streams - The streams of the answer.
 * @param context - The execution context.
 * @param durationMs - How long the query took.
 * @param capped - Whether Loki may have held back lines: it returned as many as it was asked for.
 * @returns The frame.
 */
export function streamsFrame(
  streams: readonly Stream[],
  context: ExecutionContext,
  durationMs: number,
  capped: boolean,
): Frame {
  const labels = labelNames(streams);
  const fields: Field[] = [
    { name: 'time', type: 'time' },
    { name: 'line', type: 'string' },
    ...labels.map((name) => ({ name, type: 'string' as const })),
  ];
  const entries: Entry[] = streams.flatMap((stream) =>
    stream.values.map(([time, line]) => ({
      nanoseconds: BigInt(time),
      line,
      labels: stream.stream,
    })),
  );
  entries.sort((a, b) => {
    if (a.nanoseconds === b.nanoseconds) return 0;
    return a.nanoseconds > b.nanoseconds ? -1 : 1;
  });
  const builder = createFrameBuilder({ refId: context.refId, fields, maxRows: context.maxRows });
  for (const entry of entries) {
    const row = [
      Number(entry.nanoseconds / 1_000_000n),
      entry.line,
      ...labels.map((name) => entry.labels[name] ?? null),
    ];
    if (!builder.add(row)) break;
  }
  const frame = builder.build(durationMs);
  return capped ? { ...frame, meta: { ...frame.meta, truncated: true } } : frame;
}
