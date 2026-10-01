import type { DashboardSpec, TimeRangeExpression } from '@quanthea/shared';
import { type FormEvent, useRef, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import styles from './variables-bar.module.css';
import { quickRanges, timeLabel } from './view-state.ts';

/** Props of {@link TimePicker}. */
interface TimePickerProps {
  /** The spec, for the saved range and the time zone. */
  readonly spec: DashboardSpec;
  /** The range the viewer picked, if any. */
  readonly picked: TimeRangeExpression | undefined;
  /** Called with a new range, or `undefined` to go back to the saved one. */
  readonly onPick: (time: TimeRangeExpression | undefined) => void;
}

/**
 * An instant as the value of a `datetime-local` input, in the browser's zone.
 *
 * @param expression - A time expression that is an ISO timestamp.
 * @returns Such as `2026-09-26T13:30`, or empty for a relative time.
 */
function localInput(expression: string): string {
  const instant = Date.parse(expression);
  if (Number.isNaN(instant)) return '';
  const offset = new Date(instant).getTimezoneOffset() * 60_000;
  return new Date(instant - offset).toISOString().slice(0, 16);
}

/**
 * The form for an absolute range.
 *
 * @param props - The current range and the apply callback.
 * @param props.current - The range shown now.
 * @param props.onApply - Called with the new range.
 * @returns The form.
 */
function CustomRange({
  current,
  onApply,
}: {
  readonly current: TimeRangeExpression;
  readonly onApply: (time: TimeRangeExpression) => void;
}) {
  const [from, setFrom] = useState(localInput(current.from));
  const [to, setTo] = useState(localInput(current.to));
  const apply = (event: FormEvent) => {
    event.preventDefault();
    const [start, end] = [new Date(from), new Date(to)];
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    onApply({ from: start.toISOString(), to: end.toISOString() });
  };
  return (
    <form className={styles.custom} onSubmit={apply}>
      <label className={styles.customField}>
        From
        <input
          type="datetime-local"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
      </label>
      <label className={styles.customField}>
        To
        <input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} />
      </label>
      <Button type="submit" size="small">
        Apply
      </Button>
    </form>
  );
}

/**
 * The time chip: quick ranges, the saved range, and an absolute range.
 *
 * @param props - The spec, the picked range and the pick callback.
 * @returns The chip with its menu.
 */
export function TimePicker({ spec, picked, onPick }: TimePickerProps) {
  const details = useRef<HTMLDetailsElement>(null);
  const current = picked ?? spec.time;
  const pick = (time: TimeRangeExpression | undefined) => {
    details.current?.removeAttribute('open');
    onPick(time);
  };
  return (
    <details ref={details} className={styles.chip}>
      <summary className={styles.chipButton}>
        <span className={styles.chipName}>time</span>
        {timeLabel(current, spec.timezone)}
      </summary>
      <div className={styles.menu}>
        {quickRanges.map((range) => (
          <button
            key={range.from}
            type="button"
            className={styles.option}
            aria-pressed={current.from === range.from && current.to === 'now'}
            onClick={() => pick({ from: range.from, to: 'now' })}
          >
            {range.label}
          </button>
        ))}
        <button
          type="button"
          className={styles.option}
          aria-pressed={picked === undefined}
          onClick={() => pick(undefined)}
        >
          Saved range · {timeLabel(spec.time, spec.timezone)}
        </button>
        <CustomRange current={current} onApply={pick} />
      </div>
    </details>
  );
}
