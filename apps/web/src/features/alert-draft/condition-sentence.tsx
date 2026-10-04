/**
 * An alert's condition as a sentence: "Fires when the error share of each service is above 2%
 * for 5 minutes, checked every minute." Each value is a small button that opens an inline editor.
 * In the draft pane saving it saves a new draft version by hand; the alert page holds it unsaved.
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
  withField,
  withFor,
  withThreshold,
} from './condition.ts';

/** A part of the sentence that can be shown as plain words: what it watches, or its series. */
export type FixedPart = 'watch' | 'by';

/** Props of {@link ConditionSentence}. */
export interface ConditionSentenceProps {
  /** The spec. */
  readonly spec: AlertSpec;
  /** The threshold shown, while it is dragged. */
  readonly threshold: number | null;
  /** Whether the values can change now. */
  readonly disabled: boolean;
  /** Takes a changed spec. */
  readonly onChange: (spec: AlertSpec) => void;
  /** What the editors' button says; `Save as a new version` by default. */
  readonly saveLabel?: string | undefined;
  /** The parts shown as plain words, which can't change here. */
  readonly fixed?: readonly FixedPart[] | undefined;
}

/** Props of {@link ValueEditor}. */
export interface ValueEditorProps {
  /** The editor's name, for screen readers. */
  readonly label: string;
  /** What the button shows. */
  readonly text: string;
  /** Whether it can open. */
  readonly disabled: boolean;
  /** What its button says. */
  readonly saveLabel?: string | undefined;
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
export function ValueEditor({
  label,
  text,
  disabled,
  saveLabel,
  children,
  onSave,
}: ValueEditorProps) {
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
            {saveLabel ?? 'Save as a new version'}
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
function ThresholdValue(props: ConditionSentenceProps) {
  const { spec, threshold, disabled, onChange, saveLabel } = props;
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
      saveLabel={saveLabel}
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
    <ValueEditor {...props} onSave={save}>
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
 * @param props - The spec, the threshold being dragged, the save, and the parts that stay fixed.
 * @returns The sentence.
 */
export function ConditionSentence(props: ConditionSentenceProps) {
  const { spec } = props;
  const { watch, by } = seriesValues(props);
  const { hold, every } = timingValues(props);
  if (spec.condition.kind === 'no_data')
    return (
      <p className={styles.sentence}>
        Fires when the query returns no value for {hold}, checked {every}.
      </p>
    );
  return (
    <p className={styles.sentence}>
      Fires when {watch} of {by} is <ThresholdValue {...props} /> for {hold}, checked {every}.
    </p>
  );
}

/**
 * A text value of the sentence, as words when it is fixed, else with its editor.
 *
 * @param props - The sentence's props.
 * @param part - The part, when it can be fixed.
 * @param config - The value's label, text, first value and how it applies.
 * @returns The words, or the value and its editor.
 */
function textValue(props: ConditionSentenceProps, part: FixedPart | null, config: TextValueConfig) {
  if (part !== null && props.fixed?.includes(part)) return config.text;
  return <TextValue {...props} {...config} />;
}

/**
 * What the sentence watches and the series it tells apart.
 *
 * @param props - The sentence's props.
 * @returns The two values, with their editors unless fixed.
 */
function seriesValues(props: ConditionSentenceProps) {
  const { spec } = props;
  return {
    watch: textValue(props, 'watch', {
      label: 'Value column',
      text: watchWords(spec),
      initial: spec.value.field ?? '',
      hint: 'The number column compared; empty for the first one.',
      apply: withField,
    }),
    by: textValue(props, 'by', {
      label: 'Series by',
      text: byWords(spec),
      initial: (spec.value.by ?? []).join(', '),
      hint: 'Columns, separated by commas; empty for every text column.',
      apply: withBy,
    }),
  };
}

/**
 * How long the condition holds and how often it is checked.
 *
 * @param props - The sentence's props.
 * @returns The two values with their editors.
 */
function timingValues(props: ConditionSentenceProps) {
  const { spec } = props;
  return {
    hold: textValue(props, null, {
      label: 'For',
      text: durationWords(spec.condition.for),
      initial: spec.condition.for,
      hint: 'Such as 5m; 0m fires at once.',
      apply: durationChange(withFor),
    }),
    every: textValue(props, null, {
      label: 'Every',
      text: everyWords(spec.every),
      initial: spec.every,
      hint: '1m or more.',
      apply: durationChange(withEvery),
    }),
  };
}
