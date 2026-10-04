/**
 * A replay chart whose threshold a person drags: the alert chart of `charts/` draws the series,
 * the firing periods at the threshold shown and the threshold's dashed line, and a handle at its
 * right moves it. The saved threshold keeps the value axis, so the axis stays still under the
 * pointer, and stays as a faint line once the threshold moved. The draft pane and the alert page
 * share it.
 */
import { type AlertSpec, alertValueText } from '@quanthea/shared';
import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import type { AlertChartInput, ValueAxis } from '../../charts/index.ts';
import styles from './alert-draft.module.css';
import type { Replayed, TrackedSeries } from './replay-model.ts';
import { ThresholdHandle } from './threshold-handle.tsx';

/** The chart, loaded with ECharts the first time it draws. */
const AlertChart = lazy(async () => ({
  default: (await import('../../charts/index.ts')).AlertChart,
}));

/** Props of {@link TunableChart}. */
export interface TunableChartProps {
  /** The replay. */
  readonly replay: Replayed;
  /** The saved spec: its threshold keeps the value axis, and stays faint once moved. */
  readonly spec: AlertSpec;
  /** Every series at the threshold shown, those that fired longest first. */
  readonly series: readonly TrackedSeries[];
  /** The series the chart draws. */
  readonly drawn: readonly TrackedSeries[];
  /** The threshold shown, or `null` for a condition without one. */
  readonly threshold: number | null;
  /** What the chart shows, for screen readers. */
  readonly label: string;
  /** Whether the threshold can move. */
  readonly disabled: boolean;
  /** Called with each value while the threshold moves. */
  readonly onMove: (value: number) => void;
  /** Called with the value where the threshold was let go. */
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
 * What the chart draws: the series given, when each series fired at the threshold shown, and the
 * threshold's line where it is shown.
 *
 * @param props - The replay, the saved spec, the series and the threshold shown.
 * @param format - Writes a value as the alert's format does.
 * @returns The chart's input.
 */
function chartInput(
  props: Pick<TunableChartProps, 'replay' | 'spec' | 'series' | 'drawn' | 'threshold'>,
  format: (value: number) => string,
): AlertChartInput {
  const { replay, spec, series, drawn } = props;
  return {
    series: drawn.map((each) => ({ name: seriesName(each.labels), points: each.track.points })),
    threshold: spec.condition.kind === 'threshold' ? spec.condition.value : null,
    moved: props.threshold,
    handle: true,
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
 * The chart with the draggable threshold.
 *
 * @param props - The replay, the saved spec, the series, the threshold shown and the callbacks.
 * @returns The chart and its handle.
 */
export function TunableChart(props: TunableChartProps) {
  const { replay, spec, series, drawn, threshold } = props;
  const [axis, setAxis] = useState<ValueAxis | undefined>(undefined);
  const format = useFormat(spec);
  const input = useMemo(
    () => chartInput({ replay, spec, series, drawn, threshold }, format),
    [replay, spec, series, drawn, threshold, format],
  );
  return (
    <div className={styles.chartBox}>
      <div className={styles.chart}>
        <Suspense fallback={null}>
          <AlertChart input={input} label={props.label} onAxis={setAxis} />
        </Suspense>
      </div>
      {threshold !== null && (
        <ThresholdHandle
          axis={axis}
          value={threshold}
          format={format}
          spikes={series.flatMap((each) => each.track.tooShort)}
          disabled={props.disabled}
          onMove={props.onMove}
          onRelease={props.onRelease}
        />
      )}
    </div>
  );
}
