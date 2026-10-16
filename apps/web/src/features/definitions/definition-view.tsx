import { bodyLanguage, type DefinitionBody, type DefinitionVersion } from '@quanthea/shared';
import { Link } from 'react-router';
import { Button, buttonClassName } from '../../ui/button.tsx';
import { Pill } from '../../ui/pill.tsx';
import { bodyPlace, bodyWords } from './body-words.ts';
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

/** The words of each shape. */
const shapeWords: Readonly<Record<DefinitionBody['shape'], string>> = {
  measure: 'Measure',
  ratio: 'Ratio',
  segment: 'Segment',
};

/**
 * One checked body: where it applies, what it counts in words, and its request for those who
 * read builder requests.
 *
 * @param props - The body.
 * @param props.body - The body.
 * @returns The body's card.
 */
function BodyCard({ body }: { readonly body: DefinitionBody }) {
  return (
    <div className={styles.body}>
      <div className={styles.bodyHead}>
        <span className={styles.place}>{bodyPlace(body)}</span>
        <Pill mono>{shapeWords[body.shape]}</Pill>
      </div>
      <p className={styles.bodyWords}>{bodyWords(body)}</p>
      <details className={styles.request}>
        <summary>As a query builder request</summary>
        <pre className={styles.code}>{JSON.stringify(body.request, null, 2)}</pre>
      </details>
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
 * The actions on a definition: edit it by hand, or ask the assistant to change it.
 *
 * @param props - The definition and the edit callback.
 * @param props.name - The definition's name.
 * @param props.onEdit - Opens the editor.
 * @returns The actions.
 */
function ViewActions({ name, onEdit }: { readonly name: string; readonly onEdit: () => void }) {
  const ask = `/definitions?prompt=${encodeURIComponent(`Change the definition of ${name}: `)}`;
  return (
    <div className={styles.viewActions}>
      <Link className={buttonClassName()} to={ask}>
        Ask the assistant
      </Link>
      <Button onClick={onEdit}>Edit by hand</Button>
    </div>
  );
}

/**
 * A definition as everyone reads it: its meaning, the other words for it, and where it is checked,
 * in plain words.
 *
 * @param props - The version, the file that manages it, and the edit callback.
 * @returns The detail.
 */
export function DefinitionView({ version, managedBy, onEdit }: DefinitionViewProps) {
  const { definition } = version;
  const date = new Date(version.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' });
  return (
    <section className={styles.detail} aria-label={definition.name}>
      <header className={styles.head}>
        <h2 className={styles.title}>{definition.name}</h2>
        <Pill mono>v{version.version}</Pill>
        {managedBy && <Pill shape="tag">{managedBy}</Pill>}
        {onEdit && !managedBy && <ViewActions name={definition.name} onEdit={onEdit} />}
      </header>
      <blockquote className={styles.meaning}>{definition.meaning}</blockquote>
      {definition.synonyms.length > 0 && (
        <p className={styles.synonyms}>
          Also called
          {definition.synonyms.map((synonym) => (
            <span key={synonym} className={styles.synonym}>
              {synonym}
            </span>
          ))}
        </p>
      )}
      <h3 className={styles.sectionTitle}>Checked filters</h3>
      {definition.bodies.length === 0 ? (
        <p className={styles.empty}>
          None yet. The agent builds from the meaning, in its own words; checked filters make it
          exact.
        </p>
      ) : (
        definition.bodies.map((body) => <BodyCard key={bodyLanguage(body)} body={body} />)
      )}
      <p className={styles.facts}>
        {definition.id} · v{version.version}, {date}
        {version.origin === 'file' ? ' · from the configuration file' : ''}
      </p>
    </section>
  );
}
