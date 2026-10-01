import type { ChartRecipe } from '@quanthea/shared';
import { useState } from 'react';
import { Pill } from '../../ui/pill.tsx';
import { Switch } from '../../ui/switch.tsx';
import { PanelView } from '../dashboard/index.ts';
import styles from './gallery.module.css';
import { samplePanel } from './sample.ts';

/**
 * The recipe's sample, drawn with some variants.
 *
 * @param props - The recipe and its variants.
 * @param props.recipe - The recipe.
 * @param props.variants - The variants.
 * @returns The chart, or why it cannot draw.
 */
function SampleChart({
  recipe,
  variants,
}: {
  readonly recipe: ChartRecipe;
  readonly variants: readonly string[];
}) {
  const sample = samplePanel(recipe, variants);
  if (typeof sample === 'string') return <p className={styles.error}>{sample}</p>;
  return (
    <div className={styles.chart}>
      <PanelView panel={sample.panel} queries={sample.queries} markers={[]} timeZone="UTC" />
    </div>
  );
}

/**
 * The variants to switch between: the recipe as it is, then each variant.
 *
 * @param props - The recipe, the variant shown and the change callback.
 * @param props.recipe - The recipe.
 * @param props.value - The variant shown, or an empty string for none.
 * @param props.onChange - Called with another variant.
 * @returns The chips, or nothing when the recipe has no variants.
 */
function VariantChips({
  recipe,
  value,
  onChange,
}: {
  readonly recipe: ChartRecipe;
  readonly value: string;
  readonly onChange: (name: string) => void;
}) {
  const names = Object.keys(recipe.variants);
  if (names.length === 0) return null;
  const options = [
    ['', 'Plain'],
    ...names.map((name) => [name, recipe.variants[name]?.title ?? name]),
  ];
  return (
    <fieldset className={styles.chips}>
      <legend className={styles.hidden}>{recipe.title} variants</legend>
      {options.map(([name = '', title]) => (
        <button
          key={name}
          type="button"
          aria-pressed={value === name}
          className={styles.chip}
          onClick={() => onChange(name)}
        >
          {title}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * What the agent reads about a recipe: its roles, its pitfalls and how such data is usually made.
 *
 * @param props - The recipe.
 * @param props.recipe - The recipe.
 * @returns The details.
 */
function RecipeDetails({ recipe }: { readonly recipe: ChartRecipe }) {
  return (
    <details className={styles.details}>
      <summary>How it works</summary>
      <table className={styles.roles}>
        <tbody>
          {Object.entries(recipe.data.roles).map(([name, role]) => (
            <tr key={name}>
              <td className={styles.roleName}>
                {name}
                {role.required ? '' : '?'}
                {role.multiple ? '[]' : ''}
              </td>
              <td className={styles.roleType}>{role.types.join(' | ')}</td>
              <td>{role.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className={styles.notes}>
        {recipe.whenNotToUse.map((line) => (
          <li key={line}>Not for: {line}</li>
        ))}
        {recipe.pitfalls.map((line) => (
          <li key={line}>Pitfall: {line}</li>
        ))}
        {(recipe.queryHints ?? []).map((line) => (
          <li key={line}>Data: {line}</li>
        ))}
      </ul>
    </details>
  );
}

/** Props of {@link RecipeCard}. */
interface RecipeCardProps {
  /** The recipe. */
  readonly recipe: ChartRecipe;
  /** A variant to show fixed, as the every-variant view does; otherwise the card switches. */
  readonly variant?: string;
  /** Whether the agent is offered the recipe. */
  readonly enabled: boolean;
  /** Switches it on or off for the agent. */
  readonly onToggle: (on: boolean) => void;
}

/**
 * One recipe: its name, its sample drawn, its variants and what the agent reads about it.
 *
 * @param props - The recipe, a fixed variant if any, and its switch for the agent.
 * @returns The card.
 */
export function RecipeCard({ recipe, variant, enabled, onToggle }: RecipeCardProps) {
  const [chosen, choose] = useState('');
  const shown = variant ?? chosen;
  const title = shown
    ? `${recipe.title} · ${recipe.variants[shown]?.title ?? shown}`
    : recipe.title;
  return (
    <article className={styles.card} aria-label={title} data-off={!enabled}>
      <header className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{title}</h3>
        <Pill mono>{recipe.id}</Pill>
        <Pill>{recipe.data.shape}</Pill>
      </header>
      <SampleChart recipe={recipe} variants={shown ? [shown] : []} />
      {variant === undefined && <VariantChips recipe={recipe} value={chosen} onChange={choose} />}
      <p className={styles.use}>
        {shown ? recipe.variants[shown]?.whenToUse : recipe.whenToUse.join(' ')}
      </p>
      <RecipeDetails recipe={recipe} />
      {variant === undefined && (
        <Switch label="Offered to the agent" checked={enabled} onChange={onToggle} />
      )}
    </article>
  );
}
