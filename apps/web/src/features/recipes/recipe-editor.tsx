import {
  panelUnits,
  type RecipeParamKind,
  recipeParamKinds,
  type SavedRecipe,
} from '@querent/shared';
import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Input } from '../../ui/input.tsx';
import { Select } from '../../ui/select.tsx';
import { TextArea } from '../../ui/text-area.tsx';
import { idOf, paramsOf, type RecipeDraft, recipeOf } from './recipe-draft.ts';
import styles from './recipes.module.css';

/** What a placeholder of each kind may hold, for the admin. */
const kindHints: Readonly<Record<RecipeParamKind, string>> = {
  metric: 'a metric name',
  label: 'a label name (PromQL) or a column (SQL)',
  table: 'a table, or schema.table',
  column: 'a column name',
  value: 'a quoted literal, or a bound $variable',
  duration: 'such as 5m, or $interval',
};

/** How a panel may show. */
const showOptions = [
  { value: 'line', label: 'Line over time' },
  { value: 'bar', label: 'Bars over time' },
  { value: 'category-bar', label: 'Bars by category' },
  { value: 'pie', label: 'Pie' },
  { value: 'stat', label: 'One number' },
  { value: 'table', label: 'Table' },
] as const;

/** Props of the editor's parts. */
interface PartProps {
  /** The draft. */
  readonly draft: RecipeDraft;
  /** Changes the draft. */
  readonly change: (patch: Partial<RecipeDraft>) => void;
  /** The problems by field. */
  readonly issues: Readonly<Record<string, string>>;
}

/**
 * The name, id and description.
 *
 * @param props - The draft, its setter and the issues.
 * @param isNew - Whether the id still follows the name.
 * @returns The fields.
 */
function NameFields({ draft, change, issues, isNew }: PartProps & { readonly isNew: boolean }) {
  const rename = (name: string) => change(isNew ? { name, id: idOf(name) } : { name });
  return (
    <>
      <div className={styles.pair}>
        <Input
          label="Name"
          value={draft.name}
          onChange={(event) => rename(event.target.value)}
          error={issues.name}
        />
        <Input
          label="Id"
          mono
          value={draft.id}
          disabled={!isNew}
          hint="The agent asks for it by this id."
          onChange={(event) => change({ id: event.target.value })}
          error={issues.id}
        />
      </div>
      <Input
        label="What it shows"
        value={draft.description}
        hint="One sentence. The agent reads it to pick the recipe."
        onChange={(event) => change({ description: event.target.value })}
        error={issues.description}
      />
    </>
  );
}

/**
 * The language and the query.
 *
 * @param props - The draft, its setter and the issues.
 * @returns The fields.
 */
function QueryFields({ draft, change, issues }: PartProps) {
  const time =
    draft.language === 'sql'
      ? 'Use :__from and :__to for the time range, unquoted.'
      : 'Use $__rate_interval or a duration placeholder for windows.';
  return (
    <>
      <Select
        label="Language"
        value={draft.language}
        options={[
          { value: 'promql', label: 'PromQL' },
          { value: 'sql', label: 'SQL' },
        ]}
        onChange={(event) => change({ language: event.target.value as SavedRecipe['language'] })}
      />
      <TextArea
        label="Query"
        mono
        rows={4}
        value={draft.query}
        hint={`Write placeholders as {{name}}, unquoted: the server quotes each value. ${time}`}
        onChange={(event) => change({ query: event.target.value })}
        error={issues.query}
      />
    </>
  );
}

/** One placeholder. */
type Param = SavedRecipe['params'][number];

/**
 * One placeholder's row: its kind and what it is.
 *
 * @param props - The placeholder and its setter.
 * @param props.param - The placeholder.
 * @param props.set - Changes its kind or description.
 * @returns The row.
 */
