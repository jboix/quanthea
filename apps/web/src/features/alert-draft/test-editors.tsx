/**
 * The editors of the tests of a condition: the operator and number of a threshold, the direction,
 * amount and span of a change, the field a part of a joined condition reads, and the word that
 * joins the parts.
 */
import { type AlertSpec, conditionTests } from '@quanthea/shared';
import { useState } from 'react';
import { Input } from '../../ui/input.tsx';
import { Select } from '../../ui/select.tsx';
import styles from './alert-draft.module.css';
import { fieldWords } from './condition.ts';
import {
  type ConditionSentenceProps,
  durationChange,
  textValue,
  ValueEditor,
} from './condition-editors.tsx';
import {
  type ChangeTest,
  changeTestWords,
  type ThresholdTest,
  thresholdTestWords,
  withinWords,
  withJoiner,
  withTest,
  withWithin,
} from './condition-tests.ts';

/** The sentence's props and the test an editor is about. */
type TestProps = ConditionSentenceProps & {
  /** The test, in the order of the condition's tests. */
  readonly index: number;
};

/** The operators of a threshold. */
const operators = [
  { value: 'above', label: 'above' },
  { value: 'below', label: 'below' },
];

/** The directions of a change. */
const directions = [
  { value: 'down', label: 'drops' },
  { value: 'up', label: 'rises' },
];

/** The units of a change. */
const units = [
  { value: 'percent', label: '% of the earlier value' },
  { value: 'absolute', label: 'in the value itself' },
];

/** The ways tests are joined. */
const joiners = [
  { value: 'all', label: 'and: every one holds' },
  { value: 'any', label: 'or: one is enough' },
];

/**
 * Reads a typed number.
 *
 * @param text - The text.
 * @returns The number, or `undefined` when it is not one.
 */
