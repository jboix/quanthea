import type { QueryBuilder, QueryGuide } from '@querent/shared';
import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Switch } from '../../ui/switch.tsx';
import { TextArea } from '../../ui/text-area.tsx';
import type { PreviewConnector } from './data.ts';
import {
  ChartSelect,
  ConnectorSelect,
  connectorFor,
  PreviewResult,
  RangeSelect,
  usePreview,
} from './preview.tsx';
import styles from './queries.module.css';

/**
 * JSON with one top-level field per line, each value on its line in full.
 *
 * @param fields - The fields.
 * @returns Such as `{\n  "metric": "up",\n  "by": ["job"]\n}`.
 */
function compactJson(fields: Readonly<Record<string, unknown>>): string {
  const lines = Object.entries(fields).map(
    ([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`,
  );
  return `{\n${lines.join(',\n')}\n}`;
}

/**
 * The example's fields to start a preview from: no connector, which the preview picks, and no
 * filters on variables, which a lone panel does not have.
 *
 * @param example - The example request.
 * @returns The fields.
 */
function previewFields(example: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { connector: _connector, filters, ...fields } = example;
  const literal = Array.isArray(filters)
    ? filters.filter((filter) => !String((filter as { value?: unknown }).value).startsWith('$'))
    : [];
  return literal.length === 0 ? fields : { ...fields, filters: literal };
}

/**
 * The fields the agent fills, with their types, defaults and meaning.
 *
 * @param props - The guide.
 * @param props.guide - How the builder works.
 * @returns The card.
 */
function FieldsCard({ guide }: { readonly guide: QueryGuide }) {
  return (
    <Card
      title="What the agent fills"
      description="Besides a title. Fields with a default can be left out."
    >
      <table className={styles.fields}>
        <tbody>
          {guide.fields.map((field) => (
            <tr key={field.name}>
              <td className={styles.fieldName}>
                {field.name}
                {field.required ? '' : '?'}
              </td>
              <td>
                <code className={styles.fieldType}>{field.type}</code>
                {'default' in field && (
                  <span className={styles.hint}> · default {JSON.stringify(field.default)}</span>
                )}
                <div className={styles.hint}>{field.description}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/**
 * An example request and the queries the server writes for it.
 *
 * @param props - The guide.
 * @param props.guide - How the builder works.
 * @returns The card.
 */
function ExampleCard({ guide }: { readonly guide: QueryGuide }) {
  return (
    <Card title="Example" description="What the agent sends, and the query the server writes.">
      <div className={styles.example}>
        <pre className={styles.code}>{compactJson(guide.example)}</pre>
        <span className={styles.arrow} aria-hidden="true">
          →
        </span>
        <div className={styles.result}>
          {guide.queries.map((query) => (
            <pre key={query} className={styles.code}>
              {query}
            </pre>
          ))}
        </div>
      </div>
    </Card>
  );
}

/**
 * What the builder returns: the shape and the columns, and a chart that suits them.
 *
 * @param props - The guide.
 * @param props.guide - How the builder works.
 * @returns The card.
 */
function OutputCard({ guide }: { readonly guide: QueryGuide }) {
  const { shape, columns, chart } = guide.output;
  return (
    <Card title="What it returns" description="Any chart recipe for this shape can draw it.">
      <p className={styles.hint}>
        A <strong>{shape}</strong> table:{' '}
        <code className={styles.fieldType}>{columns.join(', ')}</code>. It suits{' '}
        <code className={styles.fieldType}>{chart}</code>.
      </p>
    </Card>
  );
}

/**
 * The request a preview sends: the typed JSON on the chosen connector.
 *
 * @param id - The builder.
 * @param text - The typed JSON.
 * @param connector - The connector.
 * @returns The data request, or why the JSON cannot be read.
 */
function requestOf(id: string, text: string, connector: string) {
  try {
    const fields = JSON.parse(text) as Record<string, unknown>;
    return { data: { ...fields, kind: id, connector } };
  } catch {
    return { error: 'The request is not valid JSON.' };
  }
}

/**
 * Tries the builder on a real connector: edit the example, run it, and see its data drawn.
 *
 * @param props - The builder, its guide and the connectors.
 * @param props.query - The builder.
 * @param props.guide - How it works, with the example to start from.
 * @param props.connectors - The connectors a preview can run on.
 * @returns The card.
 */
function PreviewCard({
  recipe,
  guide,
  connectors,
}: {
  readonly recipe: QueryBuilder;
  readonly guide: QueryGuide;
  readonly connectors: readonly PreviewConnector[];
}) {
  const [text, setText] = useState(() => compactJson(previewFields(guide.example)));
  const [chosen, setConnector] = useState('');
  const connector = connectorFor(connectors, recipe.language, chosen);
  const { run, from, setFrom, chart, setChart, running, preview } = usePreview();
  const request = requestOf(recipe.id, text, connector);
  const start = request.data ? () => run(request.data) : undefined;
  return (
    <Card
      title="Preview"
      description="Change the fields to your data and run it. Nothing is saved."
    >
      <div className={styles.pair}>
        <ConnectorSelect
          connectors={connectors}
          language={recipe.language}
          value={connector}
          onChange={setConnector}
        />
        <RangeSelect value={from} onChange={setFrom} />
      </div>
      <ChartSelect value={chart} suggested={guide.output.chart} onChange={setChart} />
      <TextArea
        label="Fields"
        mono
        rows={6}
        value={text}
        error={request.error}
        onChange={(event) => setText(event.target.value)}
      />
      <div className={styles.actions}>
        <Button onClick={start} disabled={!start || connector === '' || running}>
          {running ? 'Running…' : 'Run preview'}
        </Button>
      </div>
      {preview && <PreviewResult preview={preview} />}
    </Card>
  );
}

/** Props of {@link BuiltInDetail}. */
interface BuiltInDetailProps {
  /** The builder. */
  readonly recipe: QueryBuilder;
  /** How it works. */
  readonly guide: QueryGuide;
  /** Whether the default set has it. */
  readonly enabled: boolean;
  /** Switches it on or off. */
  readonly onToggle: (on: boolean) => void;
  /** The connectors a preview can run on. */
  readonly connectors: readonly PreviewConnector[];
}

/**
 * A query builder: whether the default set has it, what the agent fills, an example and a
 * preview.
 *
 * @param props - The builder, its guide, its switch and the connectors.
 * @returns The detail.
 */
export function BuiltInDetail({
  recipe,
  guide,
  enabled,
  onToggle,
  connectors,
}: BuiltInDetailProps) {
  return (
    <div className={styles.detail}>
      <header className={styles.detailHead}>
        <h2 className={styles.detailTitle}>{recipe.name}</h2>
        <p className={styles.hint}>{recipe.description}</p>
      </header>
      <Card>
        <Switch
          label="In the default set"
          description="Threads started with the default queries can use it. A thread can still choose it when it starts."
          checked={enabled}
          onChange={onToggle}
        />
      </Card>
      <FieldsCard guide={guide} />
      <ExampleCard guide={guide} />
      <OutputCard guide={guide} />
      <PreviewCard key={recipe.id} recipe={recipe} guide={guide} connectors={connectors} />
    </div>
  );
}
