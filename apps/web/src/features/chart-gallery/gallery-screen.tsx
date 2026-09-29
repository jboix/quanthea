import { type ChartFamily, type ChartRecipe, chartFamilies, chartRecipes } from '@querent/shared';
import { useState } from 'react';
import { Page } from '../../ui/page.tsx';
import { Switch } from '../../ui/switch.tsx';
import styles from './gallery.module.css';
import { RecipeCard } from './recipe-card.tsx';

/** What each family of chart is for. */
const familyNotes: Readonly<Record<ChartFamily, string>> = {
  trend: 'How a value moves over time.',
  comparison: 'How values compare across categories.',
  distribution: 'How values spread.',
  composition: 'How a whole splits into parts.',
  relationship: 'How measures move together.',
  flow: 'How things move between stages or nodes.',
  geo: 'Where values are.',
  kpi: 'One number, at a glance.',
  table: 'Rows to read.',
  layout: 'Several charts working together.',
};

/**
 * The family filter: every family, or one.
 *
 * @param props - The family shown and the change callback.
 * @param props.value - The family shown, or `all`.
 * @param props.onChange - Called with another choice.
 * @returns The chips.
 */
function FamilyFilter({
  value,
  onChange,
}: {
  readonly value: ChartFamily | 'all';
  readonly onChange: (family: ChartFamily | 'all') => void;
}) {
  const options = ['all', ...chartFamilies] as const;
  return (
    <fieldset className={styles.chips}>
      <legend className={styles.hidden}>Family</legend>
      {options.map((family) => (
        <button
          key={family}
          type="button"
          aria-pressed={value === family}
          className={styles.chip}
          onClick={() => onChange(family)}
        >
          {family === 'all' ? 'All' : family}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * The cards of one family: one per recipe, or one per recipe and variant.
 *
 * @param props - The family, its recipes and whether every variant shows.
 * @param props.family - The family.
 * @param props.recipes - Its recipes.
 * @param props.everyVariant - Whether each variant gets its own card.
 * @returns The section.
 */
function FamilySection({
  family,
  recipes,
  everyVariant,
}: {
  readonly family: ChartFamily;
  readonly recipes: readonly ChartRecipe[];
  readonly everyVariant: boolean;
}) {
  const cards = recipes.flatMap<{ recipe: ChartRecipe; variant: string | undefined }>((recipe) =>
    everyVariant
      ? ['', ...Object.keys(recipe.variants)].map((variant) => ({ recipe, variant }))
      : [{ recipe, variant: undefined }],
  );
  return (
    <section className={styles.family} aria-labelledby={`family-${family}`}>
      <h2 id={`family-${family}`} className={styles.familyTitle}>
        {family} <span className={styles.familyNote}>{familyNotes[family]}</span>
      </h2>
      <div className={styles.grid}>
        {cards.map(({ recipe, variant }) => (
          <RecipeCard
            key={`${recipe.id}:${variant ?? ''}`}
            recipe={recipe}
            {...(variant === undefined ? {} : { variant })}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * The chart gallery: every chart recipe drawn from its own fake sample, by family.
 *
 * @returns The screen.
 */
export function ChartGalleryScreen() {
  const [family, setFamily] = useState<ChartFamily | 'all'>('all');
  const [everyVariant, setEveryVariant] = useState(false);
  const families = chartFamilies.filter((each) => family === 'all' || each === family);
  return (
    <Page
      title="Charts"
      subtitle={`${chartRecipes.length} chart recipes, each drawn from its own fake sample. The agent picks one for the shape of the data and the question, then adapts it.`}
    >
      <div className={styles.toolbar}>
        <FamilyFilter value={family} onChange={setFamily} />
        <Switch label="Every variant" checked={everyVariant} onChange={setEveryVariant} />
      </div>
      {families.map((each) => (
        <FamilySection
          key={each}
          family={each}
          recipes={chartRecipes.filter((recipe) => recipe.family === each)}
          everyVariant={everyVariant}
        />
      ))}
    </Page>
  );
}
