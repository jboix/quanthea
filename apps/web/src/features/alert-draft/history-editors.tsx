/**
 * The editors of the tests that compare a series with its own history: how far above or below its
 * value a period before, and how far back that is; how many deviations from its mean, on which
 * side, and how long the baseline is.
 */
import {
  type AlertSpec,
  bandBaselineMs,
  bandDeviations,
  durationMs,
  type PastPeriod,
  pastPeriods,
} from '@quanthea/shared';
import { useState } from 'react';
import { Input } from '../../ui/input.tsx';
import { Select } from '../../ui/select.tsx';
import styles from './alert-draft.module.css';
import { durationWords, isDuration } from './condition.ts';
import { numberOf, type TestProps, textValue, ValueEditor } from './condition-editors.tsx';
import {
  agoWords,
  type BandTest,
  bandTestWords,
  type PastTest,
  pastTestWords,
  withTest,
} from './condition-tests.ts';

/** The sides of a comparison with the past. */
const directions = [
  { value: 'up', label: 'above' },
  { value: 'down', label: 'below' },
];

/** The units of a comparison with the past. */
const units = [
  { value: 'percent', label: '% of the value then' },
  { value: 'absolute', label: 'in the value itself' },
];

/** How far back a comparison with the past looks. */
const periods = pastPeriods.map((ago) => ({
  value: ago,
  label: agoWords({ ago } as PastTest),
}));

/** The sides of a band that fire. */
const sides = [
  { value: 'either', label: 'from: either side' },
  { value: 'above', label: 'above' },
  { value: 'below', label: 'below' },
];

/** What the editor of a comparison with the past holds while it is open. */
interface PastDraft {
  /** Above or below the value then. */
  readonly direction: PastTest['direction'];
  /** The amount, as typed. */
  readonly amount: string;
  /** A share of the value then, or a difference. */
  readonly unit: PastTest['unit'];
}

/**
 * The fields of a comparison with the past: the amount, its unit and the side.
 *
 * @param props - The values and their setter.
 * @param props.draft - The values.
 * @param props.onDraft - Sets them.
 * @returns The fields.
 */
function PastFields(props: {
  readonly draft: PastDraft;
  readonly onDraft: (draft: PastDraft) => void;
}) {
  const { draft, onDraft } = props;
  return (
    <>
      <div className={styles.editorRow}>
        <Input
          label="At least"
          mono
          inputMode="decimal"
          value={draft.amount}
          onChange={(event) => onDraft({ ...draft, amount: event.target.value })}
        />
        <Select
          label="Side"
          options={directions}
          value={draft.direction}
          onChange={(event) =>
            onDraft({ ...draft, direction: event.target.value as PastTest['direction'] })
          }
        />
      </div>
      <Select
        label="Measured"
        options={units}
        value={draft.unit}
        onChange={(event) => onDraft({ ...draft, unit: event.target.value as PastTest['unit'] })}
      />
    </>
  );
}

/**
 * The editor of a comparison with the past: by how much, in percent or in the value, and above or
 * below.
 *
 * @param props - The sentence's props, the test's place and the test.
 * @returns The value and its editor.
 */
function PastValue(props: TestProps & { readonly test: PastTest }) {
  const { spec, index, test, disabled, saveLabel } = props;
  const { direction, unit } = test;
  const [draft, setDraft] = useState<PastDraft>({ direction, unit, amount: String(test.amount) });
  const save = () => {
    const amount = numberOf(draft.amount);
    if (amount === undefined || amount <= 0) return 'Type a number above zero.';
    props.onChange(withTest(spec, index, { ...draft, amount }));
    return undefined;
  };
  return (
    <ValueEditor
      label="Against the past"
      text={pastTestWords(spec, test)}
      disabled={disabled}
      saveLabel={saveLabel}
      onSave={save}
    >
      <PastFields draft={draft} onDraft={setDraft} />
    </ValueEditor>
  );
}

/**
 * How far back a comparison with the past looks: an hour, a day or a week.
 *
 * @param props - The sentence's props, the test's place and the test.
 * @returns The words when it is fixed, else the value and its editor.
 */
