import { type DefinitionVersion, maxMeaningLength } from '@quanthea/shared';
import { useState } from 'react';
import { type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { TextArea } from '../../ui/text-area.tsx';
import type { DefinitionsIntent, DefinitionsOutcome } from './data.ts';
import styles from './definitions.module.css';

/** The editor's fields, as text. */
interface EditorFields {
  readonly id: string;
  readonly name: string;
  readonly synonyms: string;
  readonly meaning: string;
  readonly bodies: string;
}

/**
 * The fields of a definition, or empty ones for a new definition.
 *
 * @param version - The latest version, if the definition exists.
 * @returns The fields.
 */
function fieldsOf(version: DefinitionVersion | undefined): EditorFields {
  if (!version) return { id: '', name: '', synonyms: '', meaning: '', bodies: '[]' };
  const { id, name, synonyms, meaning, bodies } = version.definition;
  return {
    id,
    name,
    synonyms: synonyms.join(', '),
    meaning,
    bodies: JSON.stringify(bodies, null, 2),
  };
}

/**
 * The definition the fields describe, or why they cannot.
 *
 * @param fields - The fields.
 * @returns The definition, unchecked: the server checks it.
 */
function definitionOf(fields: EditorFields): { definition: unknown } | { error: string } {
  try {
    const bodies: unknown = JSON.parse(fields.bodies || '[]');
    const synonyms = fields.synonyms
      .split(',')
      .map((each) => each.trim())
      .filter(Boolean);
    return {
      definition: { id: fields.id, name: fields.name, synonyms, meaning: fields.meaning, bodies },
    };
  } catch {
    return { error: 'The checked filters are not valid JSON.' };
  }
}

/**
 * What the last save said: how many rows each body found, or why it was refused.
 *
 * @param props - The outcome.
 * @param props.outcome - The outcome, if any.
 * @returns The line, or nothing.
 */
function Outcome({ outcome }: { readonly outcome: DefinitionsOutcome | undefined }) {
  if (!outcome) return null;
  if (!outcome.ok) return <span className={styles.error}>{outcome.message}</span>;
  const empty = outcome.tests.some((test) => test.rows === 0);
  const runs = outcome.tests.map(
    (test) => `${test.language} on ${test.connector}: ${test.rows} rows`,
  );
  const text = ['Saved.', ...runs].join(' ');
  return (
    <span className={empty ? styles.warning : styles.ok}>
      {empty ? `${text} Zero rows: check the fields.` : text}
    </span>
  );
}

/** Props of {@link DefinitionEditor}. */
interface DefinitionEditorProps {
  /** The latest version, or nothing for a new definition. */
  readonly version: DefinitionVersion | undefined;
  /** Called once a definition was saved or deleted, with its id. */
  readonly onDone: (id: string | undefined) => void;
}

/** What the inputs need: the fields, and a setter for each. */
interface InputsProps {
  /** The fields. */
  readonly fields: EditorFields;
  /** Gives the setter of a field. */
  readonly set: (key: keyof EditorFields) => (value: string) => void;
}

/**
 * The editor's inputs that name the term: its id (new definitions only), name and synonyms.
 *
 * @param props - The fields, their setters, and whether the definition is new.
 * @param props.isNew - Whether the id can still be chosen.
 * @returns The inputs.
 */
function NameInputs({ fields, set, isNew }: InputsProps & { readonly isNew: boolean }) {
  return (
    <>
      {isNew && (
        <Input
          label="Id"
          mono
          hint="Such as error-rate: lowercase letters, digits and -."
          value={fields.id}
          onChange={(event) => set('id')(event.target.value)}
        />
      )}
      <Input
        label="Name"
        value={fields.name}
        onChange={(event) => set('name')(event.target.value)}
      />
      <Input
        label="Synonyms"
        hint="Separated by commas."
        value={fields.synonyms}
        onChange={(event) => set('synonyms')(event.target.value)}
      />
    </>
  );
}

/**
 * The editor's inputs that say what the term means: the meaning and the checked filters.
 *
 * @param props - The fields and their setters.
 * @returns The inputs.
 */
function MeaningInputs({ fields, set }: InputsProps) {
  return (
    <>
      <TextArea
        label="Meaning"
        hint={`What the agent reads, in one or two sentences. ${fields.meaning.length} of ${maxMeaningLength}.`}
        rows={3}
        maxLength={maxMeaningLength}
        value={fields.meaning}
        onChange={(event) => set('meaning')(event.target.value)}
      />
      <TextArea
        label="Checked filters"
        hint="Each a shape (measure, ratio, segment) and a query builder's request without its connector. Usually saved from a built panel."
        mono
        rows={8}
        value={fields.bodies}
        onChange={(event) => set('bodies')(event.target.value)}
      />
    </>
  );
}

/**
 * Submits the editor's intents, and keeps what the last one said.
 *
 * @param version - The latest version, or nothing for a new definition.
 * @param fields - The fields.
 * @returns The save and delete actions, whether one runs, and what to show after it.
 */
function useEditorActions(version: DefinitionVersion | undefined, fields: EditorFields) {
  const [local, setLocal] = useState<string | undefined>(undefined);
  const fetcher = useFetcher<DefinitionsOutcome>();
  const submit = (intent: DefinitionsIntent) =>
    void fetcher.submit(intent as unknown as SubmitTarget, {
      method: 'post',
      encType: 'application/json',
    });
  const save = () => {
    const built = definitionOf(fields);
    setLocal('error' in built ? built.error : undefined);
    if ('definition' in built)
      submit({ intent: 'save', definition: built.definition, basedOn: version?.version ?? null });
  };
  const remove = version
    ? () => submit({ intent: 'delete', id: version.definition.id, basedOn: version.version })
    : undefined;
  return { save, remove, busy: fetcher.state !== 'idle', local, outcome: fetcher.data };
}

/**
 * The editor of one definition, for editors and admins: its id (new ones only), name, synonyms,
 * meaning, and checked filters as JSON. Saving test-runs each body.
 *
 * @param props - The version and the done callback.
 * @returns The form.
 */
export function DefinitionEditor({ version, onDone }: DefinitionEditorProps) {
  const [fields, setFields] = useState(() => fieldsOf(version));
  const set = (key: keyof EditorFields) => (value: string) =>
    setFields({ ...fields, [key]: value });
  const actions = useEditorActions(version, fields);
  const label = version ? `Edit ${version.definition.name}` : 'New definition';
  return (
    <section className={styles.detail} aria-label={label}>
      <NameInputs fields={fields} set={set} isNew={!version} />
      <MeaningInputs fields={fields} set={set} />
      <div className={styles.actions}>
        <Button variant="primary" onClick={actions.save} disabled={actions.busy}>
          {version ? `Save as v${version.version + 1}` : 'Save'}
        </Button>
        {actions.remove && (
          <Button variant="danger" onClick={actions.remove} disabled={actions.busy}>
            Delete
          </Button>
        )}
        <Button onClick={() => onDone(version?.definition.id)}>Done</Button>
        {actions.local ? (
          <span className={styles.error}>{actions.local}</span>
        ) : (
          <Outcome outcome={actions.outcome} />
        )}
      </div>
    </section>
  );
}
