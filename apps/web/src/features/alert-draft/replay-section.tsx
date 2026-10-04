/**
 * The replay of the draft: the last 24 hours or 7 days as it would have fired, with the threshold
 * as a dashed line a person drags. While it moves, the browser replays the values again with the
 * server's rules, so the shading, the spikes and the summary follow at once; the release saves it.
 */
import { type AlertSpec, alertValueText } from '@quanthea/shared';
import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import type { ValueAxis } from '../../charts/index.ts';
import styles from './alert-draft.module.css';
import { type Replayed, summarize, summaryText, type TrackedSeries } from './replay-model.ts';
import { ThresholdHandle } from './threshold-handle.tsx';

/** The chart, loaded with ECharts the first time it draws. */
const AlertChart = lazy(async () => ({
  default: (await import('../../charts/index.ts')).AlertChart,
}));

/** The windows a person picks from. */
export const draftWindows = ['24h', '7d'] as const;

/** A window of the replay. */
export type DraftWindow = (typeof draftWindows)[number];

/** What a replay load answers, as the alert pages' replay route returns it. */
export type ReplayOutcome =
  | { readonly ok: true; readonly replay: Replayed | { replayable: false; reason: string } }
  | { readonly ok: false; readonly message: string };

/** Props of {@link ReplayChart}. */
interface ReplayChartProps {
  /** The replay. */
  readonly replay: Replayed;
  /** The draft's spec. */
  readonly spec: AlertSpec;
  /** Every series at the threshold shown, those that fired longest first. */
  readonly series: readonly TrackedSeries[];
  /** The series the chart draws. */
  readonly drawn: readonly TrackedSeries[];
  /** The threshold shown, or `null` for a condition without one. */
  readonly threshold: number | null;
  /** Whether the threshold can move. */
  readonly disabled: boolean;
  /** Called with each value while the threshold moves. */
  readonly onMove: (value: number) => void;
  /** Called with the threshold to save. */
  readonly onRelease: (value: number) => void;
}

/**
 * A series' name: its label values, or `all`.
 *
 * @param labels - The labels.
 * @returns Such as `checkout-svc`.
 */
export function seriesName(labels: Readonly<Record<string, string>>): string {
  const values = Object.values(labels);
  return values.length > 0 ? values.join(', ') : 'all';
}

/**
 * What the chart draws: the series that fired longest, and when each series fired at the
 * threshold shown. The saved threshold keeps the value axis; the handle draws the line.
 *
 * @param props - The replay, the spec and the series.
 * @param format - Writes a value as the alert's format does.
 * @returns The chart's input.
 */
function chartInput(
  props: Pick<ReplayChartProps, 'replay' | 'spec' | 'series' | 'drawn'>,
  format: (value: number) => string,
) {
  const { replay, spec, series, drawn } = props;
  return {
    series: drawn.map((each) => ({ name: seriesName(each.labels), points: each.track.points })),
    threshold: spec.condition.kind === 'threshold' ? spec.condition.value : null,
    // The handle draws the threshold, where it is being dragged.
    thresholdLine: false,
    firing: series.flatMap((each) => each.track.firing.map(({ from, to }) => ({ from, to }))),
    format,
    from: replay.from,
    to: replay.to,
  };
}

/**
 * Writes a value as the alert's format does, the same function while the spec stays.
 *
 * @param spec - The spec.
 * @returns The writer.
 */
function useFormat(spec: AlertSpec): (value: number) => string {
  return useCallback((value: number) => alertValueText(spec, value) || String(value), [spec]);
}

/**
 * The chart with the draggable threshold, and the summary under it.
 *
 * @param props - The replay, the spec, the series, the threshold and the callbacks.
 * @returns The chart and its summary.
 */
export function ReplayChart(props: ReplayChartProps) {
  const { replay, spec, series, drawn, threshold } = props;
  const [axis, setAxis] = useState<ValueAxis | undefined>(undefined);
  const format = useFormat(spec);
  const input = useMemo(
    () => chartInput({ replay, spec, series, drawn }, format),
    [replay, spec, series, drawn, format],
  );
  const spikes = series.flatMap((each) => each.track.tooShort);
  return (
    <>
      <div className={styles.chartBox}>
        <div className={styles.chart}>
          <Suspense fallback={null}>
            <AlertChart
              input={input}
              label={`${spec.title} as it would have fired, with its threshold`}
              onAxis={setAxis}
            />
          </Suspense>
        </div>
        {threshold !== null && (
          <ThresholdHandle
            axis={axis}
            value={threshold}
            format={format}
            spikes={spikes}
            disabled={props.disabled}
            onMove={props.onMove}
            onRelease={props.onRelease}
          />
        )}
      </div>
      <p className={styles.summary} aria-live="polite">
        <strong>{summaryText(summarize(series))}</strong>
      </p>
    </>
  );
}

/** Props of {@link ReplayHead}. */
interface ReplayHeadProps {
  /** The window shown. */
  readonly window: DraftWindow;
  /** Picks another window. */
  readonly onWindow: (window: DraftWindow) => void;
}

/**
 * The replay card's title, legend and window buttons.
 *
 * @param props - The window and its setter.
 * @returns The header.
 */
export function ReplayHead({ window, onWindow }: ReplayHeadProps) {
  const words = window === '7d' ? 'The last 7 days' : 'The last 24 hours';
  return (
    <div className={styles.cardHead}>
      <h3 className={styles.cardTitle}>{words}, as it would have fired</h3>
      <div className={styles.legend}>
        <span>
          <span className={styles.swatch} />
          firing
        </span>
        <span>
          <span className={styles.dash} />
          threshold
        </span>
        <span>
          <span className={styles.spikeSwatch} />
          too short to fire
        </span>
        <span className={styles.windows}>
          {draftWindows.map((each) => (
            <button
              key={each}
              type="button"
              className={styles.window}
              aria-pressed={each === window}
              onClick={() => onWindow(each)}
            >
              {each === '7d' ? '7 d' : '24 h'}
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}
