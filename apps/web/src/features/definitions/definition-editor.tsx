import { type DefinitionVersion, maxMeaningLength } from '@quanthea/shared';
import { useState } from 'react';
import { type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { TextArea } from '../../ui/text-area.tsx';
import { BodyForm } from './body-form.tsx';
import { type BodyDraft, bodyOfDraft, draftOfBody, emptyDraft } from './body-form-model.ts';
import type { DefinitionsIntent, DefinitionsOutcome } from './data.ts';
import styles from './definitions.module.css';
import editor from './editor.module.css';

/** One body in the editor: a form, or JSON for a request the form does not write. */
type BodyItem =
  | { readonly kind: 'form'; readonly draft: BodyDraft }
  | { readonly kind: 'json'; readonly text: string };

/** The editor's fields. */
interface EditorFields {
  readonly id: string;
  readonly name: string;
  readonly synonyms: string;
  readonly meaning: string;
  readonly bodies: readonly BodyItem[];
}

/**
 * An id from a name, as a new definition takes it until the person writes one.
 *
 * @param name - The name.
 * @returns Such as `failure-rate`.
 */
export function idFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return /^[a-z]/.test(slug) ? slug : `d-${slug}`.replace(/-$/, '');
}

/**
 * The fields of a definition, or empty ones for a new definition.
 *
 * @param version - The latest version, if the definition exists.
 * @returns The fields.
 */
function fieldsOf(version: DefinitionVersion | undefined): EditorFields {
  if (!version) return { id: '', name: '', synonyms: '', meaning: '', bodies: [] };
  const { id, name, synonyms, meaning, bodies } = version.definition;
  const items = bodies.map((body): BodyItem => {
    const draft = draftOfBody(body);
    return draft ? { kind: 'form', draft } : { kind: 'json', text: JSON.stringify(body, null, 2) };
  });
  return { id, name, synonyms: synonyms.join(', '), meaning, bodies: items };
}

/**
 * The definition the fields describe, or why they cannot.
 *
 * @param fields - The fields.
 * @param isNew - Whether the id comes from the name.
 * @returns The definition, unchecked: the server checks it.
 */
