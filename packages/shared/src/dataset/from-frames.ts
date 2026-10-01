/**
 * Query results as datasets. A result with one frame is its table. A result with a frame per
 * series, as a Prometheus range query returns, becomes one long table: the x, a column per label,
 * a `series` column naming the series, and the `value`.
 */
import type { Field, Frame } from '@quanthea/plugin-kit/contract';
import type { Cell, Dataset, Dimension } from './contract.ts';

/**
 * The columns of a frame.
 *
 * @param fields - The frame's fields.
 * @returns The columns.
 */
function dimensionsOf(fields: readonly Field[]): Dimension[] {
  return fields.map(({ name, type, unit }) =>
    unit === undefined ? { name, type } : { name, type, unit },
  );
}

/**
 * One frame as a table.
 *
 * @param frame - The frame.
 * @returns The table.
 */
function tableOfFrame(frame: Frame): Dataset {
  const source = Array.from({ length: frame.meta.rowCount }, (_row, index) =>
    frame.values.map((column) => (column[index] ?? null) as Cell),
  );
  return { dimensions: dimensionsOf(frame.fields), source };
}

/**
 * The name of a frame's series: its label values, else its name, else its reference.
 *
 * @param frame - The frame.
 * @returns Such as `checkout-svc · 502`.
 */
export function seriesNameOf(frame: Frame): string {
  const labels = frame.fields.find(
    (field) => field.labels && Object.keys(field.labels).length > 0,
  )?.labels;
  if (labels) return Object.values(labels).join(' · ');
  return frame.name ?? frame.refId;
}

/**
 * Whether frames are one series each: an x and one number, the same columns in each.
 *
 * @param frames - The frames.
 * @returns Whether they are series to stack into one long table.
 */
function areSeries(frames: readonly Frame[]): boolean {
  const [first] = frames;
  if (first?.fields.length !== 2) return false;
  // One frame is a series when its value carries labels, as Prometheus frames do.
  if (frames.length === 1 && first.fields[1]?.labels === undefined) return false;
  const shape = first.fields.map((field) => field.type).join();
  return (
    shape.endsWith(',number') &&
    frames.every((frame) => frame.fields.map((field) => field.type).join() === shape)
  );
}

/**
 * Frames of one series each, stacked into one long table.
 *
 * @param frames - The frames.
 * @returns The long table: x, the label columns, series, value.
 */
function longOfSeries(frames: readonly Frame[]): Dataset {
  const [first] = frames;
  const x = first?.fields[0] ?? { name: 'x', type: 'string' as const };
  const labelsOf = (frame: Frame) => frame.fields[1]?.labels ?? {};
  const labelNames = [...new Set(frames.flatMap((frame) => Object.keys(labelsOf(frame))))].sort();
  const reserved = new Set([x.name, 'series', 'value']);
  const labels = labelNames.filter((name) => !reserved.has(name));
  const dimensions: Dimension[] = [
    { name: x.name, type: x.type },
    ...labels.map((name) => ({ name, type: 'string' as const })),
    { name: 'series', type: 'string' },
    {
      name: 'value',
      type: 'number',
      ...(first?.fields[1]?.unit ? { unit: first.fields[1].unit } : {}),
    },
  ];
  const source = frames.flatMap((frame) =>
    tableOfFrame(frame).source.map((row) => [
      row[0] ?? null,
      ...labels.map((name) => labelsOf(frame)[name] ?? null),
      seriesNameOf(frame),
      row[1] ?? null,
    ]),
  );
  return { dimensions, source };
}

/**
 * A query's frames as one dataset.
 *
 * @param frames - The frames of one query.
 * @returns The dataset; an empty one-column table when there are no frames.
 */
export function datasetOfFrames(frames: readonly Frame[]): Dataset {
  const [first] = frames;
  if (!first) return { dimensions: [{ name: 'value', type: 'number' }], source: [] };
  if (areSeries(frames)) return longOfSeries(frames);
  return tableOfFrame(first);
}
