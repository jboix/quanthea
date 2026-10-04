/**
 * A small history of a report's first headline number over its latest runs: one bar per run, the
 * latest marked, drawn from the stored runs' numbers. Nothing runs to draw it.
 */
import type { ReportListItem } from '@quanthea/shared';
import styles from './reports.module.css';

/** The drawing's width and height, in its own units. */
const width = 160;
const height = 32;

/** The gap between bars. */
const gap = 4;

/**
 * Each bar's height, scaled from zero to the highest number; a missing number draws no bar.
 *
 * @param values - The numbers, oldest first.
 * @returns The heights.
 */
export function barHeights(values: readonly (number | null)[]): number[] {
  const numbers = values.filter((value): value is number => value !== null);
  const top = Math.max(...numbers.map(Math.abs), 0);
  return values.map((value) => {
    if (value === null || top === 0) return 0;
    return Math.max(2, (Math.abs(value) / top) * height);
  });
}

/**
 * The history, or nothing with fewer than two runs to compare.
 *
 * @param props - The history.
 * @param props.history - The first headline number of each run, oldest first.
 * @returns The bars.
 */
export function ValueHistory({ history }: { readonly history: ReportListItem['history'] }) {
  if (history.length < 2) return <span />;
  const slot = width / history.length;
  const heights = barHeights(history.map((point) => point.value));
  const label = `The last ${history.length} runs: ${history.map((point) => point.label).join('; ')}`;
  return (
    <svg
      className={styles.history}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
    >
      {history.map((point, index) => (
        <rect
          key={point.runId}
          x={index * slot + gap / 2}
          y={height - (heights[index] ?? 0)}
          width={slot - gap}
          height={heights[index] ?? 0}
          data-latest={index === history.length - 1}
        />
      ))}
    </svg>
  );
}
