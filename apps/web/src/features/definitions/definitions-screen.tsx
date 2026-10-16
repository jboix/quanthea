import { useState } from 'react';
import { Outlet, useLoaderData, useMatch } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { ThreadsIcon } from '../../ui/icons.tsx';
import { useCanEdit } from '../dashboard/index.ts';
import type { DefinitionsData } from './data.ts';
import { DefinitionEditor } from './definition-editor.tsx';
import { DefinitionList } from './definition-list.tsx';
import { DefinitionView } from './definition-view.tsx';
import styles from './definitions.module.css';
import { NoDefinitions } from './no-definitions.tsx';

/** What the main column shows: a definition, the editor of one, or a new one. */
type Selection =
  | { readonly kind: 'view'; readonly id: string }
  | { readonly kind: 'edit'; readonly id: string }
  | { readonly kind: 'new' };

/** What the assistant's column may do on the screen: close itself where it covers the rest. */
export interface AssistantOutletContext {
  /** Closes the assistant on a screen too narrow for both columns. */
  readonly onClose: () => void;
}

/**
 * The detail: the editor for an editor who edits, else the definition as everyone reads it.
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
  const version =
    data.definitions.find((each) => each.definition.id === selection?.id) ?? data.definitions[0];
  if (!version) return null;
  const managedBy = data.managed[version.definition.id];
  if (selection?.kind === 'edit')
    return <DefinitionEditor key={version.version} version={version} onDone={done} />;
  const onEdit = canEdit ? () => onSelect({ kind: 'edit', id: version.definition.id }) : undefined;
  return <DefinitionView version={version} managedBy={managedBy} onEdit={onEdit} />;
}

/**
 * The list of definitions beside the one shown.
 *
 * @param props - The data, the selection, and what the person may do.
 * @param props.data - The definitions and the managed ones.
 * @param props.selection - What is shown.
 * @param props.canEdit - Whether the person may change definitions.
 * @param props.onSelect - Changes what is shown.
 * @returns The list and the detail.
 */
function Definitions(props: {
  readonly data: DefinitionsData;
  readonly selection: Selection | undefined;
  readonly canEdit: boolean;
  readonly onSelect: (selection: Selection | undefined) => void;
}) {
  const { data, selection, onSelect } = props;
  const current =
    selection && selection.kind !== 'new' ? selection.id : data.definitions[0]?.definition.id;
  return (
    <div className={styles.layout}>
      <DefinitionList
        definitions={data.definitions}
        current={current}
        onPick={(id) => onSelect({ kind: 'view', id })}
      />
      <Detail {...props} />
    </div>
  );
}

/**
 * The screen's head: the title, what definitions are for, and the editor's actions.
 *
 * @param props - What the person may do, and the callbacks.
 * @param props.canEdit - Whether the person may write definitions.
 * @param props.onNew - Starts a new definition by hand.
 * @param props.onAssistant - Opens the assistant where it does not fit beside.
 * @returns The head.
 */
function ScreenHead(props: {
  readonly canEdit: boolean;
  readonly onNew: () => void;
  readonly onAssistant: () => void;
}) {
  return (
    <header className={styles.screenHead}>
      <div>
        <h1>Definitions</h1>
        <p>What the team means by its business terms. Every new dashboard follows them.</p>
      </div>
      {props.canEdit && (
        <div className={styles.headActions}>
          <Button className={styles.openAssistant} onClick={props.onAssistant}>
            <ThreadsIcon />
            Assistant
          </Button>
          <Button onClick={props.onNew}>Write one by hand</Button>
        </div>
      )}
    </header>
  );
}

/**
 * The definitions screen: what the team means by its business terms, beside an assistant that
 * proposes definitions. Everyone reads them; editors and admins write them, by hand or with the
 * assistant, except those the configuration file manages.
 *
 * @returns The screen.
 */
export function DefinitionsScreen() {
  const data = useLoaderData() as DefinitionsData;
  const canEdit = useCanEdit();
  const [selection, setSelection] = useState<Selection | undefined>(undefined);
  const inChat = useMatch('/definitions/chat/:threadId') !== null;
  const [assistant, setAssistant] = useState(inChat);
  const empty = data.definitions.length === 0 && selection?.kind !== 'new';
  const context: AssistantOutletContext = { onClose: () => setAssistant(false) };
  return (
    <div className={styles.screen} data-assistant={canEdit ? String(assistant) : 'none'}>
      <div className={styles.main}>
        <ScreenHead
          canEdit={canEdit}
          onNew={() => setSelection({ kind: 'new' })}
          onAssistant={() => setAssistant(true)}
        />
        {empty ? (
          <NoDefinitions canEdit={canEdit} />
        ) : (
          <Definitions
            data={data}
            selection={selection}
            canEdit={canEdit}
            onSelect={setSelection}
          />
        )}
      </div>
      {canEdit && (
        <aside className={styles.assistant} aria-label="Definitions assistant">
          <Outlet context={context} />
        </aside>
      )}
    </div>
  );
}
