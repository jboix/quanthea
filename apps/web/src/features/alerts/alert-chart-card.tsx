/**
 * The alert page's chart: the active version's query replayed over 6 hours, 24 hours or 7 days,
 * with the threshold and the periods it fired. The replay names the saved version, never a query.
 * On a live alert an editor drags the threshold and changes the condition's values under it; the
 * chart replays the values again in the browser, and the page holds the changes unsaved.
 */
import type { AlertDetail, AlertSpec } from '@quanthea/shared';
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { useFetcher } from 'react-router';
import {
  asReplayed,
  byFiring,
  ConditionSentence,
  type Replayed,
  seriesUnder,
  type TrackedSeries,
  TunableChart,
} from '../alert-draft/index.ts';
import styles from './alert.module.css';
import type { ReplayOutcome, ReplayWindow } from './data.ts';
import { changedSummary, chartInputOf, firingSummary, maxChartSeries } from './replay-chart.ts';
import { useAlertChange } from './use-alert-change.ts';
import type { Tuning } from './use-tuning.ts';
import { conditionWords } from './words.ts';

/** The chart, loaded with ECharts the first time it draws. */
const AlertChart = lazy(async () => ({
  default: (await import('../../charts/index.ts')).AlertChart,
}));

/** The windows, in order, how each reads on its button, and how the unsaved bar names it. */
export const windows: readonly {
  readonly id: ReplayWindow;
  readonly label: string;
  readonly name: string;
}[] = [
  { id: '6h', label: '6 h', name: 'Last 6 hours' },
  { id: '24h', label: '24 h', name: 'Last 24 hours' },
  { id: '7d', label: '7 d', name: 'Last 7 days' },
];

/**
 * Loads the replay of the version shown over a window.
 *
 * @param alert - The alert.
 * @param window - The window.
 * @returns The outcome, or `undefined` while it loads.
 */
export function useAlertReplay(alert: AlertDetail, window: ReplayWindow) {
  const version = alert.activeVersion ?? alert.latestVersion ?? alert.versions[0]?.version;
  const url = `/alerts/${alert.id}/v/${version}/replay?window=${window}`;
  const { load, data, state } = useFetcher<ReplayOutcome>({ key: `replay-${alert.id}` });
  useEffect(() => {
    void load(url);
  }, [load, url]);
  return state === 'idle' ? data : undefined;
}

/**
 * How each series behaves on the chart: as replayed, or replayed again under the changes.
 *
 * @param replay - The replay of the active version.
 * @param unsaved - The spec with the changes not saved, if any.
 * @returns The series, those that fired longest first.
 */
function tracksOf(replay: Replayed, unsaved: AlertSpec | undefined): TrackedSeries[] {
  if (unsaved?.condition.kind !== 'threshold') return byFiring(asReplayed(replay));
  return byFiring(seriesUnder(replay, unsaved.condition, unsaved.every));
}

/** Props of {@link TunedView}. */
interface TunedViewProps {
  /** The replay of the active version. */
  readonly replay: Replayed;
  /** The alert. */
  readonly alert: AlertDetail;
  /** The page's hand tuning, with the saved spec. */
  readonly tuning: Tuning & { readonly saved: NonNullable<Tuning['saved']> };
  /** The window's words. */
  readonly window: string;
}

/**
 * The chart with the threshold to drag, and how often it fired, or would with the changes.
 *
 * @param props - The replay, the alert, the tuning and the window.
 * @returns The chart and its note.
 */
function TunedView({ replay, alert, tuning, window }: TunedViewProps) {
  const { busy } = useAlertChange();
  const tracks = useMemo(() => tracksOf(replay, tuning.unsaved), [replay, tuning.unsaved]);
  const drawn = useMemo(() => tracks.slice(0, maxChartSeries), [tracks]);
  const { condition } = tuning.shown ?? tuning.saved;
  const note = tuning.unsaved
    ? changedSummary(
        tracks.map((each) => each.track),
        window,
      )
    : firingSummary(replay, window);
  return (
    <>
      <TunableChart
        replay={replay}
        spec={tuning.saved}
        series={tracks}
        drawn={drawn}
        threshold={condition.kind === 'threshold' ? condition.value : null}
        label={`${alert.title} over the last ${window}, with its threshold to drag`}
        disabled={busy}
        onMove={tuning.drag}
        onRelease={tuning.release}
      />
      <p className={styles.chartNote} aria-live="polite">
        {note}
      </p>
    </>
  );
}

