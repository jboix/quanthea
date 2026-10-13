/**
 * The chart speed page, served by the development server only: a dashboard's worth of time charts
 * on made-up data, drawn by the chart component as a panel draws them, with a meter the measuring
 * script reads. `?points=20000&charts=12&kind=line` chooses what it draws.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Chart } from '../chart.tsx';
import { type SpeedKind, speedInputs, speedKinds } from './speed-data.ts';
import { createChartMeter } from './speed-meter.ts';
import styles from './speed-page.module.css';

/**
 * A whole number from the URL, within bounds.
 *
 * @param text - The parameter, if given.
 * @param fallback - The number when it is missing or not a number.
 * @param most - The largest number allowed.
 * @returns The number.
 */
function count(text: string | null, fallback: number, most: number): number {
  const parsed = Number.parseInt(text ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, most) : fallback;
}

/**
 * The page.
 *
 * @returns The charts, two to a row as half-width panels are.
 */
export function ChartSpeedPage() {
  const [parameters] = useSearchParams();
  const points = count(parameters.get('points'), 1000, 200_000);
  const charts = count(parameters.get('charts'), 12, 48);
  const asked = parameters.get('kind') as SpeedKind;
  const kind = speedKinds.includes(asked) ? asked : 'line';
  const panels = useMemo(
    () =>
      speedInputs(kind, points, charts).map((input, index) => ({
        label: `Chart ${index + 1}`,
        input,
      })),
    [kind, points, charts],
  );
  // The meter starts with the first render, so it sees the first draw.
  const [meter] = useState(() => createChartMeter(performance.now()));
  useEffect(() => {
    window.chartSpeed = meter;
  }, [meter]);
  return (
    <main className={styles.page}>
      {panels.map(({ label, input }) => (
        <section key={label} className={styles.panel} data-speed-chart>
          <Chart input={input} timeZone="UTC" label={label} />
        </section>
      ))}
    </main>
  );
}
