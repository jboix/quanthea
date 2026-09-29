import {
  type QueryParamKind,
  queryParamKinds,
  type SavedQuery,
  shapeGuides,
  shapeKinds,
} from '@querent/shared';
import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Input } from '../../ui/input.tsx';
import { Select } from '../../ui/select.tsx';
import { TextArea } from '../../ui/text-area.tsx';
import type { PreviewConnector } from './data.ts';
import styles from './queries.module.css';
import { idOf, paramsOf, type QueryDraft, recipeOf } from './query-draft.ts';
import { SavedPreview } from './saved-preview.tsx';

/** What a placeholder of each kind may hold, for the admin. */
const kindHints: Readonly<Record<QueryParamKind, string>> = {
  metric: 'a metric name',
  label: 'a label name (PromQL) or a column (SQL)',
  table: 'a table, or schema.table',
  column: 'a column name',
  value: 'a quoted literal, or a bound $variable',
  duration: 'such as 5m, or $interval',
};

/** Props of the editor's parts. */
interface PartProps {
  /** The draft. */
  readonly draft: QueryDraft;
  /** Changes the draft. */
  readonly change: (patch: Partial<QueryDraft>) => void;
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
        hint="One sentence. The agent reads it to pick the saved query."
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
        onChange={(event) => change({ language: event.target.value as SavedQuery['language'] })}
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
type Param = SavedQuery['params'][number];

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
  readonly set: (patch: Partial<QueryDraft['params'][string]>) => void;
}) {
  return (
    <div className={styles.param}>
      <code className={styles.paramName}>{`{{${param.name}}}`}</code>
      <Select
        label={`Kind of ${param.name}`}
        hideLabel
        value={param.kind}
        hint={kindHints[param.kind]}
        options={queryParamKinds.map((kind) => ({ value: kind, label: kind }))}
        onChange={(event) => set({ kind: event.target.value as QueryParamKind })}
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
  const setter = (param: Param) => (patch: Partial<QueryDraft['params'][string]>) => {
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
 * The shape of the table the query returns, which decides the charts that can draw it.
 *
 * @param props - The draft and its setter.
 * @returns The field.
 */
function ShapeField({ draft, change }: PartProps) {
  return (
    <Select
      label="Returns"
      value={draft.shape}
      hint={shapeGuides[draft.shape]}
      options={shapeKinds.map((shape) => ({ value: shape, label: shape }))}
      onChange={(event) => change({ shape: event.target.value as SavedQuery['shape'] })}
    />
  );
}

/** Props of {@link QueryEditor}. */
interface QueryEditorProps {
  /** The saved query to start from. */
  readonly start: QueryDraft;
  /** Whether it is a new saved query, whose id follows its name. */
  readonly isNew: boolean;
  /** Ids other saved queries already have. */
  readonly taken: readonly string[];
  /** Called with the checked saved query. */
  readonly onDone: (query: SavedQuery) => void;
  /** Called to drop the changes. */
  readonly onCancel: () => void;
  /** The connectors a preview can run on. */
  readonly connectors: readonly PreviewConnector[];
}

/**
 * The editor of one saved query. Done checks it as the server will.
 *
 * @param props - The saved query, whether it is new, the ids taken, the callbacks and the connectors.
 * @returns The card.
 */
export function QueryEditor(props: QueryEditorProps) {
  const { start, isNew, taken, onDone, onCancel } = props;
  const [draft, setDraft] = useState(start);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const change = (patch: Partial<QueryDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const done = () => {
    const checked = recipeOf(draft);
    if (!checked.ok) return setIssues(checked.issues);
    if (isNew && taken.includes(checked.recipe.id))
      return setIssues({ id: 'Another saved query has this id.' });
    onDone(checked.recipe);
  };
  const parts = { draft, change, issues };
  const checked = recipeOf(draft);
  return (
    <div className={styles.detail}>
      <Card title={isNew ? 'New saved query' : `Edit ${start.name}`}>
        <NameFields {...parts} isNew={isNew} />
        <QueryFields {...parts} />
        <ParamFields {...parts} />
        <ShapeField {...parts} />
      </Card>
      <Card
        title="Try it"
        description="Run the saved query as it stands on a connector before you keep it."
      >
        <SavedPreview
          recipe={checked.ok ? checked.recipe : undefined}
          language={draft.language}
          connectors={props.connectors}
        />
      </Card>
      <div className={styles.actions}>
        <Button variant="primary" onClick={done}>
          Done
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
