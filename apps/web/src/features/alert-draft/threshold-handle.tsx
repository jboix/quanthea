/**
 * The threshold drawn over a replay chart, as a dashed line with a handle a person drags: the
 * value follows the pointer while it moves, and the release saves it. Arrow keys move it too, and
 * the key's release saves it. The spikes too short to fire are marked along the bottom.
 */
import { type KeyboardEvent, type PointerEvent, type RefObject, useRef } from 'react';
import type { ValueAxis } from '../../charts/index.ts';
import styles from './alert-draft.module.css';
import { roundThreshold } from './condition.ts';

/** Props of {@link ThresholdHandle}. */
interface ThresholdHandleProps {
  /** Converts between the chart's axes and pixels, once it is drawn. */
  readonly axis: ValueAxis | undefined;
  /** The threshold shown. */
  readonly value: number;
  /** Writes a value as the alert's format does. */
  readonly format: (value: number) => string;
  /** The spikes too short to fire, at the threshold shown. */
  readonly spikes: readonly { readonly from: number; readonly to: number }[];
  /** Whether the handle can move. */
  readonly disabled: boolean;
  /** Called with each value while it moves. */
  readonly onMove: (value: number) => void;
  /** Called with the value to save. */
  readonly onRelease: (value: number) => void;
}

/**
 * The value under a pointer.
 *
 * @param axis - The chart's axes.
 * @param overlay - The overlay element.
 * @param clientY - The pointer's vertical position in the window.
 * @returns The rounded value.
 */
function valueUnder(axis: ValueAxis, overlay: HTMLElement, clientY: number): number {
  return roundThreshold(axis.valueAt(clientY - overlay.getBoundingClientRect().top));
}

/**
 * The step of an arrow key: a twentieth of what 100 pixels span, rounded.
 *
 * @param axis - The chart's axes.
 * @returns The step.
 */
function keyStep(axis: ValueAxis): number {
  return roundThreshold(Math.abs(axis.valueAt(0) - axis.valueAt(100)) / 20) || 1;
}

/**
 * The handle's pointer and key handlers.
 *
 * @param axis - The chart's axes.
 * @param overlay - The overlay element.
 * @param props - The value and the callbacks.
 * @returns The handlers to spread on the handle.
 */
function handlers(
  axis: ValueAxis,
  overlay: RefObject<HTMLDivElement | null>,
  props: Pick<ThresholdHandleProps, 'value' | 'onMove' | 'onRelease'> & {
    readonly dragging: RefObject<boolean>;
  },
) {
  const { dragging, onMove, onRelease } = props;
  const under = (event: PointerEvent<HTMLButtonElement>) =>
    overlay.current ? valueUnder(axis, overlay.current, event.clientY) : props.value;
  return {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      if (dragging.current) onMove(under(event));
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      if (!dragging.current) return;
      dragging.current = false;
      onRelease(under(event));
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      const sign = { ArrowUp: 1, ArrowDown: -1 }[event.key];
      if (sign === undefined) return;
      event.preventDefault();
      onMove(roundThreshold(props.value + sign * keyStep(axis)));
    },
    onKeyUp: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') onRelease(props.value);
    },
  };
}

/**
 * The spikes too short to fire, as dots along the bottom of the chart.
 *
 * @param props - The axes and the spikes.
 * @param props.axis - The chart's axes.
 * @param props.spikes - The spikes.
 * @returns The dots.
 */
function SpikeMarks({ axis, spikes }: Pick<ThresholdHandleProps, 'spikes'> & { axis: ValueAxis }) {
  return spikes.map((spike) => (
    <span
      key={spike.from}
      className={styles.spike}
      style={{ left: axis.xOf(spike.from) }}
      title={`Too short to fire: ${new Date(spike.from).toLocaleString()}`}
    />
  ));
}

/**
 * The draggable threshold over a replay chart.
 *
 * @param props - The axes, the value, its format, the spikes, and the callbacks.
 * @returns The overlay.
 */
export function ThresholdHandle(props: ThresholdHandleProps) {
  const { axis, value, format } = props;
  const overlay = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  if (!axis) return null;
  const top = axis.yOf(value);
  return (
    <div ref={overlay} className={styles.overlay}>
      <SpikeMarks axis={axis} spikes={props.spikes} />
      <span className={styles.line} style={{ top }} />
      <button
        type="button"
        role="slider"
        className={styles.handle}
        style={{ top }}
        aria-label="Threshold, drag or use the arrow keys"
        aria-valuenow={value}
        aria-valuetext={format(value)}
        disabled={props.disabled}
        {...handlers(axis, overlay, { ...props, dragging })}
      >
        {format(value)}
      </button>
    </div>
  );
}
