/**
 * An alert's condition as a sentence: "Fires when the error share of each service is above 2%
 * for 5 minutes, checked every minute." Each value is a small button that opens an inline editor.
 * A change reads "drops by at least 50% within 10 minutes", joined tests read one after the
 * other with "and" or "or", and a ratio reads "the errors of each service, divided by the
 * requests of the second query (0 when that is 0), is above 5%". In the draft pane saving it saves a new draft version by hand; the
 * alert page holds it unsaved.
 */
import { conditionTests } from '@quanthea/shared';
import { Fragment } from 'react';
import styles from './alert-draft.module.css';
import {
  byWords,
  durationWords,
  everyWords,
  watchWords,
  withBy,
  withEvery,
  withField,
  withFor,
} from './condition.ts';
import { type ConditionSentenceProps, durationChange, textValue } from './condition-editors.tsx';
import { holdLead, isJoined } from './condition-tests.ts';
import { RatioPhrase } from './ratio-editors.tsx';
import { JoinerValue, PartName, TestPhrase } from './test-editors.tsx';

/**
 * The tests of a joined condition, one after the other: what each reads, then what it compares.
 *
 * @param props - The sentence's props.
 * @returns The tests, joined by "and" or "or".
 */
function JoinedTests(props: ConditionSentenceProps) {
  const { watch } = seriesValues(props);
  const places = conditionTests(props.spec.condition).map((_test, place) => place);
  return places.map((place) => (
    <Fragment key={place}>
      {place > 0 && <JoinerValue {...props} plain={place > 1} />}
      {place === 0 ? watch : <PartName {...props} index={place} />}
      {place === 0 && <RatioPhrase {...props} />} <TestPhrase {...props} index={place} />
    </Fragment>
  ));
}

/**
 * What must hold, after "Fires when": the query returning nothing, the tests of a joined
 * condition for each series, or the one test of the alert's value.
 *
 * @param props - The sentence's props.
 * @returns The words and their editors.
 */
function Held(props: ConditionSentenceProps) {
  const { spec } = props;
  const { watch, by } = seriesValues(props);
  if (spec.condition.kind === 'no_data') return <> the query returns no value</>;
  if (isJoined(spec))
    return (
      <>
        , for {by}, <JoinedTests {...props} />,
      </>
    );
  return (
    <>
      {' '}
      {watch} of {by}
      <RatioPhrase {...props} /> <TestPhrase {...props} index={0} />
    </>
  );
}

/**
 * The condition as a sentence of values to change.
 *
 * @param props - The spec, the threshold being dragged, the save, and the parts that stay fixed.
 * @returns The sentence.
 */
export function ConditionSentence(props: ConditionSentenceProps) {
  const { hold, every } = timingValues(props);
  return (
    <p className={styles.sentence}>
      Fires when
      <Held {...props} /> {holdLead(props.spec)}
      {hold}, checked {every}.
    </p>
  );
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