function numberOf(text: string): number | undefined {
  const value = Number(text);
  return text.trim() === '' || !Number.isFinite(value) ? undefined : value;
}

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
  readonly op: ThresholdTest['op'];
  readonly text: string;
  readonly onOp: (op: ThresholdTest['op']) => void;
  readonly onText: (text: string) => void;
}) {
  return (
    <div className={styles.editorRow}>
      <Select
        label="Operator"
        options={operators}
        value={props.op}
        onChange={(event) => props.onOp(event.target.value as ThresholdTest['op'])}
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
 * The editor of a threshold test: above or below, and the number.
 *
 * @param props - The sentence's props, the test's place and the test.
 * @returns The value and its editor.
 */
function ThresholdValue(props: TestProps & { readonly test: ThresholdTest }) {
  const { spec, index, test, disabled, saveLabel } = props;
  const [op, setOp] = useState(test.op);
  const [text, setText] = useState(String(test.value));
  // Only the threshold of a threshold condition is dragged.
  const dragged = spec.condition.kind === 'threshold' ? (props.threshold ?? undefined) : undefined;
  const save = () => {
    const value = numberOf(text);
    if (value === undefined) return 'Type a number.';
    props.onChange(withTest(spec, index, { op, value }));
    return undefined;
  };
  return (
    <ValueEditor
      label="Threshold"
      text={thresholdTestWords(spec, test, dragged)}
      disabled={disabled}
      saveLabel={saveLabel}
      onSave={save}
    >
      <ThresholdFields op={op} text={text} onOp={setOp} onText={setText} />
    </ValueEditor>
  );
}

/** What the editor of a change holds while it is open. */
interface ChangeDraft {
  /** Whether it rises or drops. */
  readonly direction: ChangeTest['direction'];
  /** The amount, as typed. */
  readonly amount: string;
  /** A share of the earlier value, or a difference. */
  readonly unit: ChangeTest['unit'];
}

/**
 * The fields of a change: the direction, the amount and its unit.
 *
 * @param props - The values and their setter.
 * @param props.draft - The values.
 * @param props.onDraft - Sets them.
 * @returns The fields.
 */
function ChangeFields(props: {
  readonly draft: ChangeDraft;
  readonly onDraft: (draft: ChangeDraft) => void;
}) {
  const { draft, onDraft } = props;
  return (
    <>
      <div className={styles.editorRow}>
        <Select
          label="Direction"
          options={directions}
          value={draft.direction}
          onChange={(event) =>
            onDraft({ ...draft, direction: event.target.value as ChangeTest['direction'] })
          }
        />
        <Input
          label="By at least"
          mono
          inputMode="decimal"
          value={draft.amount}
          onChange={(event) => onDraft({ ...draft, amount: event.target.value })}
        />
      </div>
      <Select
        label="Measured"
        options={units}
        value={draft.unit}
        onChange={(event) => onDraft({ ...draft, unit: event.target.value as ChangeTest['unit'] })}
      />
    </>
  );
}

/**
 * The editor of a change test: rises or drops, by how much, in percent or in the value.
 *
 * @param props - The sentence's props, the test's place and the test.
 * @returns The value and its editor.
 */
function ChangeValue(props: TestProps & { readonly test: ChangeTest }) {
  const { spec, index, test, disabled, saveLabel } = props;
  const { direction, unit } = test;
  const [draft, setDraft] = useState<ChangeDraft>({ direction, unit, amount: String(test.amount) });
  const save = () => {
    const amount = numberOf(draft.amount);
    if (amount === undefined || amount <= 0) return 'Type a number above zero.';
    props.onChange(withTest(spec, index, { ...draft, amount }));
    return undefined;
  };
  return (
    <ValueEditor
      label="Change"
      text={changeTestWords(spec, test)}
      disabled={disabled}
      saveLabel={saveLabel}
      onSave={save}
    >
      <ChangeFields draft={draft} onDraft={setDraft} />
    </ValueEditor>
  );
}

/**
 * The span of a change: how far back the earlier point is.
 *
 * @param props - The sentence's props, the test's place and the test.
 * @returns The words when it is fixed, else the value and its editor.
 */
function withinValue(props: TestProps & { readonly test: ChangeTest }) {
  const apply = durationChange((spec, duration) => withWithin(spec, props.index, duration));
  return textValue(props, 'within', {
    label: 'Within',
    text: withinWords(props.test),
    initial: props.test.within,
    hint: 'How far back it compares, such as 10m; the window stays longer.',
    apply: (spec: AlertSpec, text: string) =>
      /^0+[smhd]$/.test(text.trim()) ? 'Use a duration above zero.' : apply(spec, text),
  });
}

/**
 * One test of the condition, after what it reads: "is above 2%", or "drops by at least 50% within
 * 10 minutes".
 *
 * @param props - The sentence's props and the test's place.
 * @returns The phrase, with its editors.
 */
export function TestPhrase(props: TestProps) {
  const test = conditionTests(props.spec.condition)[props.index];
  if (!test) return null;
  if (test.kind === 'threshold')
    return (
      <>
        is <ThresholdValue {...props} test={test} />
      </>
    );
  return (
    <>
      <ChangeValue {...props} test={test} /> within {withinValue({ ...props, test })}
    </>
  );
}

/**
 * What a part of a joined condition reads: its own number column, or the alert's value.
 *
 * @param props - The sentence's props and the part's place.
 * @returns The words when it is fixed, else the value and its editor.
 */
export function PartName(props: TestProps) {
  const test = conditionTests(props.spec.condition)[props.index];
  const field = test && 'field' in test ? test.field : undefined;
  return textValue(props, 'watch', {
    label: 'Value column',
    text: field === undefined ? 'it' : fieldWords(field) || field,
    initial: field ?? '',
    hint: "The number column this part reads; empty for the alert's value.",
    apply: (spec: AlertSpec, text: string) =>
      withTest(spec, props.index, { field: text.trim() === '' ? undefined : text.trim() }),
  });
}

/**
 * The word that joins the tests, with its editor: "and" when every test must hold, "or" when one
 * is enough.
 *
 * @param props - The sentence's props, and whether the word is plain: one editor is enough.
 * @returns The word.
 */
export function JoinerValue(props: ConditionSentenceProps & { readonly plain?: boolean }) {
  const { spec, disabled, saveLabel } = props;
  const kind = spec.condition.kind === 'any' ? 'any' : 'all';
  const [chosen, setChosen] = useState<'all' | 'any'>(kind);
  const word = kind === 'any' ? 'or' : 'and';
  if (props.plain) return <> {word} </>;
  const save = () => {
    props.onChange(withJoiner(spec, chosen));
    return undefined;
  };
  return (
    <>
      {' '}
      <ValueEditor
        label="Joined by"
        text={word}
        disabled={disabled}
        saveLabel={saveLabel}
        onSave={save}
      >
        <Select
          label="Joined by"
          options={joiners}
          value={chosen}
          onChange={(event) => setChosen(event.target.value as 'all' | 'any')}
        />
      </ValueEditor>{' '}
    </>
  );
}
