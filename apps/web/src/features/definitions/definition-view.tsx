import { bodyLanguage, type DefinitionBody, type DefinitionVersion } from '@quanthea/shared';
import { Button } from '../../ui/button.tsx';
import { Pill } from '../../ui/pill.tsx';
import styles from './definitions.module.css';

/**
 * What a definition's list row says under its name.
 *
 * @param version - The definition's latest version.
 * @returns Such as `Checked · search · v3`, or `Meaning only · v1`.
 */
export function statusOf(version: DefinitionVersion): string {
  const languages = version.definition.bodies.map(bodyLanguage);
  const checked = languages.length === 0 ? 'Meaning only' : `Checked · ${languages.join(', ')}`;
  return `${checked} · v${version.version}`;
}

/**
 * A body field's value in words: a list of filters as `field op value`, else its JSON.
 *
 * @param value - The value.
 * @returns The words.
 */
export function wordsOfValue(value: unknown): string {
  if (typeof value === 'string') return value;
  const filters = Array.isArray(value) ? (value as unknown[]) : [];
  const words = filters.map(filterWords);
  if (filters.length === 0 || words.includes(undefined)) return JSON.stringify(value);
  return words.join(' and ');
}

/**
 * A filter in words, such as `event_name = "ERROR"`.
 *
 * @param filter - A value that may be a filter.
 * @returns The words, or `undefined` when it is no filter.
 */
function filterWords(filter: unknown): string | undefined {
  if (typeof filter !== 'object' || filter === null || !('field' in filter)) return undefined;
  const { field, op, value, values } = filter as Record<string, unknown>;
  return `${String(field)} ${typeof op === 'string' ? op : '='} ${JSON.stringify(value ?? values ?? '')}`;
}

/** What each field of a body is called on the screen. */
const fieldNames: Readonly<Record<string, string>> = {
  match: 'Part',
  of: 'Whole',
  filters: 'Filters',
  measure: 'Measure',
};

/**
 * One checked body: its language, shape, connectors and fields, each on a line.
 *
 * @param props - The body.
 * @param props.body - The body.
 * @returns The body's card.
 */
function BodyCard({ body }: { readonly body: DefinitionBody }) {
  const where = body.connectors ? body.connectors.join(', ') : 'every connector of its language';
  const { kind, ...fields } = body.request;
  return (
    <div className={styles.body}>
      <strong>
        {bodyLanguage(body)} · {body.shape} · {kind}
      </strong>
      <p className={styles.facts}>For {where}.</p>
      <dl className={styles.fields}>
        {Object.entries(fields).map(([key, value]) => (
          <div key={key} className={styles.field}>
            <dt>{fieldNames[key] ?? key.charAt(0).toUpperCase() + key.slice(1)}</dt>
            <dd className={styles.code}>{wordsOfValue(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Props of {@link DefinitionView}. */
interface DefinitionViewProps {
  /** The definition's latest version. */
  readonly version: DefinitionVersion;
  /** The file that declares it, when the configuration file manages it. */
  readonly managedBy: string | undefined;
  /** Opens the editor, for someone who may change it; nothing otherwise. */
  readonly onEdit?: (() => void) | undefined;
}

/**
 * A definition as everyone reads it: its meaning, synonyms, checked filters and where they apply.
 *
 * @param props - The version and the file that manages it, if any.
 * @returns The detail.
 */
export function DefinitionView({ version, managedBy, onEdit }: DefinitionViewProps) {
  const { definition } = version;
  return (
    <section className={styles.detail} aria-label={definition.name}>
      <div className={styles.head}>
        <h2 className={styles.title}>{definition.name}</h2>
        {managedBy && <Pill shape="tag">{managedBy}</Pill>}
        {onEdit && !managedBy && <Button onClick={onEdit}>Edit</Button>}
      </div>
      <p className={styles.meaning}>{definition.meaning}</p>
      <p className={styles.facts}>
        {definition.id}
        {definition.synonyms.length > 0 ? ` · also: ${definition.synonyms.join(', ')}` : ''} · v
        {version.version} by {version.author}
      </p>
      <h3 className={styles.sectionTitle}>Checked filters</h3>
      {definition.bodies.length === 0 ? (
        <p className={styles.empty}>None yet: the agent builds from the meaning.</p>
      ) : (
        definition.bodies.map((body) => <BodyCard key={bodyLanguage(body)} body={body} />)
      )}
    </section>
  );
}
