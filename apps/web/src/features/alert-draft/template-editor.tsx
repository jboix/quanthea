/**
 * The message template, edited by hand: the title, the body and the labelled fields, with only the
 * known placeholders. An unknown placeholder is refused before saving, as the schema refuses it.
 */
import { type MessageTemplate, messagePlaceholders, unknownPlaceholders } from '@quanthea/shared';
import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { TextArea } from '../../ui/text-area.tsx';
import styles from './alert-draft.module.css';

/** The placeholders, as a person types them. */
const known = messagePlaceholders.map((name) => `{${name}}`).join(', ');

/**
 * What is wrong with a text of the template.
 *
 * @param text - The text.
 * @returns The problem, if any: empty, or an unknown placeholder.
 */
export function templateProblem(text: string): string | undefined {
  if (text.trim() === '') return 'Write something here.';
  const unknown = unknownPlaceholders(text);
  if (unknown.length === 0) return undefined;
  return `Unknown placeholder ${unknown.map((name) => `{${name}}`).join(', ')}. Use ${known}.`;
}

/** A field while it is edited, with a key of its own. */
interface EditedField {
  /** Its key in the list. */
  readonly key: number;
  /** Its label. */
  readonly label: string;
  /** Its value, with placeholders. */
  readonly value: string;
}

/** A template while it is edited. */
interface EditedTemplate {
  /** The title. */
  readonly title: string;
  /** The body. */
  readonly body: string;
  /** The fields. */
  readonly fields: readonly EditedField[];
}

/**
 * The problems of a template, by text: `title`, `body`, `label-<key>`, `value-<key>`.
 *
 * @param template - The template.
 * @returns The problems; empty when it is fine.
 */
export function templateProblems(template: EditedTemplate): Record<string, string> {
  const texts: [string, string][] = [
    ['title', template.title],
    ['body', template.body],
    ...template.fields.flatMap((field): [string, string][] => [
      [`label-${field.key}`, field.label],
      [`value-${field.key}`, field.value],
    ]),
  ];
  return Object.fromEntries(
    texts.flatMap(([key, text]) => {
      const problem = templateProblem(text);
      return problem ? [[key, problem]] : [];
    }),
  );
}

/** Props of {@link TemplateEditor}. */
interface TemplateEditorProps {
  /** The template as saved. */
  readonly template: MessageTemplate;
  /** Saves the template. */
  readonly onSave: (template: MessageTemplate) => void;
  /** Closes the editor. */
  readonly onCancel: () => void;
}

/**
 * The template's fields: one row each, a label and a value.
 *
 * @param props - The fields, their problems, and the setter.
 * @param props.fields - The fields.
 * @param props.problems - The problems by key.
 * @param props.onChange - Sets the fields.
 * @returns The rows.
 */
function FieldRows({
  fields,
  problems,
  onChange,
}: {
  readonly fields: readonly EditedField[];
  readonly problems: Record<string, string>;
  readonly onChange: (fields: readonly EditedField[]) => void;
}) {
  const set = (key: number, change: Partial<EditedField>) =>
    onChange(fields.map((field) => (field.key === key ? { ...field, ...change } : field)));
  const next = Math.max(0, ...fields.map((field) => field.key)) + 1;
  return (
    <div className={styles.templateFields}>
      {fields.map((field) => (
        <div key={field.key} className={styles.editorRow}>
          <Input
            label="Field label"
            value={field.label}
            error={problems[`label-${field.key}`]}
            onChange={(event) => set(field.key, { label: event.target.value })}
          />
          <Input
            label="Field value"
            mono
            value={field.value}
            error={problems[`value-${field.key}`]}
            onChange={(event) => set(field.key, { value: event.target.value })}
          />
          <Button size="small" onClick={() => onChange(fields.filter((each) => each !== field))}>
            Remove
          </Button>
        </div>
      ))}
      {fields.length < 8 && (
        <Button
          size="small"
          onClick={() => onChange([...fields, { key: next, label: '', value: '' }])}
        >
          Add a field
        </Button>
      )}
    </div>
  );
}

/**
 * The template as edited, from the saved one.
 *
 * @param template - The saved template.
 * @returns The edited template.
 */
function editedOf(template: MessageTemplate): EditedTemplate {
  const fields = template.fields.map((field, index) => ({ key: index + 1, ...field }));
  return { title: template.title, body: template.body, fields };
}

/**
 * The template's title and body.
 *
 * @param props - The template, its problems and its setter.
 * @param props.draft - The template as edited.
 * @param props.problems - The problems by text.
 * @param props.onChange - Sets the template.
 * @returns The fields.
 */
function TemplateTexts({
  draft,
  problems,
  onChange,
}: {
  readonly draft: EditedTemplate;
  readonly problems: Record<string, string>;
  readonly onChange: (draft: EditedTemplate) => void;
}) {
  return (
    <>
      <Input
        label="Title"
        mono
        value={draft.title}
        error={problems.title}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
      />
      <TextArea
        label="Body"
        mono
        rows={3}
        value={draft.body}
        error={problems.body}
        hint={`Placeholders: ${known}.`}
        onChange={(event) => onChange({ ...draft, body: event.target.value })}
      />
    </>
  );
}

/**
 * The template editor.
 *
 * @param props - The template, the save and the cancel.
 * @returns The form.
 */
export function TemplateEditor({ template, onSave, onCancel }: TemplateEditorProps) {
  const [draft, setDraft] = useState(() => editedOf(template));
  const [tried, setTried] = useState(false);
  const problems = tried ? templateProblems(draft) : {};
  const save = () => {
    setTried(true);
    if (Object.keys(templateProblems(draft)).length > 0) return;
    const fields = draft.fields.map(({ label, value }) => ({ label, value }));
    onSave({ title: draft.title, body: draft.body, fields });
  };
  return (
    <form
      className={styles.editor}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <TemplateTexts draft={draft} problems={problems} onChange={setDraft} />
      <FieldRows
        fields={draft.fields}
        problems={problems}
        onChange={(fields) => setDraft({ ...draft, fields })}
      />
      <div className={styles.editorRow}>
        <Button type="submit" variant="primary" size="small">
          Save as a new version
        </Button>
        <Button size="small" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
