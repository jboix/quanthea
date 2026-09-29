import type { RecipeChoice, ThreadRecipes } from '@querent/shared';
import { useState } from 'react';
import styles from './recipe-choice.module.css';

/** The modes a new thread may start in, as the menu names them. */
const modes = [
  { value: 'default', label: 'Default recipes' },
  { value: 'chosen', label: 'Choose recipes…' },
  { value: 'free', label: 'Free style' },
] as const;

/**
 * The recipe choice of a new thread: the mode, and the recipes ticked when choosing.
 *
 * @param recipes - Every recipe; the default set starts ticked.
 * @returns The choice as the API takes it, the mode, the ticked ids, and their setters.
 */
export function useRecipeChoice(recipes: readonly RecipeChoice[]) {
  const [mode, setMode] = useState<ThreadRecipes['mode']>('default');
  const [ticked, setTicked] = useState(
    () => new Set(recipes.filter((recipe) => recipe.enabled).map((recipe) => recipe.id)),
  );
  const toggle = (id: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const value: ThreadRecipes = mode === 'chosen' ? { mode, ids: [...ticked] } : { mode };
  return { mode, setMode, ticked, toggle, value };
}

/** A recipe choice. */
type Choice = ReturnType<typeof useRecipeChoice>;

/**
 * The menu of recipe modes.
 *
 * @param props - The choice.
 * @param props.choice - What {@link useRecipeChoice} returns.
 * @returns The menu.
 */
export function RecipeModeMenu({ choice }: { readonly choice: Choice }) {
  return (
    <select
      className={styles.mode}
      aria-label="Recipes"
      title="Recipes turn what a panel shows into tested queries, for fewer tokens and fewer broken panels."
      value={choice.mode}
      onChange={(event) => choice.setMode(event.target.value as ThreadRecipes['mode'])}
    >
      {modes.map((mode) => (
        <option key={mode.value} value={mode.value}>
          {mode.label}
        </option>
      ))}
    </select>
  );
}

/**
 * The recipes to tick, when choosing. Free style says what it means instead.
 *
 * @param props - The recipes and the choice.
 * @param props.recipes - Every recipe.
 * @param props.choice - What {@link useRecipeChoice} returns.
 * @returns The list, the note, or nothing for the default set.
 */
export function RecipePicker({
  recipes,
  choice,
}: {
  readonly recipes: readonly RecipeChoice[];
  readonly choice: Choice;
}) {
  if (choice.mode === 'free')
    return (
      <p className={styles.note}>
        No recipes: the agent writes every query itself. More tokens, more to repair.
      </p>
    );
  if (choice.mode === 'default') return null;
  return (
    <fieldset className={styles.picker}>
      <legend className={styles.legend}>Recipes this thread may use</legend>
      {recipes.map((recipe) => (
        <label key={recipe.id} className={styles.recipe} title={recipe.description}>
          <input
            type="checkbox"
            checked={choice.ticked.has(recipe.id)}
            onChange={() => choice.toggle(recipe.id)}
          />
          <span>{recipe.name}</span>
          <span className={styles.language}>
            {recipe.origin === 'saved' ? `saved · ${recipe.language}` : recipe.language}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