/**
 * The chart as it was replayed, for whoever can't tune it here.
 *
 * @param props - The replay, the alert and the window.
 * @param props.replay - The replay.
 * @param props.alert - The alert.
 * @param props.window - The window's words.
 * @returns The chart and how often it fired.
 */
function ReplayedView({
  replay,
  alert,
  window,
}: {
  readonly replay: Replayed;
  readonly alert: AlertDetail;
  readonly window: string;
}) {
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

/** Props of {@link ChartBody}. */
interface ChartBodyProps {
  /** The replay's outcome, or `undefined` while it loads. */
  readonly outcome: ReplayOutcome | undefined;
  /** The alert. */
  readonly alert: AlertDetail;
  /** The page's hand tuning. */
  readonly tuning: Tuning;
  /** The window's words. */
  readonly window: string;
}

/**
 * The chart, or what stands in for it: loading, a refusal, or why the alert can't be replayed.
 *
 * @param props - The replay outcome, the alert, the tuning and the window.
 * @returns The chart and its summary.
 */
function ChartBody({ outcome, alert, tuning, window }: ChartBodyProps) {
  if (!outcome)
    return <p className={styles.chartNote}>Running its query over the last {window}…</p>;
  if (!outcome.ok) return <p className={styles.chartError}>{outcome.message}</p>;
  const { replay } = outcome;
  if (!replay.replayable) return <p className={styles.chartNote}>{replay.reason}</p>;
  const { saved } = tuning;
  if (saved)
    return (
      <TunedView replay={replay} alert={alert} tuning={{ ...tuning, saved }} window={window} />
    );
  return <ReplayedView replay={replay} alert={alert} window={window} />;
}

/**
 * The condition under the chart: values to change for an editor on a live alert, else a line.
 *
 * @param props - The alert and the tuning.
 * @param props.alert - The alert.
 * @param props.tuning - The page's hand tuning.
 * @returns The sentence or the line.
 */
function ConditionLine({
  alert,
  tuning,
}: {
  readonly alert: AlertDetail;
  readonly tuning: Tuning;
}) {
  const { busy } = useAlertChange();
  const version = alert.activeVersion ?? alert.latestVersion ?? alert.versions[0]?.version;
  const spec = alert.versions.find((each) => each.version === version)?.spec;
  const { base } = tuning;
  if (base) {
    // The editors start from the values held, so new values start them again.
    const key = JSON.stringify([base.condition, base.every]);
    return (
      <div className={styles.tuning}>
        <ConditionSentence
          key={key}
          spec={base}
          threshold={tuning.dragged}
          disabled={busy}
          onChange={tuning.change}
          saveLabel="Apply, not saved yet"
          fixed={['watch', 'by']}
        />
      </div>
    );
  }
  if (!spec) return null;
  return (
    <p className={styles.rule}>
      Fires when {conditionWords(alert.condition, alert.format)}. Checked every {spec.every}, over
      the last {spec.lookback} each time.
    </p>
  );
}

/** Props of {@link AlertChartCard}. */
interface AlertChartCardProps {
  /** The alert. */
  readonly alert: AlertDetail;
  /** The page's hand tuning. */
  readonly tuning: Tuning;
  /** The window shown. */
  readonly window: ReplayWindow;
  /** Picks another window. */
  readonly onWindow: (window: ReplayWindow) => void;
  /** The replay over the window, or `undefined` while it loads. */
  readonly outcome: ReplayOutcome | undefined;
}

/**
 * The chart card.
 *
 * @param props - The alert, the tuning, the window and its replay.
 * @returns The card.
 */
export function AlertChartCard({ alert, tuning, window, onWindow, outcome }: AlertChartCardProps) {
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
              onClick={() => onWindow(each.id)}
            >
              {each.label}
            </button>
          ))}
        </fieldset>
      </div>
      <ChartBody outcome={outcome} alert={alert} tuning={tuning} window={words} />
      <ConditionLine alert={alert} tuning={tuning} />
    </section>
  );
}
