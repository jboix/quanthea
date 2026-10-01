import {
  type ChartFamily,
  type ChartRecipe,
  type ChartSettings,
  chartFamilies,
  chartRecipes,
} from '@quanthea/shared';
import { useState } from 'react';
import { type SubmitTarget, useFetcher, useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Page } from '../../ui/page.tsx';
import { Switch } from '../../ui/switch.tsx';
import type { ChartsOutcome } from './data.ts';
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
 * @param props.switches - Which recipes the agent is offered, and how to switch them.
 * @returns The section.
 */
function FamilySection({
  family,
  recipes,
  everyVariant,
  switches,
}: {
  readonly family: ChartFamily;
  readonly recipes: readonly ChartRecipe[];
  readonly everyVariant: boolean;
  readonly switches: Switches;
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
            enabled={!switches.disabled.includes(recipe.id)}
            onToggle={(on) => switches.toggle(recipe.id, on)}
            {...(variant === undefined ? {} : { variant })}
          />
        ))}
      </div>
    </section>
  );
}

/** Which recipes are switched off, and how to switch one. */
interface Switches {
  /** The recipes switched off. */
  readonly disabled: readonly string[];
  /** Switches a recipe on or off. */
  readonly toggle: (id: string, on: boolean) => void;
}

/**
 * The switches as edited, and the save bar's state.
 *
 * @param saved - The settings as saved.
 * @returns The switches, the save function, whether a save runs or anything changed, and a refusal.
 */
function useSwitches(saved: ChartSettings) {
  const [disabled, setDisabled] = useState<readonly string[]>(saved.disabled);
  const fetcher = useFetcher<ChartsOutcome>();
  const toggle = (id: string, on: boolean) =>
    setDisabled((current) => (on ? current.filter((each) => each !== id) : [...current, id]));
  const save = () =>
    void fetcher.submit({ disabled: [...disabled] } as SubmitTarget, {
      method: 'post',
      encType: 'application/json',
    });
  const dirty = JSON.stringify(disabled) !== JSON.stringify(saved.disabled);
  const refused = fetcher.data?.ok === false ? fetcher.data.message : undefined;
  return { disabled, toggle, save, saving: fetcher.state !== 'idle', dirty, refused };
}

/**
 * The chart gallery: every chart recipe drawn from its own fake sample, by family, each with its
 * switch for the agent.
 *
 * @returns The screen.
 */
export function ChartGalleryScreen() {
  const saved = useLoaderData() as ChartSettings;
  const [family, setFamily] = useState<ChartFamily | 'all'>('all');
  const [everyVariant, setEveryVariant] = useState(false);
  const switches = useSwitches(saved);
  const families = chartFamilies.filter((each) => family === 'all' || each === family);
  const offered = chartRecipes.length - switches.disabled.length;
  return (
    <Page
      title="Charts"
      subtitle={`${chartRecipes.length} chart recipes, each drawn from its own fake sample. The agent picks one for the shape of the data and the question, then adapts it. ${offered} are offered to it.`}
    >
      <div className={styles.toolbar}>
        <FamilyFilter value={family} onChange={setFamily} />
        <div className={styles.saveBar}>
          <Switch label="Every variant" checked={everyVariant} onChange={setEveryVariant} />
          <Button
            variant="primary"
            onClick={switches.save}
            disabled={!switches.dirty || switches.saving}
          >
            {switches.saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
      {switches.refused && <p className={styles.error}>{switches.refused}</p>}
      {families.map((each) => (
        <FamilySection
          key={each}
          family={each}
          recipes={chartRecipes.filter((recipe) => recipe.family === each)}
          everyVariant={everyVariant}
          switches={switches}
        />
      ))}
    </Page>
  );
}
