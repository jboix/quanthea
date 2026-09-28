import type { SchemaView } from '@querent/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { entitySummary, fieldMarker } from './schema-copy.ts';
import styles from './schema-panel.module.css';

/** One entity of a schema view. */
type SchemaEntity = SchemaView['entities'][number];

/** Props of {@link DescriptionEditor}. */
interface DescriptionEditorProps {
  /** The entity described. */
  readonly entity: string;
  /** The current text. */
  readonly text: string;
  /** Called with the new text; empty removes the admin's description. */
  readonly onSave: (text: string) => void;
  /** Called when the user gives up. */
  readonly onCancel: () => void;
}

/**
 * The inline form that edits an entity's description.
 *
 * @param props - The entity, its text and the callbacks.
 * @returns The form.
 */
function DescriptionEditor({ entity, text, onSave, onCancel }: DescriptionEditorProps) {
  const [value, setValue] = useState(text);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const save = (event: FormEvent) => {
    event.preventDefault();
    onSave(value.trim());
  };
  return (
    <form className={styles.editor} onSubmit={save}>
      <Input
        ref={input}
        label={`Description of ${entity}`}
        hideLabel
        value={value}
        maxLength={2000}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && onCancel()}
      />
      <Button type="submit" size="small" variant="primary">
        Save
      </Button>
      <Button size="small" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

/**
 * The fields of an expanded entity: name, type, and what the model gets.
 *
 * @param props - The entity.
 * @param props.entity - The entity.
 * @returns The field grid.
 */
function FieldGrid({ entity }: { readonly entity: SchemaEntity }) {
  return (
    <dl className={styles.fields}>
      {entity.fields.map((field) => {
        const marker = fieldMarker(field);
        return (
          <div key={field.name} className={styles.field}>
            <dt className={styles.fieldName}>{field.name}</dt>
            <dd className={styles.fieldType}>{field.type}</dd>
            <dd className={styles.marker} data-tone={marker?.tone}>
              {marker?.text}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Props of {@link SchemaEntityRow}. */
interface SchemaEntityRowProps {
  /** The entity. */
  readonly entity: SchemaEntity;
  /** Called with the entity's new description; empty removes it. */
  readonly onDescribe: (text: string) => void;
}

/**
 * One entity of the schema panel: name, counts, description, and its fields when expanded.
 *
 * @param props - The entity and the description callback.
 * @returns The list item.
 */
export function SchemaEntityRow({ entity, onDescribe }: SchemaEntityRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const description = entity.adminDescription ?? entity.description;
  return (
    <li className={styles.entity} data-expanded={expanded}>
      <button
        type="button"
        className={styles.entityHead}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={styles.entityName}>{entity.name}</span>
        <span className={styles.entityMeta}>{entitySummary(entity)}</span>
      </button>
      {editing ? (
        <DescriptionEditor
          entity={entity.name}
          text={entity.adminDescription ?? ''}
          onSave={(text) => {
            onDescribe(text);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <button type="button" className={styles.description} onClick={() => setEditing(true)}>
          {description ?? '[Add a description]'}
        </button>
      )}
      {expanded && <FieldGrid entity={entity} />}
    </li>
  );
}