function AgoValue(props: TestProps & { readonly test: PastTest }) {
  const { spec, index, test, disabled, saveLabel } = props;
  const [ago, setAgo] = useState<PastPeriod>(test.ago);
  if (props.fixed?.includes('within')) return agoWords(test);
  const save = () => {
    props.onChange(withTest(spec, index, { ago }));
    return undefined;
  };
  return (
    <ValueEditor
      label="Compared with"
      text={agoWords(test)}
      disabled={disabled}
      saveLabel={saveLabel}
      onSave={save}
    >
      <Select
        label="Compared with"
        options={periods}
        value={ago}
        onChange={(event) => setAgo(event.target.value as PastPeriod)}
      />
    </ValueEditor>
  );
}

/**
 * A comparison with the past, after what it reads: "is at least 30% above its value a week
 * earlier".
 *
 * @param props - The sentence's props, the test's place and the test.
 * @returns The phrase, with its editors.
 */
export function PastPhrase(props: TestProps & { readonly test: PastTest }) {
  return (
    <>
      is <PastValue {...props} /> its value <AgoValue {...props} />
    </>
  );
}

/** What the editor of a band holds while it is open. */
interface BandDraft {
  /** Which side fires. */
  readonly side: BandTest['side'];
  /** The deviations, as typed. */
  readonly deviations: string;
}

/**
 * The fields of a band: how many deviations, and which side fires.
 *
 * @param props - The values and their setter.
 * @param props.draft - The values.
 * @param props.onDraft - Sets them.
 * @returns The fields.
 */
function BandFields(props: {
  readonly draft: BandDraft;
  readonly onDraft: (draft: BandDraft) => void;
}) {
  const { draft, onDraft } = props;
  return (
    <div className={styles.editorRow}>
      <Input
        label="Deviations"
        mono
        inputMode="decimal"
        value={draft.deviations}
        onChange={(event) => onDraft({ ...draft, deviations: event.target.value })}
      />
      <Select
        label="Side"
        options={sides}
        value={draft.side}
        onChange={(event) => onDraft({ ...draft, side: event.target.value as BandTest['side'] })}
      />
    </div>
  );
}

/**
 * The editor of a band's width and side: how many deviations, and which side fires.
 *
 * @param props - The sentence's props, the test's place and the test.
 * @returns The value and its editor.
 */
function BandValue(props: TestProps & { readonly test: BandTest }) {
  const { spec, index, test, disabled, saveLabel } = props;
  const [draft, setDraft] = useState<BandDraft>({
    side: test.side,
    deviations: String(test.deviations),
  });
  const save = () => {
    const deviations = numberOf(draft.deviations);
    const { min, max } = bandDeviations;
    if (deviations === undefined || deviations < min || deviations > max)
      return `Type a number from ${min} to ${max}.`;
    props.onChange(withTest(spec, index, { side: draft.side, deviations }));
    return undefined;
  };
  return (
    <ValueEditor
      label="Band"
      text={bandTestWords(test)}
      disabled={disabled}
      saveLabel={saveLabel}
      onSave={save}
    >
      <BandFields draft={draft} onDraft={setDraft} />
    </ValueEditor>
  );
}

/**
 * Applies a typed baseline to a band, or says why not.
 *
 * @param spec - The spec.
 * @param index - The band test.
 * @param text - The baseline, as typed.
 * @returns The new spec, or what is wrong.
 */
function withBaseline(spec: AlertSpec, index: number, text: string): AlertSpec | string {
  const baseline = text.trim();
  const length = isDuration(baseline) ? durationMs(baseline) : Number.NaN;
  if (!(length >= bandBaselineMs.min && length <= bandBaselineMs.max))
    return 'Use a baseline from 1h to 7d, such as 6h or 1d.';
  return withTest(spec, index, { baseline });
}

/**
 * A band, after what it reads: "is more than 3 deviations from its mean of the last day".
 *
 * @param props - The sentence's props, the test's place and the test.
 * @returns The phrase, with its editors.
 */
export function BandPhrase(props: TestProps & { readonly test: BandTest }) {
  const baseline = textValue(props, 'within', {
    label: 'Baseline',
    text: durationWords(props.test.baseline).replace(/^1 /, ''),
    initial: props.test.baseline,
    hint: 'The history before the window the band is learned from, 1h to 7d.',
    apply: (spec: AlertSpec, text: string) => withBaseline(spec, props.index, text),
  });
  return (
    <>
      is <BandValue {...props} /> its mean of the last {baseline}
    </>
  );
}
