import {
  type ConnectorDetail,
  maxObjectNames,
  type ObjectVisibility,
  type SchemaView,
} from '@quanthea/shared';
import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Pill } from '../../ui/pill.tsx';
import { Segmented } from '../../ui/segmented.tsx';
import { SuggestInput } from '../../ui/suggest-input.tsx';
import { Switch } from '../../ui/switch.tsx';
import { ChangeWarning } from './access-warning.tsx';
import styles from './connector.module.css';
import { ObjectChecklist } from './object-checklist.tsx';
import local from './objects.module.css';
import {
  hasSystemObjects,
  looseEntries,
  matchCount,
  objectsNoun,
  type SchemaObject,
  sameVisibility,
  withName,
  withoutName,
} from './shown-objects.ts';
import { failureOf } from './use-connector-change.ts';
import { useVisibilityGuard } from './use-visibility-guard.ts';

/** The two ways a list reads, as the form names them. */
const modes = [
  { value: 'except', label: 'All but these' },
  { value: 'only', label: 'Only these' },
] as const;

/** What the form says of a list longer than the server takes. */
const tooManyNames = `A list holds at most ${maxObjectNames} names. Use a pattern such as logs-* for the rest.`;

/** What the form edits: the visibility, and the list set aside for the other way of reading it. */
interface Draft {
  /** The visibility being edited. */
  readonly visibility: ObjectVisibility;
  /** The names of the other mode, kept so switching back loses nothing. */
  readonly otherNames: readonly string[];
}

/**
 * A draft read the other way: each mode keeps its own list, since hidden names and the only names
 * shown are not the same names.
 *
 * @param draft - The draft.
 * @param mode - The mode chosen.
 * @returns The draft in that mode.
 */
function inMode(draft: Draft, mode: ObjectVisibility['mode']): Draft {
  if (mode === draft.visibility.mode) return draft;
  return {
    visibility: { ...draft.visibility, mode, names: [...draft.otherNames] },
    otherNames: draft.visibility.names,
  };
}

/**
 * What a mode does, in a sentence.
 *
 * @param visibility - The visibility being edited.
 * @param noun - What the schema's objects are called.
 * @returns The sentence.
 */
function modeNote(visibility: ObjectVisibility, noun: string): string {
  if (visibility.mode === 'except')
    return `Everything is shown but the ${noun} you clear or list. One that appears later is shown.`;
  if (visibility.names.length === 0)
    return `Nothing is ticked or listed, so the connector shows nothing. Tick the ${noun} to show.`;
  return `Only the ${noun} you tick or list are shown. One that appears later stays hidden.`;
}

/** Props of the parts that edit the visibility. */
interface EditorProps {
  /** The objects the schema found. */
  readonly objects: readonly SchemaObject[];
  /** The visibility being edited. */
  readonly visibility: ObjectVisibility;
  /** Replaces the visibility. */
  readonly onChange: (visibility: ObjectVisibility) => void;
}

/**
 * How many objects a typed name or pattern covers, said while typing.
 *
 * @param text - The text typed.
 * @param objects - The objects the schema found.
 * @returns Such as `Covers 4 of 40 indices.`, or `undefined` while there is nothing to count.
 */
function coverNote(text: string, objects: readonly SchemaObject[]): string | undefined {
  const typed = text.trim();
  const count = matchCount(typed, objects);
  if (typed === '' || count === 0) return undefined;
  return `Covers ${count.toLocaleString('en')} of ${objects.length.toLocaleString('en')} ${objectsNoun(objects)}.`;
}

/**
 * The field that adds a name or a pattern to the list, suggesting the schema's names while typing
 * and counting what a pattern covers.
 *
 * @param props - The objects, the visibility and the change callback.
 * @returns The field with its Add button.
 */
function AddEntry({ objects, visibility, onChange }: EditorProps) {
  const [text, setText] = useState('');
  const add = (name: string) => {
    onChange({ ...visibility, names: [...withName(visibility.names, name)] });
    setText('');
  };
  const note = coverNote(text, objects);
  return (
    <div className={local.addEntry}>
      <div className={styles.addField}>
        <SuggestInput
          label="Name or pattern"
          hideLabel
          mono
          placeholder="logs-*"
          suggestions={objects.map((object) => object.name)}
          isKnown={(name) => objects.length === 0 || matchCount(name, objects) > 0}
          unknownNote="Covers nothing in the schema. It is kept all the same, for what comes later."
          value={text}
          onChange={setText}
          onCommit={add}
        />
        <Button size="small" disabled={text.trim() === ''} onClick={() => add(text)}>
          Add
        </Button>
      </div>
      {note !== undefined && <p className={styles.cardNote}>{note}</p>}
    </div>
  );
}

/** Props of {@link EntryChip}. */
interface EntryChipProps {
  /** The name or pattern. */
  readonly entry: string;
  /** The objects the schema found. */
  readonly objects: readonly SchemaObject[];
  /** Called to take it off the list. */
  readonly onRemove: () => void;
}

/**
 * One entry of the list as a removable chip, with how many objects it covers. An entry that
 * covers nothing in a schema that holds something is amber and says so.
 *
 * @param props - The entry, the objects and the remove callback.
 * @returns The chip.
 */