function ParamRow({
  param,
  set,
}: {
  readonly param: Param;
  readonly set: (patch: Partial<RecipeDraft['params'][string]>) => void;
}) {
  return (
    <div className={styles.param}>
      <code className={styles.paramName}>{`{{${param.name}}}`}</code>
      <Select
        label={`Kind of ${param.name}`}
        hideLabel
        value={param.kind}
        hint={kindHints[param.kind]}
        options={recipeParamKinds.map((kind) => ({ value: kind, label: kind }))}
        onChange={(event) => set({ kind: event.target.value as RecipeParamKind })}
      />
      <Input
        label={`What ${param.name} is`}
        hideLabel
        placeholder="What the agent should put here"
        value={param.description}
        onChange={(event) => set({ description: event.target.value })}
      />
    </div>
  );
}

/**
 * The placeholders the query names: a kind and a description each.
 *
 * @param props - The draft, its setter and the issues.
 * @returns The rows, or a note when the query has none.
 */
function ParamFields({ draft, change, issues }: PartProps) {
  const params = paramsOf(draft);
  if (params.length === 0) return <p className={styles.hint}>This query has no placeholders.</p>;
  const setter = (param: Param) => (patch: Partial<RecipeDraft['params'][string]>) => {
    const { kind, description } = { ...param, ...patch };
    change({ params: { ...draft.params, [param.name]: { kind, description } } });
  };
  return (
    <div className={styles.params}>
      {params.map((param) => (
        <ParamRow key={param.name} param={param} set={setter(param)} />
      ))}
      {issues.params !== undefined && <p className={styles.error}>{issues.params}</p>}
    </div>
  );
}

/**
 * How the panel shows: the view, the unit, and a table's columns.
 *
 * @param props - The draft, its setter and the issues.
 * @returns The fields.
 */
function ViewFields({ draft, change, issues }: PartProps) {
  return (
    <div className={styles.pair}>
      <Select
        label="Shows as"
        value={draft.show}
        options={showOptions}
        onChange={(event) => change({ show: event.target.value as SavedRecipe['show'] })}
      />
      <Select
        label="Unit"
        value={draft.unit}
        options={panelUnits.map((unit) => ({ value: unit, label: unit }))}
        onChange={(event) => change({ unit: event.target.value as SavedRecipe['unit'] })}
      />
      {draft.show === 'table' && (
        <Input
          label="Columns"
          mono
          value={draft.columns}
          hint="The result's columns, separated by commas."
          onChange={(event) => change({ columns: event.target.value })}
          error={issues.columns}
        />
      )}
    </div>
  );
}

/** Props of {@link RecipeEditor}. */
interface RecipeEditorProps {
  /** The recipe to start from. */
  readonly start: RecipeDraft;
  /** Whether it is a new recipe, whose id follows its name. */
  readonly isNew: boolean;
  /** Ids other recipes already have. */
  readonly taken: readonly string[];
  /** Called with the checked recipe. */
  readonly onDone: (recipe: SavedRecipe) => void;
  /** Called to drop the changes. */
  readonly onCancel: () => void;
}

/**
 * The editor of one saved recipe. Done checks it as the server will.
 *
 * @param props - The recipe, whether it is new, the ids taken, and the callbacks.
 * @returns The card.
 */
export function RecipeEditor({ start, isNew, taken, onDone, onCancel }: RecipeEditorProps) {
  const [draft, setDraft] = useState(start);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const change = (patch: Partial<RecipeDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const done = () => {
    const checked = recipeOf(draft);
    if (!checked.ok) return setIssues(checked.issues);
    if (isNew && taken.includes(checked.recipe.id))
      return setIssues({ id: 'Another recipe has this id.' });
    onDone(checked.recipe);
  };
  const parts = { draft, change, issues };
  return (
    <Card title={isNew ? 'New recipe' : `Edit ${start.name}`}>
      <NameFields {...parts} isNew={isNew} />
      <QueryFields {...parts} />
      <ParamFields {...parts} />
      <ViewFields {...parts} />
      <div className={styles.actions}>
        <Button variant="primary" onClick={done}>
          Done
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}
