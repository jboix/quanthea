/** The recipes screen's state: the settings as edited, the recipe shown, and the editor. */
import type { RecipeSettings, SavedRecipe } from '@querent/shared';
import { useState } from 'react';
import { newDraft, type RecipeDraft } from './recipe-draft.ts';

/** The recipe the screen shows: a built-in one by id, or one of yours by its place. */
export type Selection =
  | { readonly kind: 'built-in'; readonly id: string }
  | { readonly kind: 'saved'; readonly index: number };

/** The recipe being edited: a new one, or one of yours by its place. */
export type Editing = { readonly draft: RecipeDraft; readonly index: number | null } | null;

/**
 * The settings with a recipe kept: added at the end, or put in its place.
 *
 * @param settings - The settings.
 * @param recipe - The recipe.
 * @param index - Its place, or `null` for a new one.
 * @returns The settings.
 */
function withRecipe(settings: RecipeSettings, recipe: SavedRecipe, index: number | null) {
  const saved = [...settings.saved];
  if (index === null) saved.push(recipe);
  else saved[index] = recipe;
  return { ...settings, saved };
}

/**
 * The form state of the recipes screen.
 *
 * @param saved - The settings as saved.
 * @returns The settings, the selection, the editor, and the changes.
 */
export function useRecipesForm(saved: RecipeSettings) {
  const [settings, setSettings] = useState(saved);
  const [selected, select] = useState<Selection>({ kind: 'built-in', id: 'rate' });
  const [editing, setEditing] = useState<Editing>(null);
  const toggle = (id: string, on: boolean) =>
    setSettings((current) => ({
      ...current,
      disabled: on ? current.disabled.filter((each) => each !== id) : [...current.disabled, id],
    }));
  const keep = (recipe: SavedRecipe) => {
    const index = editing?.index ?? settings.saved.length;
    setSettings((current) => withRecipe(current, recipe, editing?.index ?? null));
    setEditing(null);
    select({ kind: 'saved', index });
  };
  const remove = (index: number) => {
    setSettings((current) => ({
      ...current,
      saved: current.saved.filter((_, at) => at !== index),
    }));
    select({ kind: 'built-in', id: 'rate' });
  };
  const add = () => setEditing({ draft: newDraft, index: null });
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  return { settings, selected, select, editing, setEditing, toggle, keep, remove, add, dirty };
}

/** The form state. */
export type RecipesForm = ReturnType<typeof useRecipesForm>;
