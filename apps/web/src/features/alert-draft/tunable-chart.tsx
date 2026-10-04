/**
 * A replay chart whose threshold a person drags: the alert chart of `charts/` draws the series,
 * the firing periods at the threshold shown and the threshold's dashed line, and a handle at its
 * right moves it. The saved threshold stays as a faint line once the threshold moved, and the
 * value axis keeps both in view. The draft pane and the alert page share it.
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
  const { replay, spec, series } = props;
  // In the replay's order, so a series keeps its colour as the threshold moves.
  const order = new Map(replay.series.map((each, index) => [each.key, index]));
  const drawn = [...props.drawn].sort(
    (first, second) => (order.get(first.key) ?? 0) - (order.get(second.key) ?? 0),
  );
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
  const drag = useDragStart(props);
  const format = useFormat(spec);
  const input = useMemo(
    () => ({
      ...chartInput({ replay, spec, series, drawn, threshold }, format),
      axisMoved: drag.start,
    }),
    [replay, spec, series, drawn, threshold, format, drag.start],
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
          onMove={drag.onMove}
          onRelease={drag.onRelease}
        />
      )}
    </div>
  );
}

/**
 * Where a drag of the threshold started, so the value axis stays still under the pointer
 * until the threshold is let go.
 *
 * @param props - The threshold shown and the callbacks.
 * @returns The start while a drag goes on, and the callbacks that follow it.
 */
function useDragStart(props: Pick<TunableChartProps, 'threshold' | 'onMove' | 'onRelease'>) {
  const [start, setStart] = useState<number | null>(null);
  return {
    start,
    onMove: (value: number) => {
      setStart((started) => started ?? props.threshold);
      props.onMove(value);
    },
    onRelease: (value: number) => {
      setStart(null);
      props.onRelease(value);
    },
  };
}
