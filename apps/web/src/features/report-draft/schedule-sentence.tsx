/**
 * A report's schedule as a sentence: "Every Monday at 08:00 Europe/Zurich, covering the previous
 * week, compared with the week before. Next run Mon 13 Oct, 08:00." Each value is a small button
 * that opens an inline editor; saving it saves a new draft version by hand.
 */
import { nextRunAt, type ReportPeriod, type ReportSpec, type Weekday } from '@quanthea/shared';
import { useState } from 'react';
import { Input } from '../../ui/input.tsx';
import { Select } from '../../ui/select.tsx';
import { ValueEditor } from '../alert-draft/index.ts';
import styles from './report-draft.module.css';
import {
  compareChoices,
  compareWords,
  periodChoices,
  periodWords,
  weekdayChoices,
  weekdayName,
  withCompare,
  withMonthDay,
  withPeriod,
  withTime,
  withTimezone,
  withWeekday,
} from './schedule.ts';

/** Props of {@link ScheduleSentence}. */
export interface ScheduleSentenceProps {
  /** The spec. */
  readonly spec: ReportSpec;
  /** Whether the values can change now. */
  readonly disabled: boolean;
  /** Takes a changed spec. */
  readonly onChange: (spec: ReportSpec) => void;
}

/** Props of a value picked from a list. */
interface ChoiceValueProps<Value extends string> extends ScheduleSentenceProps {
  /** The editor's name. */
  readonly label: string;
  /** What the button shows. */
  readonly text: string;
  /** The value now. */
  readonly value: Value;
  /** The values to pick from. */
  readonly choices: readonly { readonly value: Value; readonly label: string }[];
  /** The spec with the value picked. */
  readonly apply: (spec: ReportSpec, value: Value) => ReportSpec;
}

/**
 * A value of the sentence picked from a list.
 *
 * @param props - The sentence's props, the label, the text, the choices and how it applies.
 * @returns The value and its editor.
 */
function ChoiceValue<Value extends string>(props: ChoiceValueProps<Value>) {
  const [picked, setPicked] = useState<Value>(props.value);
  const save = () => {
    if (picked !== props.value) props.onChange(props.apply(props.spec, picked));
    return undefined;
  };
  return (
    <ValueEditor label={props.label} text={props.text} disabled={props.disabled} onSave={save}>
      <Select
        label={props.label}
        options={props.choices}
        value={picked}
        onChange={(event) => setPicked(event.target.value as Value)}
      />
    </ValueEditor>
  );
}

/** Props of a value typed in. */
interface TextValueProps extends ScheduleSentenceProps {
  /** The editor's name. */
  readonly label: string;
  /** What the button shows, and the field starts with. */
  readonly text: string;
  /** What the field takes. */
  readonly hint: string;
  /** The spec with the value typed, or what is wrong with it. */
  readonly apply: (spec: ReportSpec, text: string) => ReportSpec | string;
}

/**
 * A value of the sentence typed in.
 *
 * @param props - The sentence's props, the label, the text, a hint and how it applies.
 * @returns The value and its editor.
 */
function TextValue(props: TextValueProps) {
  const [typed, setTyped] = useState(props.text);
  const save = () => {
    const changed = props.apply(props.spec, typed);
    if (typeof changed === 'string') return changed;
    if (typed.trim() !== props.text) props.onChange(changed);
    return undefined;
  };
  return (
    <ValueEditor label={props.label} text={props.text} disabled={props.disabled} onSave={save}>
      <Input
        label={props.label}
        hint={props.hint}
        mono
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />
    </ValueEditor>
  );
}

/**
 * When it runs, before its time: the weekday or the day of the month to change.
 *
 * @param props - The sentence's props.
 * @returns The words with their values.
 */
function When(props: ScheduleSentenceProps) {
  const { schedule } = props.spec;
  if (schedule.every === 'day') return <>Every day</>;
  if (schedule.every === 'week') {
    const weekday = (
      <ChoiceValue<Weekday>
        {...props}
        label="Weekday"
        text={weekdayName(schedule.weekday)}
        value={schedule.weekday}
        choices={weekdayChoices}
        apply={withWeekday}
      />
    );
    return <>Every {weekday}</>;
  }
  const day = String(schedule.day);
  const hint = 'From 1 to 31; past the month’s end, its last day.';
  const value = <TextValue {...props} label="Day" text={day} hint={hint} apply={withMonthDay} />;
  return <>On day {value} of every month</>;
}

/**
 * When the next run is, on the schedule's clock.
 *
 * @param spec - The spec.
 * @returns Such as `Mon 13 Oct, 08:00`.
 */
function nextRunWords(spec: ReportSpec): string {
  const format = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: spec.schedule.timezone,
  });
  return format.format(nextRunAt(spec.schedule, Date.now()));
}

/**
 * The schedule as a sentence of values to change.
 *
 * @param props - The spec, whether it can change, and the change callback.
 * @returns The sentence.
 */
export function ScheduleSentence(props: ScheduleSentenceProps) {
  const { spec } = props;
  const { at, timezone } = spec.schedule;
  const zoneHint = 'An IANA time zone, such as Europe/Zurich.';
  return (
    <p className={styles.sentence}>
      <When {...props} /> at{' '}
      <TextValue {...props} label="Time" text={at} hint="Such as 08:00." apply={withTime} />{' '}
      <TextValue
        {...props}
        label="Time zone"
        text={timezone}
        hint={zoneHint}
        apply={withTimezone}
      />
      , covering{' '}
      <ChoiceValue<ReportPeriod>
        {...props}
        label="Period"
        text={periodWords[spec.period]}
        value={spec.period}
        choices={periodChoices}
        apply={withPeriod}
      />
      , compared with{' '}
      <ChoiceValue<ReportSpec['compare']>
        {...props}
        label="Compared with"
        text={compareWords(spec)}
        value={spec.compare}
        choices={compareChoices(spec.period)}
        apply={withCompare}
      />
      . <span className={styles.next}>Next run {nextRunWords(spec)}.</span>
    </p>
  );
}
