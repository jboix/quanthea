/**
 * The ratio of a draft in the condition sentence: ", divided by the requests of the second query
 * (0 when that is 0),". The column the second query is read by and what a division by 0 reads
 * each have an editor. The second query itself is the agent's to write, as the first is.
 */
import { type AlertSpec, type RatioZeroRule, ratioZeroRules } from '@quanthea/shared';
import { useState } from 'react';
import { Select } from '../../ui/select.tsx';
import { divisorWords, withDivisorField, withWhenZero, zeroWords } from './condition.ts';
import { type ConditionSentenceProps, textValue, ValueEditor } from './condition-editors.tsx';

/** What a division by 0 can read, as the editor offers it. */
const zeroOptions = ratioZeroRules.map((rule) => ({
  value: rule,
  label: rule === 'zero' ? '0: nothing to take a share of' : 'no value: it never fires then',
}));

/**
 * What the ratio reads when the second query's value is 0, with its editor.
 *
 * @param props - The sentence's props and the rule the spec has.
 * @returns The words when it is fixed, else the value and its editor.
 */
function ZeroValue(props: ConditionSentenceProps & { readonly rule: RatioZeroRule }) {
  const { spec, rule, disabled, saveLabel } = props;
  const [chosen, setChosen] = useState<RatioZeroRule>(rule);
  if (props.fixed?.includes('watch')) return zeroWords(rule);
  const save = () => {
    props.onChange(withWhenZero(spec, chosen));
    return undefined;
  };
  return (
    <ValueEditor
      label="When the second query is 0"
      text={zeroWords(rule)}
      disabled={disabled}
      saveLabel={saveLabel}
      onSave={save}
    >
      <Select
        label="When the second query is 0, the ratio is"
        options={zeroOptions}
        value={chosen}
        onChange={(event) => setChosen(event.target.value as RatioZeroRule)}
      />
    </ValueEditor>
  );
}

/**
 * The ratio, after what the alert watches: what it is divided by, and what a division by 0 reads.
 *
 * @param props - The sentence's props.
 * @returns The phrase with its editors, or nothing for an alert without a second query.
 */
export function RatioPhrase(props: ConditionSentenceProps) {
  const { dividedBy } = props.spec;
  if (!dividedBy) return null;
  const divisor = textValue(props, 'watch', {
    label: 'Divided by column',
    text: divisorWords(props.spec),
    initial: dividedBy.field ?? '',
    hint: 'The number column of the second query; empty for the first one.',
    apply: (spec: AlertSpec, text: string) => withDivisorField(spec, text),
  });
  return (
    <>
      , divided by {divisor} of the second query (
      <ZeroValue {...props} rule={dividedBy.whenZero} />
      ),
    </>
  );
}
