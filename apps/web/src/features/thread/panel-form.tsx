/**
 * The inspector's edit form for the common changes to a draft panel: its title and description,
 * the main colour of a chart from theme colours, a chart from the recipes with its variants and
 * unit, and the text of each SQL, PromQL or LogQL query. Anything else is edited as JSON.
 */
import { type ChartUnit, chartRecipe, chartRecipes, chartUnits } from '@quanthea/shared';
import { Input } from '../../ui/input.tsx';
import { Select } from '../../ui/select.tsx';
import { TextArea } from '../../ui/text-area.tsx';
import { EditFooter } from './edit-footer.tsx';
import {
  colourChoices,
  mainColour,
  queryTextOf,
  unitOf,
  withMainColour,
  withQueryText,
  withWords,
} from './panel-edit-model.ts';
import styles from './panel-editor.module.css';
import type { PanelEditState } from './use-panel-edit.ts';

/** The choices of the colour menu: the theme's order, then each colour. */
const colourOptions = [
  { value: '', label: 'Theme order' },
  ...colourChoices.map((choice) => ({ value: choice.token, label: choice.label })),
];

/** The choices of the chart menu: the panel's own, then each recipe by family. */
const recipeOptions = [
  { value: '', label: 'Keep this chart' },
  ...chartRecipes.map((recipe) => ({
    value: recipe.id,
    label: recipe.title,
    group: recipe.family,
  })),
];

/**
 * The title and the description.
 *
 * @param props - The edit.
 * @param props.edit - The edit.
 * @returns The fields.
 */
function Words({ edit }: { readonly edit: PanelEditState }) {
  const { draft } = edit;
  const description = draft.description ?? '';
  return (
    <>
      <Input
        label="Title"
        value={draft.title}
        onChange={(event) =>
          edit.setDraft(withWords(draft, { title: event.target.value, description }))
        }
      />
      <TextArea
        label="Description"
        rows={2}
        value={description}
        onChange={(event) =>
          edit.setDraft(withWords(draft, { title: draft.title, description: event.target.value }))
        }
      />
    </>
  );
}

/**
 * The main colour of a chart.
 *
 * @param props - The edit.
 * @param props.edit - The edit.
 * @returns The menu, or nothing for a panel that is no chart.
 */
function Colour({ edit }: { readonly edit: PanelEditState }) {
  if (edit.draft.view.kind !== 'chart' || edit.chart) return null;
  return (
    <Select
      label="Main colour"
      hint="The first series takes it; theme colours only."
      options={colourOptions}
      value={mainColour(edit.draft) ?? ''}
      onChange={(event) =>
        edit.setDraft(withMainColour(edit.draft, event.target.value || undefined))
      }
    />
  );
}

/**
 * The variants of the chart picked, each a checkbox.
 *
 * @param props - The edit.
 * @param props.edit - The edit, with a chart picked.
 * @returns The checkboxes.
 */
function Variants({ edit }: { readonly edit: PanelEditState }) {
  const picked = edit.chart;
  const recipe = picked ? chartRecipe(picked.recipe) : undefined;
  if (!picked || !recipe) return null;
  const toggle = (name: string, on: boolean) => {
    const variants = on
      ? [...picked.variants, name]
      : picked.variants.filter((each) => each !== name);
    edit.setChart({ ...picked, variants });
  };
  return (
    <fieldset className={styles.variants}>
      <legend>Variants</legend>
      {Object.entries(recipe.variants).map(([name, variant]) => (
        <label key={name} title={variant.whenToUse}>
          <input
            type="checkbox"
            checked={picked.variants.includes(name)}
            onChange={(event) => toggle(name, event.target.checked)}
          />
          {variant.title}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * The chart a choice of the chart menu picks: none for the panel's own, else the recipe with no
 * variant, in the unit the panel reads in now.
 *
 * @param recipe - The recipe's id, empty for the panel's own.
 * @param edit - The edit.
 * @returns The chart, or `undefined`.
 */
function pickedChart(recipe: string, edit: PanelEditState) {
  return recipe ? { recipe, variants: [], unit: unitOf(edit.draft) } : undefined;
}

/**
 * The chart: keep the panel's own, or pick a recipe, its variants and its unit. A picked chart is
 * rebuilt from the recipe on the test run's data.
 *
 * @param props - The edit.
 * @param props.edit - The edit.
 * @returns The fields.
 */
function Chart({ edit }: { readonly edit: PanelEditState }) {
  const picked = edit.chart;
  const unitOptions = chartUnits.map((unit) => ({ value: unit, label: unit }));
  return (
    <>
      <Select
        label="Chart"
        hint={
          picked
            ? 'Rebuilt from the recipe; changes made to the old chart are not kept.'
            : undefined
        }
        options={recipeOptions}
        value={picked?.recipe ?? ''}
        onChange={(event) => edit.setChart(pickedChart(event.target.value, edit))}
      />
      <Variants edit={edit} />
      {picked && (
        <Select
          label="Unit"
          options={unitOptions}
          value={picked.unit ?? 'number'}
          onChange={(event) => edit.setChart({ ...picked, unit: event.target.value as ChartUnit })}
        />
      )}
    </>
  );
}

/**
 * The text of each query the form can edit; the others point at the JSON tab.
 *
 * @param props - The edit.
 * @param props.edit - The edit.
 * @returns The fields.
 */
function Queries({ edit }: { readonly edit: PanelEditState }) {
  const { draft } = edit;
  return draft.queries.map((query) => {
    const text = queryTextOf(query);
    const label = `Query ${query.refId} · ${query.connector}`;
    if (text === undefined)
      return (
        <p key={query.refId} className={styles.note}>
          {label}: edit it in the JSON tab.
        </p>
      );
    return (
      <TextArea
        key={query.refId}
        label={label}
        mono
        rows={Math.min(12, text.split('\n').length + 1)}
        value={text}
        onChange={(event) => edit.setDraft(withQueryText(draft, query.refId, event.target.value))}
      />
    );
  });
}

/**
 * The edit form.
 *
 * @param props - The edit.
 * @param props.edit - The edit.
 * @returns The form.
 */
export function PanelForm({ edit }: { readonly edit: PanelEditState }) {
  return (
    <div className={styles.form}>
      <div className={styles.fields}>
        <Words edit={edit} />
        <Colour edit={edit} />
        <Chart edit={edit} />
      </div>
      <div className={styles.fields}>
        <Queries edit={edit} />
      </div>
      <EditFooter edit={edit} />
    </div>
  );
}
