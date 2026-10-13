/**
 * A replay chart whose threshold a person drags: the alert chart of `charts/` draws the series,
 * the firing periods at the threshold shown and the threshold's dashed line, and a handle at its
 * right moves it. The saved threshold stays as a faint line once the threshold moved, and the
 * value axis keeps both in view. A change draws the limit the series that fired longest must
 * reach, as a dashed line that moves with it; a comparison with the past draws the value then
 * too, and a band its range. Only the threshold of a threshold condition has a handle. The lines
 * are drawn at the chart's interval, the firing periods as the checks gave them. The draft pane
 * and the alert page share it.
 */
import { type AlertSpec, alertValueText, type ChartInterval } from '@quanthea/shared';
import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import type { AlertChartInput, ValueAxis } from '../../charts/index.ts';
import styles from './alert-draft.module.css';
import { drawnPoints } from './drawn-interval.ts';
import { conditionLines, type Replayed, type TrackedSeries } from './replay-model.ts';
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
  /** The spec as shown, with changes not saved; the saved one when left out. */
  readonly shown?: AlertSpec | undefined;
  /** Every series at the threshold shown, those that fired longest first. */
  readonly series: readonly TrackedSeries[];
  /** The series the chart draws. */
  readonly drawn: readonly TrackedSeries[];
  /** The threshold a person drags, or `null` for a condition other than a threshold. */
  readonly threshold: number | null;
  /** The interval the lines are drawn at; every check when `null` or left out. */
  readonly interval?: ChartInterval | null | undefined;
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

/** What of the chart's props says what it draws. */
type DrawnProps = Pick<
  TunableChartProps,
  'replay' | 'spec' | 'shown' | 'series' | 'drawn' | 'threshold' | 'interval'
>;

/**
 * The series the chart draws, at its interval, in the replay's order, so a series keeps its
 * colour as the threshold moves.
 *
 * @param props - The replay, the series to draw and the interval.
 * @returns Each series' name and points.
 */
function drawnSeries(props: Pick<DrawnProps, 'replay' | 'drawn' | 'interval'>) {
  const order = new Map(props.replay.series.map((each, index) => [each.key, index]));
  return [...props.drawn]
    .sort((first, second) => (order.get(first.key) ?? 0) - (order.get(second.key) ?? 0))
    .map((each) => ({
      name: seriesName(each.labels),
      points: drawnPoints(each.track.points, props.interval ?? null),
    }));
}

/**
 * What the chart draws: the series given, at the chart's interval, when each series fired at the
 * threshold shown, and the threshold's line where it is shown.
 *
 * @param props - The replay, the saved spec, the series, the threshold shown and the interval.
 * @param format - Writes a value as the alert's format does.
 * @returns The chart's input.
 */
function chartInput(props: DrawnProps, format: (value: number) => string): AlertChartInput {
  const { replay, spec, series } = props;
  const [lead] = props.drawn;
  const name = lead && props.drawn.length > 1 ? seriesName(lead.labels) : undefined;
  const points = drawnPoints(lead?.track.points ?? [], props.interval ?? null);
  const lines = conditionLines((props.shown ?? spec).condition, { name, points });
  return {
    series: drawnSeries(props),
    threshold: conditionLines(spec.condition, undefined).threshold,
    moved: props.threshold ?? lines.threshold,
    handle: props.threshold !== null,
    limit: lines.limit,
    reference: lines.reference,
    band: lines.band,
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
  const { replay, spec, shown, series, drawn, threshold, interval } = props;
  const [axis, setAxis] = useState<ValueAxis | undefined>(undefined);
  const drag = useDragStart(props);
  const format = useFormat(spec);
  const input = useMemo(
    () => ({
      ...chartInput({ replay, spec, shown, series, drawn, threshold, interval }, format),
      axisMoved: drag.start,
    }),
    [replay, spec, shown, series, drawn, threshold, interval, format, drag.start],
  );
  return (
    <div className={styles.chartBox}>
      <div className={styles.chart}>
        <Suspense fallback={null}>
          <AlertChart input={input} label={props.label} onAxis={setAxis} />
        </Suspense>
      </div>
      <ThresholdHandle
        axis={axis}
        value={threshold}
        format={format}
        spikes={series.flatMap((each) => each.track.tooShort)}
        disabled={props.disabled}
        onMove={drag.onMove}
        onRelease={drag.onRelease}
      />
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
