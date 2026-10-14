import type { DefinitionVersion } from '@quanthea/shared';
import { useState } from 'react';
import { useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Page } from '../../ui/page.tsx';
import { useCanEdit } from '../dashboard/index.ts';
import type { DefinitionsData } from './data.ts';
import { DefinitionEditor } from './definition-editor.tsx';
import { DefinitionView, statusOf } from './definition-view.tsx';
import styles from './definitions.module.css';

/** What the right side shows: a definition, the editor of one, or a new one. */
type Selection =
  | { readonly kind: 'view'; readonly id: string }
  | { readonly kind: 'edit'; readonly id: string }
  | { readonly kind: 'new' };

/** Props of {@link DefinitionList}. */
interface DefinitionListProps {
  /** The definitions. */
  readonly definitions: readonly DefinitionVersion[];
  /** The id shown, if any. */
  readonly current: string | undefined;
  /** Shows a definition. */
  readonly onPick: (id: string) => void;
  /** Starts a new definition, for editors; none for others. */
  readonly onNew: (() => void) | undefined;
}

/**
 * The list of definitions, each with where it is checked.
 *
 * @param props - The definitions, the one shown, and the callbacks.
 * @returns The list.
 */
function DefinitionList({ definitions, current, onPick, onNew }: DefinitionListProps) {
  return (
    <nav className={styles.side} aria-label="Definitions">
      {onNew && (
        <Button variant="primary" onClick={onNew}>
          New definition
        </Button>
      )}
      <ul className={styles.list}>
        {definitions.map((version) => (
          <li key={version.definition.id}>
            <button
              type="button"
              className={styles.row}
              aria-current={version.definition.id === current}
              onClick={() => onPick(version.definition.id)}
            >
              <span className={styles.rowName}>{version.definition.name}</span>
              <span className={styles.rowNote}>{statusOf(version)}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The right side: the editor for an editor who edits, else the definition as everyone reads it.
 *
 * @param props - The data, the selection, and what the person may do.
 * @param props.data - The definitions and the managed ones.
 * @param props.selection - What is shown.
 * @param props.canEdit - Whether the person may change definitions.
 * @param props.onSelect - Changes what is shown.
 * @returns The detail.
 */
function Detail({
  data,
  selection,
  canEdit,
  onSelect,
}: {
  readonly data: DefinitionsData;
  readonly selection: Selection | undefined;
  readonly canEdit: boolean;
  readonly onSelect: (selection: Selection | undefined) => void;
}) {
  const done = (id: string | undefined) => onSelect(id ? { kind: 'view', id } : undefined);
  if (selection?.kind === 'new') return <DefinitionEditor version={undefined} onDone={done} />;
  const version = data.definitions.find((each) => each.definition.id === selection?.id);
  if (!version || !selection) return <p className={styles.empty}>Pick a definition.</p>;
  const managedBy = data.managed[version.definition.id];
  if (selection.kind === 'edit')
    return <DefinitionEditor key={version.version} version={version} onDone={done} />;
  const onEdit = canEdit ? () => onSelect({ kind: 'edit', id: version.definition.id }) : undefined;
  return <DefinitionView version={version} managedBy={managedBy} onEdit={onEdit} />;
}

/**
 * The definitions screen: what the team means by its business terms. Everyone reads it; editors
 * and admins change the definitions the configuration file does not manage.
 *
 * @returns The screen.
 */
export function DefinitionsScreen() {
  const data = useLoaderData() as DefinitionsData;
  const canEdit = useCanEdit();
  const first = data.definitions[0]?.definition.id;
  const [selection, setSelection] = useState<Selection | undefined>(
    first ? { kind: 'view', id: first } : undefined,
  );
  const current = selection && selection.kind !== 'new' ? selection.id : undefined;
  return (
    <Page
      title="Definitions"
      subtitle="What the team means by its business terms. The agent follows the meaning, and copies checked filters into new panels; panels already built keep what they copied."
    >
      <div className={styles.layout}>
        <DefinitionList
          definitions={data.definitions}
          current={current}
          onPick={(id) => setSelection({ kind: 'view', id })}
          onNew={canEdit ? () => setSelection({ kind: 'new' }) : undefined}
        />
        <Detail data={data} selection={selection} canEdit={canEdit} onSelect={setSelection} />
      </div>
    </Page>
  );
}