function definitionOf(
  fields: EditorFields,
  isNew: boolean,
): { definition: unknown } | { error: string } {
  try {
    const bodies = fields.bodies.map((item): unknown =>
      item.kind === 'form' ? bodyOfDraft(item.draft) : JSON.parse(item.text),
    );
    const synonyms = fields.synonyms
      .split(',')
      .map((each) => each.trim())
      .filter(Boolean);
    const id = isNew && fields.id === '' ? idFromName(fields.name) : fields.id;
    return { definition: { id, name: fields.name, synonyms, meaning: fields.meaning, bodies } };
  } catch {
    return { error: 'Some checked filters written as JSON are not valid JSON.' };
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
  if (!outcome.ok) return <span className={editor.error}>{outcome.message}</span>;
  if (!('tests' in outcome)) return null;
  const empty = outcome.tests.some((test) => test.rows === 0);
  const runs = outcome.tests.map(
    (test) => `${test.language} on ${test.connector}: ${test.rows} rows`,
  );
  const text = ['Saved.', ...runs].join(' ');
  return (
    <span className={empty ? editor.warning : editor.ok}>
      {empty ? `${text} Zero rows: check the fields and values.` : text}
    </span>
  );
}

/**
 * The id the last save saved, if it saved one.
 *
 * @param outcome - What the last save said.
 * @returns The id, or `undefined`.
 */
function savedId(outcome: DefinitionsOutcome | undefined): string | undefined {
  return outcome?.ok && 'id' in outcome ? outcome.id : undefined;
}

/** Props of {@link DefinitionEditor}. */
interface DefinitionEditorProps {
  /** The latest version, or nothing for a new definition. */
  readonly version: DefinitionVersion | undefined;
  /** Called once a definition was saved or deleted, with its id. */
  readonly onDone: (id: string | undefined) => void;
}

/** What the inputs need: the fields, and a setter of each. */
interface InputsProps {
  readonly fields: EditorFields;
  readonly set: (change: Partial<EditorFields>) => void;
}

/**
 * The inputs that say what the term is and means: its name, the id of a new one, the other words
 * for it, and its meaning.
 *
 * @param props - The fields, the setter, and whether the definition is new.
 * @param props.isNew - Whether the id can still be chosen.
 * @returns The inputs.
 */
function TermInputs({ fields, set, isNew }: InputsProps & { readonly isNew: boolean }) {
  const id = fields.id === '' ? idFromName(fields.name) : fields.id;
  return (
    <>
      <Input
        label="Name"
        placeholder="Failure rate"
        hint={isNew && fields.name !== '' ? `Its id is ${id}.` : undefined}
        value={fields.name}
        onChange={(event) => set({ name: event.target.value })}
      />
      <TextArea
        label="What it means"
        hint={`Write it as you would explain it to a new colleague: what is counted, over what. ${fields.meaning.length} of ${maxMeaningLength}.`}
        placeholder="The share of orders that failed, out of all orders placed."
        rows={3}
        maxLength={maxMeaningLength}
        value={fields.meaning}
        onChange={(event) => set({ meaning: event.target.value })}
      />
      <Input
        label="Other words for it"
        hint="Separated by commas. The agent treats them as the same term."
        placeholder="fail rate, order failures"
        value={fields.synonyms}
        onChange={(event) => set({ synonyms: event.target.value })}
      />
    </>
  );
}

/**
 * One body in the editor: the form, or its JSON.
 *
 * @param props - The body, and the change and remove callbacks.
 * @param props.item - The body.
 * @param props.onChange - Changes it.
 * @param props.onRemove - Removes it.
 * @returns The editor of the body.
 */
function BodyItemEditor({
  item,
  onChange,
  onRemove,
}: {
  readonly item: BodyItem;
  readonly onChange: (item: BodyItem) => void;
  readonly onRemove: () => void;
}) {
  if (item.kind === 'form')
    return (
      <BodyForm
        draft={item.draft}
        onChange={(draft) => onChange({ kind: 'form', draft })}
        onRemove={onRemove}
      />
    );
  return (
    <div className={editor.bodyForm}>
      <TextArea
        label="Checked filters, as a query builder request"
        hint="The form cannot show this one. Ask the assistant to change it, or edit the JSON."
        mono
        rows={8}
        value={item.text}
        onChange={(event) => onChange({ kind: 'json', text: event.target.value })}
      />
      <Button size="small" variant="danger" onClick={onRemove}>
        Remove these filters
      </Button>
    </div>
  );
}

/**
 * The checked filters: one form per language, and a button that adds one.
 *
 * @param props - The fields and the setter.
 * @returns The section.
 */
function BodyInputs({ fields, set }: InputsProps) {
  const change = (index: number, item: BodyItem) =>
    set({ bodies: fields.bodies.map((each, at) => (at === index ? item : each)) });
  return (
    <section className={editor.bodiesSection} aria-label="Checked filters">
      <h3 className={styles.sectionTitle}>Checked filters</h3>
      <p className={editor.hint}>
        Optional. They make the meaning exact: every dashboard built from this term copies them.
        Saving test-runs them over the last day.
      </p>
      {fields.bodies.map((item, index) => (
        <BodyItemEditor
          // biome-ignore lint/suspicious/noArrayIndexKey: bodies have no id, and keep their place.
          key={index}
          item={item}
          onChange={(changed) => change(index, changed)}
          onRemove={() => set({ bodies: fields.bodies.filter((_, at) => at !== index) })}
        />
      ))}
      <Button
        onClick={() =>
          set({ bodies: [...fields.bodies, { kind: 'form', draft: emptyDraft('sql') }] })
        }
      >
        Add checked filters
      </Button>
    </section>
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
      action: '/definitions',
    });
  const save = () => {
    const built = definitionOf(fields, !version);
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
 * The editor of one definition, for editors and admins: its name, meaning and other words, and
 * its checked filters as a form, with what they say in words. Saving test-runs each body.
 *
 * @param props - The version and the done callback.
 * @returns The form.
 */
export function DefinitionEditor({ version, onDone }: DefinitionEditorProps) {
  const [fields, setFields] = useState(() => fieldsOf(version));
  const set = (change: Partial<EditorFields>) => setFields({ ...fields, ...change });
  const actions = useEditorActions(version, fields);
  const label = version ? `Edit ${version.definition.name}` : 'New definition';
  return (
    <section className={styles.detail} aria-label={label}>
      <h2 className={styles.title}>{label}</h2>
      <TermInputs fields={fields} set={set} isNew={!version} />
      <BodyInputs fields={fields} set={set} />
      <div className={editor.actions}>
        <Button variant="primary" onClick={actions.save} disabled={actions.busy}>
          {version ? `Save as v${version.version + 1}` : 'Save'}
        </Button>
        <Button onClick={() => onDone(savedId(actions.outcome) ?? version?.definition.id)}>
          Done
        </Button>
        {actions.remove && (
          <Button
            variant="danger"
            className={editor.delete}
            onClick={actions.remove}
            disabled={actions.busy}
          >
            Delete
          </Button>
        )}
        {actions.local ? (
          <span className={editor.error}>{actions.local}</span>
        ) : (
          <Outcome outcome={actions.outcome} />
        )}
      </div>
    </section>
  );
}
