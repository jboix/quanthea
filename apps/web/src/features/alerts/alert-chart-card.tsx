/**
 * The alert page's chart: the active version's query replayed over 6 hours, 24 hours or 7 days,
 * with the threshold and the periods it fired. The replay names the saved version, never a query.
 */
import type { AlertDetail } from '@quanthea/shared';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import styles from './alert.module.css';
import type { ReplayOutcome, ReplayWindow } from './data.ts';
import { chartInputOf, firingSummary, maxChartSeries } from './replay-chart.ts';
import { conditionWords } from './words.ts';

/** The chart, loaded with ECharts the first time it draws. */
const AlertChart = lazy(async () => ({
  default: (await import('../../charts/index.ts')).AlertChart,
}));

/** The windows, in order, and how each reads. */
const windows: readonly { readonly id: ReplayWindow; readonly label: string }[] = [
  { id: '6h', label: '6 h' },
  { id: '24h', label: '24 h' },
  { id: '7d', label: '7 d' },
];

/**
 * The chart, or what stands in for it: loading, a refusal, or why the alert can't be replayed.
 *
 * @param props - The replay outcome, the alert and the window.
 * @param props.outcome - The outcome, or `undefined` while it loads.
 * @param props.alert - The alert.
 * @param props.window - The window's words.
 * @returns The chart and its summary.
 */
function ChartBody({
  outcome,
  alert,
  window,
}: {
  readonly outcome: ReplayOutcome | undefined;
  readonly alert: AlertDetail;
  readonly window: string;
}) {
  if (!outcome)
    return <p className={styles.chartNote}>Running its query over the last {window}…</p>;
  if (!outcome.ok) return <p className={styles.chartError}>{outcome.message}</p>;
  const { replay } = outcome;
  if (!replay.replayable) return <p className={styles.chartNote}>{replay.reason}</p>;
  const more = replay.series.length - maxChartSeries;
  return (
    <>
      <div className={styles.chart}>
        <Suspense fallback={null}>
          <AlertChart
            input={chartInputOf(replay, alert)}
            label={`${alert.title} over the last ${window}, with its threshold and when it fired`}
          />
        </Suspense>
      </div>
      <p className={styles.chartNote}>
        {firingSummary(replay, window)}
        {more > 0 &&
          ` The chart shows the ${maxChartSeries} series that fired longest of ${replay.series.length}.`}
      </p>
    </>
  );
}

/**
 * The chart card.
 *
 * @param props - The alert.
 * @param props.alert - The alert.
 * @returns The card.
 */
export function AlertChartCard({ alert }: { readonly alert: AlertDetail }) {
  const [window, setWindow] = useState<ReplayWindow>('24h');
  const version = alert.activeVersion ?? alert.latestVersion ?? alert.versions[0]?.version;
  const url = `/alerts/${alert.id}/v/${version}/replay?window=${window}`;
  const { load, data, state } = useFetcher<ReplayOutcome>({ key: `replay-${alert.id}` });
  useEffect(() => {
    void load(url);
  }, [load, url]);
  const spec = alert.versions.find((each) => each.version === version)?.spec;
  const words = windows.find((each) => each.id === window)?.label ?? window;
  return (
    <section className={styles.card} aria-labelledby="alert-chart-title">
      <div className={styles.cardHead}>
        <h2 id="alert-chart-title" className={styles.cardTitle}>
          Last {words}
        </h2>
        <fieldset className={styles.windows}>
          <legend className={styles.visuallyHidden}>Window</legend>
          {windows.map((each) => (
            <button
              key={each.id}
              type="button"
              className={styles.windowButton}
              aria-pressed={each.id === window}
              onClick={() => setWindow(each.id)}
            >
              {each.label}
            </button>
          ))}
        </fieldset>
      </div>
      <ChartBody outcome={state === 'idle' ? data : undefined} alert={alert} window={words} />
      {spec && (
        // Hand tuning of the threshold and the wait goes here.
        <p className={styles.rule}>
          Fires when {conditionWords(alert.condition, alert.format)}. Checked every {spec.every},
          over the last {spec.lookback} each time.
        </p>
      )}
    </section>
  );
}
