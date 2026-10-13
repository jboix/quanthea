/**
 * The editors of the condition sentence: a value is a small button that opens an inline editor,
 * and a text value is one input. The sentence and the editors of each test build on them.
 */
import type { AlertSpec } from '@quanthea/shared';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { Popover } from '../../ui/popover.tsx';
import styles from './alert-draft.module.css';
import { isDuration } from './condition.ts';

/**
 * A part of the sentence that can be shown as plain words: what each test watches, the series, or
 * how far back a test looks (the span of a change, the period of a comparison with the past, the
 * baseline of a band). The alert page fixes what a replay cannot be judged again without.
 */
export type FixedPart = 'watch' | 'by' | 'within';

/** Props of {@link ConditionSentence}. */
export interface ConditionSentenceProps {
  /** The spec. */
  readonly spec: AlertSpec;
  /** The threshold shown, while the threshold of a threshold condition is dragged. */
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

/** The sentence's props and the test an editor is about. */
export type TestProps = ConditionSentenceProps & {
  /** The test, in the order of the condition's tests. */
  readonly index: number;
};

/**
 * Reads a typed number.
 *
 * @param text - The text.
 * @returns The number, or `undefined` when it is not one.
 */
export function numberOf(text: string): number | undefined {
  const value = Number(text);
  return text.trim() === '' || !Number.isFinite(value) ? undefined : value;
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

/** One text value of the sentence. */
export interface TextValueConfig {
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
export function durationChange(change: (spec: AlertSpec, duration: string) => AlertSpec) {
  return (spec: AlertSpec, text: string) =>
    isDuration(text) ? change(spec, text.trim()) : 'Use a duration such as 5m, 1h or 0m.';
}
/**
 * A text value of the sentence, as words when it is fixed, else with its editor.
 *
 * @param props - The sentence's props.
 * @param part - The part, when it can be fixed.
 * @param config - The value's label, text, first value and how it applies.
 * @returns The words, or the value and its editor.
 */
export function textValue(
  props: ConditionSentenceProps,
  part: FixedPart | null,
  config: TextValueConfig,
) {
  if (part !== null && props.fixed?.includes(part)) return config.text;
  return <TextValue {...props} {...config} />;
}
