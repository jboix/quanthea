import type { ConnectorDetail, SchemaView } from '@quanthea/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { readTime, schemaSummary } from './schema-copy.ts';
import { SchemaEntityRow } from './schema-entity.tsx';
import styles from './schema-panel.module.css';
import { type ConnectorChange, failureOf, useConnectorChange } from './use-connector-change.ts';

/** From this many entities the panel offers a filter. */
const filterFrom = 12;

/** Props of {@link SchemaPanel}. */
interface SchemaPanelProps {
  /** The connector. */
  readonly connector: ConnectorDetail;
  /** Its cached schema. */
  readonly schema: SchemaView;
}

/**
 * Reads a schema that was never read, once, when the panel opens.
 *
 * @param schema - The cached schema.
 * @param change - The channel to read it through.
 */
function useFirstRead(schema: SchemaView, change: ConnectorChange): void {
  const { submit, outcome, pending } = change;
  const neverRead = schema.readAt === null && outcome === undefined && !pending;
  useEffect(() => {
    if (neverRead) submit({ intent: 'refresh-schema' });
  }, [neverRead, submit]);
}

/**
 * The descriptions with one entity's changed.
 *
 * @param descriptions - The admin's descriptions.
 * @param entity - The entity.
 * @param text - Its new description; empty removes it.
 * @returns The new descriptions.
 */
function describe(
  descriptions: Readonly<Record<string, string>>,
  entity: string,
  text: string,
): Record<string, string> {
  const { [entity]: _previous, ...others } = descriptions;
  return text === '' ? others : { ...others, [entity]: text };
}

/** Props of {@link PanelHead}. */
interface PanelHeadProps {
  /** The cached schema. */
  readonly schema: SchemaView;
  /** The channel that reads the schema again. */
  readonly refresh: ConnectorChange;
}

/**
 * The panel's title, its counts and read time, and the Re-read button.
 *
 * @param props - The schema and the refresh channel.
 * @returns The header.
 */
function PanelHead({ schema, refresh }: PanelHeadProps) {
  const meta =
    schema.readAt === null
      ? 'not read yet'
      : `${schemaSummary(schema)} · read ${readTime(schema.readAt)}`;
  return (
    <header className={styles.head}>
      <div className={styles.headText}>
        <h3 id="schema-title" className={styles.title}>
          Schema the model gets
        </h3>
        <span className={styles.meta}>{meta}</span>
      </div>
      <Button
        size="small"
        disabled={refresh.pending}
        onClick={() => refresh.submit({ intent: 'refresh-schema' })}
      >
        {refresh.pending ? 'Reading…' : 'Re-read'}
      </Button>
    </header>
  );
}

/**
 * The filter over the entities, shown when there are many.
 *
 * @param props - The filter text and its setter.
 * @param props.value - The filter text.
 * @param props.onChange - Called with the new text.
 * @returns The filter input.
 */
function EntityFilter({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className={styles.filter}>
      <Input
        label="Filter entities by name"
        hideLabel
        mono
        placeholder="Filter by name"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/**
 * The schema the model gets: each entity with its counts and description, and its fields with
 * what the model sees of them. Descriptions are edited in place.
 *
 * @param props - The connector and its schema.
 * @returns The panel.
 */
export function SchemaPanel({ connector, schema }: SchemaPanelProps) {
  const refresh = useConnectorChange(connector.id);
  const describeChange = useConnectorChange(connector.id);
  const [filter, setFilter] = useState('');
  useFirstRead(schema, refresh);
  const shown = schema.entities.filter((entity) => entity.name.includes(filter.trim()));
  const error = failureOf(refresh.outcome) ?? failureOf(describeChange.outcome);
  const onDescribe = (entity: string) => (text: string) =>
    describeChange.submit({
      intent: 'update',
      patch: { descriptions: describe(connector.descriptions, entity, text) },
    });
  return (
    <section className={styles.panel} aria-labelledby="schema-title">
      <PanelHead schema={schema} refresh={refresh} />
      {schema.entities.length >= filterFrom && <EntityFilter value={filter} onChange={setFilter} />}
      {error !== undefined && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <ul className={styles.entities}>
        {shown.map((entity) => (
          <SchemaEntityRow key={entity.name} entity={entity} onDescribe={onDescribe(entity.name)} />
        ))}
      </ul>
      <footer className={styles.foot}>
        Descriptions are sent with the schema. Good ones beat a bigger model.
      </footer>
    </section>
  );
}
