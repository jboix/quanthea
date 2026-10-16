import type { Definition, DefinitionBody, DefinitionVersion } from '@quanthea/shared';
import { useState } from 'react';
import { type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { Input } from '../../ui/input.tsx';
import { Select } from '../../ui/select.tsx';
import { TextArea } from '../../ui/text-area.tsx';
import {
  bodyPlace,
  bodyWords,
  type DefinitionsIntent,
  type DefinitionsOutcome,
  idFromName,
} from '../definitions/index.ts';
import styles from './inspector.module.css';
import { withBody } from './panel-body.ts';

/** A new definition's fields; its id comes from its name. */
interface NewFields {
  readonly name: string;
  readonly meaning: string;
}

/**
 * The definition to save: an existing one with the body put in, or a new one holding it.
 *
 * @param chosen - The existing definition, if one was picked.
 * @param fields - The new definition's fields.
 * @param body - The body.
 * @returns The definition and the version it is based on.
 */
function toSave(chosen: DefinitionVersion | undefined, fields: NewFields, body: DefinitionBody) {
  if (chosen) return { definition: withBody(chosen.definition, body), basedOn: chosen.version };
  const id = idFromName(fields.name);
  const definition: Definition = { ...fields, id, synonyms: [], bodies: [body] };
  return { definition, basedOn: null };
}

/**
 * What the save said: saved with the rows the test run found, or why not.
 *
 * @param outcome - The outcome, if any.
 * @returns The words, if any.
 */
function outcomeWords(outcome: DefinitionsOutcome | undefined): string | undefined {
  if (!outcome) return undefined;
  if (!outcome.ok) return outcome.message;
  if (!('tests' in outcome)) return undefined;
  const rows = outcome.tests.map((test) => `${test.rows} rows on ${test.connector}`).join(', ');
  return `Saved as ${outcome.id}. The test run found ${rows}.`;
}

/** Props of {@link SaveDefinition}. */
interface SaveDefinitionProps {
  /** The panel's filters, as a body. */
  readonly body: DefinitionBody;
  /** The definitions there are. */
  readonly definitions: readonly DefinitionVersion[];
}

/**
 * Saves a built panel's filters as a definition's checked body, for its language: into an
 * existing definition, replacing the body it had there, or as a new one. From then on panels built
 * from the definition copy these filters.
 *
 * @param props - The body and the definitions.
 * @returns The button and its dialog.
 */
export function SaveDefinition({ body, definitions }: SaveDefinitionProps) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState('new');
  const [fields, setFields] = useState<NewFields>({ name: '', meaning: '' });
  const fetcher = useFetcher<DefinitionsOutcome>();
  const chosen = definitions.find((each) => each.definition.id === picked);
  const save = () => {
    const intent: DefinitionsIntent = { intent: 'save', ...toSave(chosen, fields, body) };
    void fetcher.submit(intent as unknown as SubmitTarget, {
      method: 'post',
      action: '/definitions',
      encType: 'application/json',
    });
  };
  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        Save as definition
      </Button>
      <Dialog title="Save these filters as a definition" open={open} onClose={() => setOpen(false)}>
        <BodyWords body={body} />
        <DefinitionChoice definitions={definitions} picked={picked} onPick={setPicked} />
        {!chosen && <NewDefinitionFields fields={fields} onChange={setFields} />}
        <div className={styles.dialogActions}>
          <Button variant="primary" onClick={save} disabled={fetcher.state !== 'idle'}>
            Save
          </Button>
          <span className={styles.dialogNote}>{outcomeWords(fetcher.data)}</span>
        </div>
      </Dialog>
    </>
  );
}

/**
 * The filters being saved, in words.
 *
 * @param props - The body.
 * @param props.body - The body.
 * @returns The lines.
 */
function BodyWords({ body }: { readonly body: DefinitionBody }) {
  return (
    <p className={styles.bodyWords}>
      <strong>{bodyPlace(body)}</strong> {bodyWords(body)}
    </p>
  );
}

/**
 * Which definition the filters go into.
 *
 * @param props - The definitions, the one picked and the pick callback.
 * @param props.definitions - The definitions there are.
 * @param props.picked - The id picked, or `new`.
 * @param props.onPick - Picks one.
 * @returns The select.
 */
function DefinitionChoice({
  definitions,
  picked,
  onPick,
}: {
  readonly definitions: readonly DefinitionVersion[];
  readonly picked: string;
  readonly onPick: (id: string) => void;
}) {
  const options = [
    { value: 'new', label: 'A new definition' },
    ...definitions.map(({ definition }) => ({ value: definition.id, label: definition.name })),
  ];
  return (
    <Select
      label="Definition"
      hint="An existing definition keeps its meaning; these filters replace its filters for this language."
      options={options}
      value={picked}
      onChange={(event) => onPick(event.target.value)}
    />
  );
}

/**
 * A new definition's id, name and meaning.
 *
 * @param props - The fields and the change callback.
 * @param props.fields - The fields.
 * @param props.onChange - Changes them.
 * @returns The inputs.
 */
function NewDefinitionFields({
  fields,
  onChange,
}: {
  readonly fields: NewFields;
  readonly onChange: (fields: NewFields) => void;
}) {
  return (
    <>
      <Input
        label="Name"
        value={fields.name}
        onChange={(event) => onChange({ ...fields, name: event.target.value })}
      />
      <TextArea
        label="Meaning"
        hint="What it means, as you would explain it to a new colleague."
        rows={3}
        value={fields.meaning}
        onChange={(event) => onChange({ ...fields, meaning: event.target.value })}
      />
    </>
  );
}
