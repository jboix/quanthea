import { builtInRecipes, type RecipeSettings } from '@querent/shared';
import { type SubmitTarget, useFetcher, useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Page } from '../../ui/page.tsx';
import { BuiltInDetail } from './built-in-detail.tsx';
import type { RecipesData, RecipesIntent, RecipesOutcome } from './data.ts';
import { draftOf } from './recipe-draft.ts';
import { RecipeEditor } from './recipe-editor.tsx';
import { RecipeList } from './recipe-list.tsx';
import styles from './recipes.module.css';
import { type RecipesForm, useRecipesForm } from './recipes-form.ts';
import { SavedDetail } from './saved-detail.tsx';

/** Props of the detail parts. */
interface DetailProps {
  /** The form state. */
  readonly form: RecipesForm;
  /** The guides and the connectors. */
  readonly data: RecipesData;
}

/**
 * One of your recipes, by its place in the list.
 *
 * @param props - The form, the data and the place.
 * @param props.index - The recipe's place.
 * @returns The detail, or nothing when there is no such recipe.
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
 * A built-in recipe, by id.
 *
 * @param props - The form, the data and the id.
 * @param props.id - The recipe's id.
 * @returns The detail, or nothing when there is no such recipe.
 */
function BuiltInSelection({ form, data, id }: DetailProps & { readonly id: string }) {
  const recipe = builtInRecipes.find((each) => each.id === id);
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
 * What the right side shows: the editor, one of your recipes, or a built-in one.
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
    <RecipeEditor
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
function saveNote(form: RecipesForm): string {
  if (form.editing !== null) return 'Finish the recipe you are editing first.';
  return form.dirty ? 'Unsaved changes.' : 'Everything is saved.';
}

/**
 * The save bar: saves the switches and your recipes together.
 *
 * @param props - The form.
 * @param props.form - The form state.
 * @returns The bar.
 */
function SaveBar({ form }: { readonly form: RecipesForm }) {
  const fetcher = useFetcher<RecipesOutcome>();
  const refused =
    fetcher.data?.intent === 'save' && !fetcher.data.ok ? fetcher.data.message : undefined;
  const save = () => {
    const intent: RecipesIntent = { intent: 'save', settings: form.settings };
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
function RecipesBody({ data }: { readonly data: RecipesData }) {
  const form = useRecipesForm(data.settings);
  return (
    <>
      <SaveBar form={form} />
      <div className={styles.layout}>
        <RecipeList form={form} />
        <Detail form={form} data={data} />
      </div>
    </>
  );
}

/**
 * The recipes screen.
 *
 * @returns The screen.
 */
export function RecipesScreen() {
  const data = useLoaderData() as RecipesData;
  const saved: RecipeSettings = data.settings;
  return (
    <Page
      title="Recipes"
      subtitle="The agent names what a panel shows and the server writes and tests the query. Fewer tokens, fewer broken panels."
    >
      <RecipesBody key={JSON.stringify(saved)} data={data} />
    </Page>
  );
}
