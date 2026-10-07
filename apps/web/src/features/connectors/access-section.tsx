import type { AccessLevel, ConnectorDetail, SchemaView } from '@quanthea/shared';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { Pill } from '../../ui/pill.tsx';
import { RadioCards } from '../../ui/radio-cards.tsx';
import { accessLevels } from './access-levels.ts';
import styles from './connector.module.css';
import { failureOf, useConnectorChange } from './use-connector-change.ts';

/** Props of the sections that edit a connector. */
interface SectionProps {
  /** The connector. */
  readonly connector: ConnectorDetail;
}

/**
 * The access level cards. A pick is saved at once.
 *
 * @param props - The connector.
 * @returns The cards, with any error.
 */
function AccessLevelCards({ connector }: SectionProps) {
  const change = useConnectorChange(connector.id);
  const pending = change.pendingIntent;
  const level =
    (pending?.intent === 'update' ? pending.patch.accessLevel : undefined) ?? connector.accessLevel;
  const options = accessLevels.map((copy) => ({
    ...copy,
    ...(copy.value === 2 ? { tag: 'default' } : {}),
  }));
  const error = failureOf(change.outcome);
  return (
    <>
      <RadioCards<AccessLevel>
        label="Access level"
        options={options}
        value={level}
        onChange={(accessLevel) => change.submit({ intent: 'update', patch: { accessLevel } })}
      />
      {error !== undefined && <p className={styles.failure}>{error}</p>}
    </>
  );
}

/** Props of {@link AddHiddenField}. */
interface AddHiddenFieldProps {
  /** The fields of the schema not hidden yet, as `entity.field`. */
  readonly candidates: readonly string[];
  /** Called with the field to hide. */
  readonly onAdd: (field: string) => void;
  /** Called when the user gives up. */
  readonly onCancel: () => void;
}

/**
 * The inline form that adds a hidden field, suggesting the schema's fields.
 *
 * @param props - The suggestions and callbacks.
 * @returns The form.
 */
function AddHiddenField({ candidates, onAdd, onCancel }: AddHiddenFieldProps) {
  const [value, setValue] = useState('');
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim() !== '') onAdd(value.trim());
  };
  return (
    <form className={styles.addField} onSubmit={add}>
      <Input
        ref={input}
        label="Column to hide"
        hideLabel
        mono
        list={listId}
        placeholder="table.column"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && onCancel()}
      />
      <datalist id={listId}>
        {candidates.map((candidate) => (
          <option key={candidate} value={candidate} />
        ))}
      </datalist>
      <Button type="submit" size="small">
        Hide
      </Button>
      <Button size="small" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

/**
 * The fields of a schema that are not hidden yet.
 *
 * @param schema - The schema.
 * @param hidden - The hidden fields.
 * @returns `entity.field` names.
 */
function hideableFields(schema: SchemaView, hidden: readonly string[]): string[] {
  return schema.entities
    .flatMap((entity) => entity.fields.map((field) => `${entity.name}.${field.name}`))
    .filter((name) => !hidden.includes(name));
}

/** Props of {@link HiddenChips}. */
interface HiddenChipsProps {
  /** The hidden fields. */
  readonly hidden: readonly string[];
  /** The fields of the schema, for suggestions. */
  readonly schema: SchemaView;
  /** Saves a new list of hidden fields. */
  readonly save: (hiddenFields: string[]) => void;
}

/**
 * The hidden fields as removable chips, followed by the Add column button or its form.
 *
 * @param props - The hidden fields, the schema and the save callback.
 * @returns The chips.
 */
function HiddenChips({ hidden, schema, save }: HiddenChipsProps) {
  const [adding, setAdding] = useState(false);
  const add = (field: string) => {
    save([...hidden, field]);
    setAdding(false);
  };
  return (
    <div className={styles.chips}>
      {hidden.map((field) => (
        <Pill
          key={field}
          tone="danger"
          shape="tag"
          mono
          removeLabel={`Stop hiding ${field}`}
          onRemove={() => save(hidden.filter((other) => other !== field))}
        >
          {field}
        </Pill>
      ))}
      {adding ? (
        <AddHiddenField
          candidates={hideableFields(schema, hidden)}
          onAdd={add}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" className={styles.addChip} onClick={() => setAdding(true)}>
          Add column
        </button>
      )}
    </div>
  );
}

/**
 * The hidden fields card. Changes are saved at once.
 *
 * @param props - The connector and its schema.
 * @param props.schema - The cached schema, for suggestions.
 * @returns The card.
 */
function HiddenFields({ connector, schema }: SectionProps & { readonly schema: SchemaView }) {
  const change = useConnectorChange(connector.id);
  const pending = change.pendingIntent;
  const hidden =
    (pending?.intent === 'update' ? pending.patch.hiddenFields : undefined) ??
    connector.hiddenFields;
  const save = (hiddenFields: string[]) =>
    change.submit({ intent: 'update', patch: { hiddenFields } });
  const error = failureOf(change.outcome);
  return (
    <div className={styles.card}>
      <h4 className={styles.cardTitle}>Hide these columns from the model, by name</h4>
      <HiddenChips hidden={hidden} schema={schema} save={save} />
      {error !== undefined && <p className={styles.failure}>{error}</p>}
      <p className={styles.cardNote}>
        A hidden column is removed from every result by its name, in any case, so{' '}
        <code>customers.email</code> hides every column named <code>email</code>, and a hidden
        object hides the fields under it. A query that renames a column gets past the name match,
        and from the aggregates level its values show. For a hard guarantee, leave the column out of
        the database role.
      </p>
    </div>
  );
}

/**
 * What the model can see: the access level and the hidden fields.
 *
 * @param props - The connector and its schema.
 * @param props.schema - The cached schema.
 * @returns The section.
 */
export function AccessSection({
  connector,
  schema,
}: SectionProps & { readonly schema: SchemaView }) {
  return (
    <section className={styles.section} aria-labelledby="access-title">
      <div className={styles.sectionHead}>
        <h3 id="access-title" className={styles.sectionTitle}>
          What the model can see
        </h3>
        <p className={styles.sectionSubtitle}>
          Rows never go to the model unless you pick Full access.
        </p>
      </div>
      <AccessLevelCards connector={connector} />
      <HiddenFields connector={connector} schema={schema} />
    </section>
  );
}
