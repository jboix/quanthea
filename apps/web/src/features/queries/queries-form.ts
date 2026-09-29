/** The queries screen's state: the settings as edited, the query shown, and the editor. */
import type { QuerySettings, SavedQuery } from '@querent/shared';
import { useState } from 'react';
import { newDraft, type QueryDraft } from './query-draft.ts';

/** The query the screen shows: a built-in one by id, or one of yours by its place. */
export type Selection =
  | { readonly kind: 'built-in'; readonly id: string }
  | { readonly kind: 'saved'; readonly index: number };

/** The query being edited: a new one, or one of yours by its place. */
export type Editing = { readonly draft: QueryDraft; readonly index: number | null } | null;

/**
 * The settings with a query kept: added at the end, or put in its place.
 *
 * @param settings - The settings.
 * @param query - The query.
 * @param index - Its place, or `null` for a new one.
 * @returns The settings.
 */
function withRecipe(settings: QuerySettings, recipe: SavedQuery, index: number | null) {
  const saved = [...settings.saved];
  if (index === null) saved.push(recipe);
  else saved[index] = recipe;
  return { ...settings, saved };
}

/**
 * The form state of the queries screen.
 *
 * @param saved - The settings as saved.
 * @returns The settings, the selection, the editor, and the changes.
 */
export function useQueriesForm(saved: QuerySettings) {
  const [settings, setSettings] = useState(saved);
  const [selected, select] = useState<Selection>({ kind: 'built-in', id: 'rate' });
  const [editing, setEditing] = useState<Editing>(null);
  const toggle = (id: string, on: boolean) =>
    setSettings((current) => ({
      ...current,
      disabled: on ? current.disabled.filter((each) => each !== id) : [...current.disabled, id],
    }));
  const keep = (recipe: SavedQuery) => {
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
export type QueriesForm = ReturnType<typeof useQueriesForm>;
