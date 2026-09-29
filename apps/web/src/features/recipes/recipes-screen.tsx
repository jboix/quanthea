import { builtInRecipes, type RecipeSettings, type SavedRecipe } from '@querent/shared';
import { useState } from 'react';
import { type SubmitTarget, useFetcher, useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Page } from '../../ui/page.tsx';
import { Pill } from '../../ui/pill.tsx';
import { Switch } from '../../ui/switch.tsx';
import type { RecipesIntent, RecipesOutcome } from './data.ts';
import { draftOf, newDraft, type RecipeDraft } from './recipe-draft.ts';
import { RecipeEditor } from './recipe-editor.tsx';
import styles from './recipes.module.css';

/** The recipe being edited: a new one, or a saved one by its place in the list. */
type Editing = { readonly draft: RecipeDraft; readonly index: number | null } | null;

/**
 * The form state: the settings as edited, and the recipe open in the editor.
 *
 * @param saved - The saved settings.
 * @returns The settings, the editor's recipe, and the changes.
 */
function useRecipesForm(saved: RecipeSettings) {
  const [settings, setSettings] = useState(saved);
  const [editing, setEditing] = useState<Editing>(null);
  const toggle = (id: string, on: boolean) =>
    setSettings((current) => ({
      ...current,
      disabled: on ? current.disabled.filter((each) => each !== id) : [...current.disabled, id],
    }));
  const keep = (recipe: SavedRecipe) => {
    setSettings((current) => {
      const list = [...current.saved];
      if (editing?.index == null) list.push(recipe);
      else list[editing.index] = recipe;
      return { ...current, saved: list };
    });
    setEditing(null);
  };
  const remove = (index: number) =>
    setSettings((current) => ({
      ...current,
      saved: current.saved.filter((_, at) => at !== index),
    }));
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  return { settings, editing, setEditing, toggle, keep, remove, dirty };
}

/** The form. */
type Form = ReturnType<typeof useRecipesForm>;

/**
 * The built-in recipes, each with its switch.
 *
 * @param props - The form.
 * @param props.form - The form state.
 * @returns The card.
 */
function BuiltInCard({ form }: { readonly form: Form }) {
  return (
    <Card
      title="Built-in recipes"
      description="Switched-off recipes leave the default set. A thread can still choose them when it starts."
    >
      {builtInRecipes.map((recipe) => (
        <Switch
          key={recipe.id}
          label={`${recipe.name} · ${recipe.language === 'sql' ? 'SQL' : 'PromQL'}`}
          description={recipe.description}
          checked={!form.settings.disabled.includes(recipe.id)}
          onChange={(on) => form.toggle(recipe.id, on)}
        />
      ))}
    </Card>
  );
}

/**
 * The saved recipes, each with Edit and Remove.
 *
 * @param props - The form.
 * @param props.form - The form state.
 * @returns The card.
 */
function SavedCard({ form }: { readonly form: Form }) {
  const add = () => form.setEditing({ draft: newDraft, index: null });
  return (
    <Card
      title="Your recipes"
      description="Queries with typed placeholders. The agent fills the placeholders; the server checks and quotes each value."
      actions={
        <Button size="small" onClick={add} disabled={form.editing !== null}>
          Add a recipe
        </Button>
      }
    >
      {form.settings.saved.length === 0 && (
        <p className={styles.hint}>No recipes of your own yet.</p>
      )}
      {form.settings.saved.map((recipe, index) => (
        <div key={recipe.id} className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowName}>{recipe.name}</span>
            <span className={styles.hint}>{recipe.description}</span>
          </div>
          <Pill mono>{recipe.id}</Pill>
          <Pill>{recipe.language === 'sql' ? 'SQL' : 'PromQL'}</Pill>
          <Button
            size="small"
            onClick={() => form.setEditing({ draft: draftOf(recipe), index })}
            disabled={form.editing !== null}
          >
            Edit
          </Button>
          <Button size="small" variant="danger" onClick={() => form.remove(index)}>
            Remove
          </Button>
        </div>
      ))}
    </Card>
  );
}

/**
 * The form, reset whenever the saved settings change.
 *
 * @param props - The saved settings.
 * @param props.saved - The settings as saved.
 * @returns The cards, the editor and the save bar.
 */
function RecipesForm({ saved }: { readonly saved: RecipeSettings }) {
  const form = useRecipesForm(saved);
  const fetcher = useFetcher<RecipesOutcome>();
  const refused = fetcher.data?.ok === false ? fetcher.data.message : undefined;
  const save = () => {
    const intent: RecipesIntent = { settings: form.settings };
    void fetcher.submit(intent as unknown as SubmitTarget, {
      method: 'post',
      encType: 'application/json',
    });
  };
  const { editing } = form;
  const taken = form.settings.saved.map((recipe) => recipe.id);
  return (
    <div className={styles.layout}>
      <SavedCard form={form} />
      {editing !== null && (
        <RecipeEditor
          start={editing.draft}
          isNew={editing.index === null}
          taken={taken}
          onDone={form.keep}
          onCancel={() => form.setEditing(null)}
        />
      )}
      <BuiltInCard form={form} />
      <div className={styles.saveBar}>
        <Button
          variant="primary"
          onClick={save}
          disabled={!form.dirty || editing !== null || fetcher.state !== 'idle'}
        >
          {fetcher.state === 'idle' ? 'Save' : 'Saving…'}
        </Button>
        {refused !== undefined && <span className={styles.error}>{refused}</span>}
      </div>
    </div>
  );
}

/**
 * The recipes screen.
 *
 * @returns The screen.
 */
export function RecipesScreen() {
  const saved = useLoaderData() as RecipeSettings;
  return (
    <Page
      title="Recipes"
      subtitle="The agent names what a panel shows and the server writes and tests the query. Fewer tokens, fewer broken panels."
    >
      <RecipesForm key={JSON.stringify(saved)} saved={saved} />
    </Page>
  );
}
