/**
 * The draft's condition as a sentence: "Fires when errors of each service is above 2% for 5
 * minutes, checked every minute." Each value is a small button that opens an inline editor;
 * saving it saves a new draft version by hand.
 */
import type { AlertSpec } from '@quanthea/shared';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { Popover } from '../../ui/popover.tsx';
import { Select } from '../../ui/select.tsx';
import styles from './alert-draft.module.css';
import {
  byWords,
  durationWords,
  everyWords,
  isDuration,
  thresholdWords,
  watchWords,
  withBy,
  withEvery,
  withFor,
  withThreshold,
} from './condition.ts';

/** Props of {@link ConditionSentence}. */
interface ConditionSentenceProps {
  /** The draft's spec. */
  readonly spec: AlertSpec;
  /** The threshold shown, while it is dragged. */
  readonly threshold: number | null;
  /** Whether the values can change now. */
  readonly disabled: boolean;
  /** Saves a changed spec. */
  readonly onChange: (spec: AlertSpec) => void;
}

/** Props of {@link ValueEditor}. */
interface ValueEditorProps {
  /** The editor's name, for screen readers. */
  readonly label: string;
  /** What the button shows. */
  readonly text: string;
  /** Whether it can open. */
  readonly disabled: boolean;
  /** The fields, given what is wrong so far. */
  readonly children: ReactNode;
  /** Checks the fields and saves: returns what is wrong, or nothing once saved. */
  readonly onSave: () => string | undefined;
}

/**
 * A value of the sentence: a button that opens an editor.
 *
 * @param props - The label, the text, the fields and the save.
 * @returns The button and its editor.
 */
function ValueEditor({ label, text, disabled, children, onSave }: ValueEditorProps) {
  const [error, setError] = useState<string | undefined>(undefined);
  if (disabled) {
    return (
      <button type="button" className={styles.value} disabled>
        {text}
      </button>
    );
  }
  return (
    <Popover label={label} trigger={text} triggerClassName={styles.value ?? ''} shape="button">
      {(close) => (
        <form
          className={styles.editor}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            const problem = onSave();
            setError(problem);
            if (problem === undefined) close();
          }}
        >
          {children}
          {error && <p className={styles.error}>{error}</p>}
          <Button type="submit" variant="primary" size="small">
            Save as a new version
          </Button>
        </form>
      )}
    </Popover>
  );
}

/** The operators of a threshold. */
const operators = [
  { value: 'above', label: 'above' },
  { value: 'below', label: 'below' },
];

/**
 * The threshold's fields: the operator and the number.
 *
 * @param props - The values and their setters.
 * @param props.op - Above or below.
 * @param props.text - The number, as typed.
 * @param props.onOp - Sets the operator.
 * @param props.onText - Sets the number.
 * @returns The fields.
 */
function ThresholdFields(props: {
  readonly op: 'above' | 'below';
  readonly text: string;
  readonly onOp: (op: 'above' | 'below') => void;
  readonly onText: (text: string) => void;
}) {
  return (
    <div className={styles.editorRow}>
      <Select
        label="Operator"
        options={operators}
        value={props.op}
        onChange={(event) => props.onOp(event.target.value as 'above' | 'below')}
      />
      <Input
        label="Threshold"
        mono
        inputMode="decimal"
        value={props.text}
        onChange={(event) => props.onText(event.target.value)}
      />
    </div>
  );
}

/**
 * The threshold's editor: above or below, and the number.
 *
 * @param props - The sentence's props.
 * @returns The value and its editor.
 */
function ThresholdValue({ spec, threshold, disabled, onChange }: ConditionSentenceProps) {
  const condition = spec.condition.kind === 'threshold' ? spec.condition : undefined;
  const [op, setOp] = useState<'above' | 'below'>(condition?.op ?? 'above');
  const [text, setText] = useState(String(condition?.value ?? ''));
  if (!condition) return <>no data</>;
  const save = () => {
    const value = Number(text);
    if (text.trim() === '' || !Number.isFinite(value)) return 'Type a number.';
    onChange(withThreshold(spec, op, value));
    return undefined;
  };
  return (
    <ValueEditor
      label="Threshold"
      text={thresholdWords(spec, threshold ?? undefined)}
      disabled={disabled}
      onSave={save}
    >
      <ThresholdFields op={op} text={text} onOp={setOp} onText={setText} />
    </ValueEditor>
  );
}

/** One text value of the sentence. */
interface TextValueConfig {
  /** Its name. */
  readonly label: string;
  /** What its button shows. */
  readonly text: string;
  /** What its editor starts with. */
  readonly initial: string;
  /** A line under the editor's input. */
  readonly hint: string;
  /** Applies a typed value to the spec, or says why not. */
  readonly apply: (spec: AlertSpec, text: string) => AlertSpec | string;
}

/**
 * An editor of one text value.
 *
 * @param props - The sentence's props, the value's label and text, its first value, and how it applies.
 * @returns The value and its editor.
 */
function TextValue(props: ConditionSentenceProps & TextValueConfig) {
  const [text, setText] = useState(props.initial);
  const save = () => {
    const changed = props.apply(props.spec, text);
    if (typeof changed === 'string') return changed;
    props.onChange(changed);
    return undefined;
  };
  return (
    <ValueEditor label={props.label} text={props.text} disabled={props.disabled} onSave={save}>
      <Input
        label={props.label}
        hint={props.hint}
        mono
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </ValueEditor>
  );
}

/**
 * Applies a duration, or says why not.
 *
 * @param change - Sets the duration on a spec.
 * @returns The apply function.
 */
function durationChange(change: (spec: AlertSpec, duration: string) => AlertSpec) {
  return (spec: AlertSpec, text: string) =>
    isDuration(text) ? change(spec, text.trim()) : 'Use a duration such as 5m, 1h or 0m.';
}

/**
 * The condition as a sentence of values to change.
 *
 * @param props - The spec, the threshold being dragged, and the save.
 * @returns The sentence.
 */
export function ConditionSentence(props: ConditionSentenceProps) {
  const { spec } = props;
  const { by, hold, every } = sentenceValues(props);
  if (spec.condition.kind === 'no_data')
    return (
      <p className={styles.sentence}>
        Fires when the query returns no value for {hold}, checked {every}.
      </p>
    );
  return (
    <p className={styles.sentence}>
      Fires when {watchWords(spec)} of {by} is <ThresholdValue {...props} /> for {hold}, checked{' '}
      {every}.
    </p>
  );
}

/**
 * The text values of the sentence: the series, how long it holds, how often it is checked.
 *
 * @param props - The sentence's props.
 * @returns The three values with their editors.
 */
function sentenceValues(props: ConditionSentenceProps) {
  const { spec } = props;
  const value = (config: TextValueConfig) => <TextValue {...props} {...config} />;
  return {
    by: value({
      label: 'Series by',
      text: byWords(spec),
      initial: (spec.value.by ?? []).join(', '),
      hint: 'Columns, separated by commas; empty for every text column.',
      apply: withBy,
    }),
    hold: value({
      label: 'For',
      text: durationWords(spec.condition.for),
      initial: spec.condition.for,
      hint: 'Such as 5m; 0m fires at once.',
      apply: durationChange(withFor),
    }),
    every: value({
      label: 'Every',
      text: everyWords(spec.every),
      initial: spec.every,
      hint: '1m or more.',
      apply: durationChange(withEvery),
    }),
  };
}