function EntryChip({ entry, objects, onRemove }: EntryChipProps) {
  const count = matchCount(entry, objects);
  const missing = count === 0 && objects.length > 0;
  return (
    <Pill
      tone={missing ? 'draft' : 'neutral'}
      shape="tag"
      mono
      removeLabel={`Remove ${entry}`}
      onRemove={onRemove}
    >
      {entry}
      <span className={styles.chipNote}>
        {missing ? 'not in the schema' : `covers ${count.toLocaleString('en')}`}
      </span>
    </Pill>
  );
}

/**
 * The patterns of the list, and its names the schema lacks, as removable chips with what each
 * covers. The names the schema has are the ticks of the checklist.
 *
 * @param props - The objects, the visibility and the change callback.
 * @returns The chips and the field that adds one.
 */
function Entries({ objects, visibility, onChange }: EditorProps) {
  const entries = looseEntries(visibility.names, objects);
  const remove = (entry: string) =>
    onChange({ ...visibility, names: [...withoutName(visibility.names, entry)] });
  return (
    <div className={local.entries}>
      <h5 className={local.entriesTitle}>
        {visibility.mode === 'only'
          ? 'Also shown, by pattern or name'
          : 'Hidden by pattern or name'}
      </h5>
      {entries.length > 0 && (
        <div className={styles.chips}>
          {entries.map((entry) => (
            <EntryChip key={entry} entry={entry} objects={objects} onRemove={() => remove(entry)} />
          ))}
        </div>
      )}
      <AddEntry objects={objects} visibility={visibility} onChange={onChange} />
    </div>
  );
}

/** Props of {@link SaveBar}. */
interface SaveBarProps {
  /** The connector. */
  readonly connector: ConnectorDetail;
  /** The visibility being edited. */
  readonly visibility: ObjectVisibility;
  /** Puts the stored visibility back. */
  readonly onReset: () => void;
}

/**
 * The Save button, with the warning that comes before it hides an object threads or pinned
 * dashboards read.
 *
 * @param props - The connector, the visibility and the reset callback.
 * @returns The warning, any error, and the buttons.
 */
function SaveBar({ connector, visibility, onReset }: SaveBarProps) {
  const guard = useVisibilityGuard(connector);
  const unchanged = sameVisibility(visibility, connector.visibility);
  const tooMany = visibility.names.length > maxObjectNames;
  const busy = guard.change.pending || guard.waiting || tooMany;
  const error = tooMany ? tooManyNames : failureOf(guard.change.outcome);
  return (
    <>
      {guard.waiting && (
        <ChangeWarning
          counting={guard.warning === undefined}
          countingText="Counting the threads and pinned dashboards this change affects…"
          text={guard.warning ?? ''}
          onConfirm={guard.confirm}
          onCancel={guard.cancel}
        />
      )}
      {error !== undefined && <p className={styles.failure}>{error}</p>}
      <div className={local.actions}>
        <Button
          variant="primary"
          disabled={unchanged || busy}
          onClick={() => guard.propose(visibility)}
        >
          {guard.change.pending ? 'Saving…' : 'Save what it shows'}
        </Button>
        <Button disabled={unchanged} onClick={onReset}>
          Reset
        </Button>
      </div>
    </>
  );
}

/** Props of {@link ObjectsSection}. */
interface ObjectsSectionProps {
  /** The connector. */
  readonly connector: ConnectorDetail;
  /** Its cached schema, with the objects it found. */
  readonly schema: SchemaView;
  /** The query language of its kind, such as `sql`. */
  readonly language: string | undefined;
}

/**
 * The card that edits the list: how it reads, the checklist, the patterns and the Save button.
 *
 * @param props - The connector, its schema and its query language.
 * @returns The card.
 */
function ObjectsCard({ connector, schema, language }: ObjectsSectionProps) {
  const stored = connector.visibility;
  const [draft, setDraft] = useState<Draft>({ visibility: stored, otherNames: [] });
  const { visibility } = draft;
  const objects = schema.entities;
  const onChange = (next: ObjectVisibility) => setDraft({ ...draft, visibility: next });
  return (
    <div className={styles.card}>
      {hasSystemObjects(language) && (
        <Switch
          label="Show system objects"
          description="The source's own: catalogs, internal indices, system collections."
          checked={visibility.showSystem}
          onChange={(showSystem) => onChange({ ...visibility, showSystem })}
        />
      )}
      <Segmented
        label="How the list reads"
        options={modes}
        value={visibility.mode}
        onChange={(mode) => setDraft(inMode(draft, mode))}
      />
      <p className={styles.cardNote}>{modeNote(visibility, objectsNoun(objects))}</p>
      <ObjectChecklist objects={objects} visibility={visibility} onChange={onChange} />
      <Entries objects={objects} visibility={visibility} onChange={onChange} />
      <SaveBar
        connector={connector}
        visibility={visibility}
        onReset={() => setDraft({ visibility: stored, otherNames: [] })}
      />
    </div>
  );
}

/**
 * What the connector shows of its source: the indices, tables, collections, metrics or endpoints
 * the agent lists and queries may read.
 *
 * @param props - The connector, its schema and its query language.
 * @returns The section.
 */
export function ObjectsSection(props: ObjectsSectionProps) {
  return (
    <section className={styles.section} aria-labelledby="objects-title">
      <div className={styles.sectionHead}>
        <h3 id="objects-title" className={styles.sectionTitle}>
          What the connector shows
        </h3>
        <p className={styles.sectionSubtitle}>
          The agent lists only these, and a query on anything else is refused, whoever runs it.
        </p>
      </div>
      <ObjectsCard {...props} />
    </section>
  );
}
