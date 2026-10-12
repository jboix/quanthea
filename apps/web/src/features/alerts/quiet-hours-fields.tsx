/**
 * The default quiet hours in the alert settings: the windows (the days each starts on, and when
 * it starts and ends), the time zone of their clock, and the severities that notify whatever the
 * hour. A line under them reads the windows back in words.
 */
import { alertSeverities, isTimeZone, type Weekday, weekdays } from '@quanthea/shared';
import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { quietHoursWords } from '../alert-draft/index.ts';
import styles from './alerts.module.css';
import {
  type DefaultQuiet,
  maxWindows,
  type QuietWindow,
  quietHoursProblem,
  toggled,
} from './quiet-hours-form.ts';

/** Props of {@link Chips}. */
interface ChipsProps<Value extends string> {
  /** What the choices are, for screen readers and above the chips. */
  readonly legend: string;
  /** Every choice. */
  readonly options: readonly Value[];
  /** The choices that are on. */
  readonly selected: readonly Value[];
  /** How a choice reads. */
  readonly text: (option: Value) => string;
  /** Takes the choices with one flipped. */
  readonly onChange: (selected: Value[]) => void;
}

/**
 * Choices to turn on and off, each a chip.
 *
 * @param props - The legend, the choices, the ones that are on and the change callback.
 * @returns The group.
 */
function Chips<Value extends string>(props: ChipsProps<Value>) {
  const { legend, options, selected, text, onChange } = props;
  return (
    <fieldset className={styles.quietChips}>
      <legend className={styles.quietLegend}>{legend}</legend>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={styles.chip}
          aria-pressed={selected.includes(option)}
          onClick={() => onChange(toggled(selected, option))}
        >
          {text(option)}
        </button>
      ))}
    </fieldset>
  );
}

/** Props of {@link WindowFields}. */
interface WindowFieldsProps {
  /** The window. */
  readonly window: QuietWindow;
  /** Its number, from 1, for the names of its fields. */
  readonly number: number;
  /** Takes the window changed. */
  readonly onChange: (window: QuietWindow) => void;
  /** Removes the window; left out for the only one. */
  readonly onRemove: (() => void) | undefined;
}

/**
 * One window: the days it starts on, and when it starts and ends.
 *
 * @param props - The window, its number, and the change and remove callbacks.
 * @returns The fields.
 */
function WindowFields({ window, number, onChange, onRemove }: WindowFieldsProps) {
  const time = (key: 'from' | 'to', label: string) => (
    <Input
      label={label}
      type="time"
      mono
      value={window[key]}
      onChange={(event) => onChange({ ...window, [key]: event.target.value })}
    />
  );
  return (
    <div className={styles.quietWindow}>
      <Chips<Weekday>
        legend={`Window ${number} starts on`}
        options={weekdays}
        selected={window.days}
        text={(day) => `${day[0]?.toUpperCase()}${day.slice(1, 3)}`}
        onChange={(days) => onChange({ ...window, days })}
      />
      <div className={styles.quietTimes}>
        {time('from', 'From')}
        {time('to', 'To')}
        {onRemove && (
          <Button size="small" aria-label={`Remove window ${number}`} onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

/** Props of {@link QuietHoursFields}. */
interface QuietHoursFieldsProps {
  /** The quiet hours being edited. */
  readonly value: DefaultQuiet;
  /** Takes them changed. */
  readonly onChange: (value: DefaultQuiet) => void;
}

/**
 * A key for each window that stays with it while others are added and removed, so a field keeps
 * its focus: windows have no identity of their own.
 *
 * @param count - How many windows there are at first.
 * @returns The keys in the windows' order, and how to follow an added or removed window.
 */
function useWindowKeys(count: number) {
  const [keys, setKeys] = useState(() => Array.from({ length: count }, (_unused, at) => at));
  const add = () => setKeys((held) => [...held, Math.max(-1, ...held) + 1]);
  const remove = (index: number) => setKeys((held) => held.filter((_each, at) => at !== index));
  return { keys, add, remove };
}

/**
 * The windows of the quiet hours, with a button to add one.
 *
 * @param props - The quiet hours and the change callback.
 * @returns The windows.
 */
function Windows({ value, onChange }: QuietHoursFieldsProps) {
  const { windows } = value;
  const keys = useWindowKeys(windows.length);
  const replace = (index: number, window: QuietWindow) =>
    onChange({ ...value, windows: windows.map((each, at) => (at === index ? window : each)) });
  const remove = (index: number) => {
    keys.remove(index);
    onChange({ ...value, windows: windows.filter((_each, at) => at !== index) });
  };
  const add = () => {
    keys.add();
    onChange({ ...value, windows: [...windows, { days: [], from: '00:00', to: '00:00' }] });
  };
  return (
    <>
      {windows.map((window, index) => (
        <WindowFields
          key={keys.keys[index]}
          window={window}
          number={index + 1}
          onChange={(changed) => replace(index, changed)}
          onRemove={windows.length > 1 ? () => remove(index) : undefined}
        />
      ))}
      <Button size="small" disabled={windows.length >= maxWindows} onClick={add}>
        Add a window
      </Button>
    </>
  );
}

/**
 * The fields of the default quiet hours.
 *
 * @param props - The quiet hours and the change callback.
 * @returns The windows, the time zone, the severities left alone, and the windows in words.
 */
export function QuietHoursFields({ value, onChange }: QuietHoursFieldsProps) {
  const problem = quietHoursProblem(value);
  return (
    <div className={styles.quietHours}>
      <Windows value={value} onChange={onChange} />
      <Input
        label="Time zone"
        mono
        value={value.timezone}
        hint="The clock the windows are on. An end at or before the start is the next day; the same time lasts 24 hours."
        error={isTimeZone(value.timezone) ? undefined : problem}
        onChange={(event) => onChange({ ...value, timezone: event.target.value.trim() })}
      />
      <Chips
        legend="Still notify at any hour"
        options={alertSeverities}
        selected={value.exceptSeverities}
        text={(severity) => severity}
        onChange={(exceptSeverities) => onChange({ ...value, exceptSeverities })}
      />
      <p className={problem ? styles.failure : styles.note} role="status">
        {problem ?? `Quiet ${quietHoursWords(value)}.`}
      </p>
    </div>
  );
}
