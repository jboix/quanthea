import { type QuerySettings, queryBuilders } from '@quanthea/shared';
import { type SubmitTarget, useFetcher, useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Page } from '../../ui/page.tsx';
import { BuiltInDetail } from './built-in-detail.tsx';
import type { QueriesData, QueriesIntent, QueriesOutcome } from './data.ts';
import styles from './queries.module.css';
import { type QueriesForm, useQueriesForm } from './queries-form.ts';
import { draftOf } from './query-draft.ts';
import { QueryEditor } from './query-editor.tsx';
import { QueryList } from './query-list.tsx';
import { SavedDetail } from './saved-detail.tsx';

/** Props of the detail parts. */
interface DetailProps {
  /** The form state. */
  readonly form: QueriesForm;
  /** The guides and the connectors. */
  readonly data: QueriesData;
}

/**
 * One of your queries, by its place in the list.
 *
 * @param props - The form, the data and the place.
 * @param props.index - The query's place.
 * @returns The detail, or nothing when there is no such query.
 */
function SavedSelection({ form, data, index }: DetailProps & { readonly index: number }) {
  const recipe = form.settings.saved[index];
  if (!recipe) return null;
  return (
    <SavedDetail
      recipe={recipe}
      connectors={data.connectors}
      onEdit={() => form.setEditing({ draft: draftOf(recipe), index })}
      onRemove={() => form.remove(index)}
    />
  );
}

/**
 * A query builder, by id.
 *
 * @param props - The form, the data and the id.
 * @param props.id - The query's id.
 * @returns The detail, or nothing when there is no such query.
 */
function BuiltInSelection({ form, data, id }: DetailProps & { readonly id: string }) {
  const recipe = queryBuilders.find((each) => each.id === id);
  const guide = data.guides.find((each) => each.id === id);
  if (!recipe || !guide) return null;
  return (
    <BuiltInDetail
      recipe={recipe}
      guide={guide}
      enabled={!form.settings.disabled.includes(id)}
      onToggle={(on) => form.toggle(id, on)}
      connectors={data.connectors}
    />
  );
}

/**
 * What the right side shows: the editor, one of your queries, or a built-in one.
 *
 * @param props - The form and the screen's data.
 * @returns The detail.
 */
function Detail({ form, data }: DetailProps) {
  const { editing, selected } = form;
  if (editing === null) {
    return selected.kind === 'saved' ? (
      <SavedSelection form={form} data={data} index={selected.index} />
    ) : (
      <BuiltInSelection form={form} data={data} id={selected.id} />
    );
  }
  return (
    <QueryEditor
      key={editing.index ?? 'new'}
      start={editing.draft}
      isNew={editing.index === null}
      taken={form.settings.saved.map((recipe) => recipe.id)}
      onDone={form.keep}
      onCancel={() => form.setEditing(null)}
      connectors={data.connectors}
    />
  );
}

/**
 * What the save bar says.
 *
 * @param form - The form state.
 * @returns The line.
 */
function saveNote(form: QueriesForm): string {
  if (form.editing !== null) return 'Finish the query you are editing first.';
  return form.dirty ? 'Unsaved changes.' : 'Everything is saved.';
}

/**
 * The save bar: saves the switches and your queries together.
 *
 * @param props - The form.
 * @param props.form - The form state.
 * @returns The bar.
 */
function SaveBar({ form }: { readonly form: QueriesForm }) {
  const fetcher = useFetcher<QueriesOutcome>();
  const refused =
    fetcher.data?.intent === 'save' && !fetcher.data.ok ? fetcher.data.message : undefined;
  const save = () => {
    const intent: QueriesIntent = { intent: 'save', settings: form.settings };
    void fetcher.submit(intent as unknown as SubmitTarget, {
      method: 'post',
      encType: 'application/json',
    });
  };
  const note = saveNote(form);
  return (
    <div className={styles.saveBar}>
      <Button
        variant="primary"
        onClick={save}
        disabled={!form.dirty || form.editing !== null || fetcher.state !== 'idle'}
      >
        {fetcher.state === 'idle' ? 'Save' : 'Saving…'}
      </Button>
      <span className={refused ? styles.error : styles.hint}>{refused ?? note}</span>
    </div>
  );
}

/**
 * The form, reset whenever the saved settings change.
 *
 * @param props - The screen's data.
 * @param props.data - The settings, the guides and the connectors.
 * @returns The list, the detail and the save bar.
 */
function QueriesBody({ data }: { readonly data: QueriesData }) {
  const form = useQueriesForm(data.settings);
  return (
    <>
      <SaveBar form={form} />
      <div className={styles.layout}>
        <QueryList form={form} />
        <Detail form={form} data={data} />
      </div>
    </>
  );
}

/**
 * The queries screen.
 *
 * @returns The screen.
 */
export function QueriesScreen() {
  const data = useLoaderData() as QueriesData;
  const saved: QuerySettings = data.settings;
  return (
    <Page
      title="Queries"
      subtitle="Query builders and saved queries: the agent names what data it wants and the server writes and tests the query. Fewer tokens, fewer broken panels."
    >
      <QueriesBody key={JSON.stringify(saved)} data={data} />
    </Page>
  );
}
