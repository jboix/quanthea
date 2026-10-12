import type { AccessLevel, ConnectorDetail, SchemaView } from '@quanthea/shared';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Pill } from '../../ui/pill.tsx';
import { RadioCards } from '../../ui/radio-cards.tsx';
import { SuggestInput } from '../../ui/suggest-input.tsx';
import { accessLevels } from './access-levels.ts';
import { AccessWarning } from './access-warning.tsx';
import styles from './connector.module.css';
import { hideableFields, schemaNames } from './hidden-names.ts';
import { useAccessGuard } from './use-access-guard.ts';
import { failureOf } from './use-connector-change.ts';

/** Props of the sections that edit a connector. */
interface SectionProps {
  /** The connector. */
  readonly connector: ConnectorDetail;
}

/**
 * The access level cards. A pick is saved at once, unless it lowers the level of data threads
 * already hold: then it waits for the admin to confirm.
 *
 * @param props - The connector.
 * @returns The cards, with any warning or error.
 */
function AccessLevelCards({ connector }: SectionProps) {
  const guard = useAccessGuard(connector);
  const { change } = guard;
  const pending = change.pendingIntent;
  const level =
    (pending?.intent === 'update' ? pending.patch.accessLevel : undefined) ??
    guard.proposed?.accessLevel ??
    connector.accessLevel;
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
        onChange={(accessLevel) => guard.propose({ accessLevel })}
      />
      <AccessWarning guard={guard} />
      {error !== undefined && <p className={styles.failure}>{error}</p>}
    </>
  );
}

/** Props of {@link AddHiddenField}. */
interface AddHiddenFieldProps {
  /** The fields of the schema not hidden yet, as `entity.field`. */
  readonly candidates: readonly string[];
  /** Whether a name hides a field of the schema. */
  readonly inSchema: (name: string) => boolean;
  /** Called with the field to hide. */
  readonly onAdd: (field: string) => void;
  /** Called when the user gives up. */
  readonly onCancel: () => void;
}

/**
 * The inline form that adds a hidden field, suggesting the schema's fields while typing. A name
 * the schema lacks is marked and still added: the column may come later, or from a query.
 *
 * @param props - The suggestions, the schema test and the callbacks.
 * @returns The form.
 */
function AddHiddenField({ candidates, inSchema, onAdd, onCancel }: AddHiddenFieldProps) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim() !== '') onAdd(value.trim());
  };
  return (
    <form className={styles.addField} onSubmit={add}>
      <SuggestInput
        ref={input}
        label="Column to hide"
        hideLabel
        mono
        placeholder="table.column"
        suggestions={candidates}
        isKnown={inSchema}
        unknownNote="Not in the schema. It is hidden all the same, wherever a result has it."
        value={value}
        onChange={setValue}
        onCommit={onAdd}
        onCancel={onCancel}
      />
      <Button type="submit" size="small">
        Hide
      </Button>
      <Button size="small" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

/** Props of {@link HiddenChip}. */
interface HiddenChipProps {
  /** The hidden name. */
  readonly field: string;
  /** Whether the schema has it. */
  readonly known: boolean;
  /** Called to stop hiding it. */
  readonly onRemove: () => void;
}

/**
 * One hidden name as a removable chip. A name the schema lacks is amber and says so.
 *
 * @param props - The name, whether the schema has it, and the remove callback.
 * @returns The chip.
 */
function HiddenChip({ field, known, onRemove }: HiddenChipProps) {
  return (
    <Pill
      tone={known ? 'danger' : 'draft'}
      shape="tag"
      mono
      removeLabel={`Stop hiding ${field}`}
      onRemove={onRemove}
    >
      {field}
      {!known && <span className={styles.chipNote}>not in the schema</span>}
    </Pill>
  );
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
  const inSchema = useMemo(() => schemaNames(schema), [schema]);
  const add = (field: string) => {
    if (!hidden.includes(field)) save([...hidden, field]);
    setAdding(false);
  };
  return (
    <div className={styles.chips}>
      {hidden.map((field) => (
        <HiddenChip
          key={field}
          field={field}
          known={inSchema(field)}
          onRemove={() => save(hidden.filter((other) => other !== field))}
        />
      ))}
      {adding ? (
        <AddHiddenField
          candidates={hideableFields(schema, hidden)}
          inSchema={inSchema}
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
 * The hidden fields card. Changes are saved at once, unless they hide a field from data threads
 * already hold: then they wait for the admin to confirm.
 *
 * @param props - The connector and its schema.
 * @param props.schema - The cached schema, for suggestions.
 * @returns The card.
 */
function HiddenFields({ connector, schema }: SectionProps & { readonly schema: SchemaView }) {
  const guard = useAccessGuard(connector);
  const pending = guard.change.pendingIntent;
  const hidden =
    (pending?.intent === 'update' ? pending.patch.hiddenFields : undefined) ??
    guard.proposed?.hiddenFields ??
    connector.hiddenFields;
  const save = (hiddenFields: string[]) => guard.propose({ hiddenFields });
  const error = failureOf(guard.change.outcome);
  return (
    <div className={styles.card}>
      <h4 className={styles.cardTitle}>Hide these columns from the model, by name</h4>
      <HiddenChips hidden={hidden} schema={schema} save={save} />
      <AccessWarning guard={guard} />
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
