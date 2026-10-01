import {
  chartRecipes,
  type QueryLanguage,
  type QueryPreview,
  queryLanguageNames,
  type SavedQuery,
} from '@querent/shared';
import { useState } from 'react';
import { type SubmitTarget, useFetcher } from 'react-router';
import { Select } from '../../ui/select.tsx';
import { PanelView } from '../dashboard/index.ts';
import type { PreviewConnector, PreviewRange, QueriesIntent, QueriesOutcome } from './data.ts';
import styles from './queries.module.css';

/** The time ranges a preview offers. */
const rangeOptions: readonly { value: PreviewRange; label: string }[] = [
  { value: 'now-1h', label: 'Last hour' },
  { value: 'now-6h', label: 'Last 6 hours' },
  { value: 'now-24h', label: 'Last 24 hours' },
  { value: 'now-7d', label: 'Last 7 days' },
  { value: 'now-30d', label: 'Last 30 days' },
];

/**
 * Runs previews through the route action, over the time range chosen.
 *
 * @returns The run function, the range and its setter, whether one is running, and the last
 *   preview.
 */
export function usePreview() {
  const fetcher = useFetcher<QueriesOutcome>();
  const [from, setFrom] = useState<PreviewRange>('now-24h');
  const [chart, setChart] = useState('');
  const run = (data: Readonly<Record<string, unknown>>, saved?: SavedQuery) => {
    const intent: QueriesIntent = {
      intent: 'preview',
      data,
      from,
      ...(chart ? { chart } : {}),
      ...(saved ? { saved } : {}),
    };
    void fetcher.submit(intent as unknown as SubmitTarget, {
      method: 'post',
      encType: 'application/json',
    });
  };
  const preview = fetcher.data?.intent === 'preview' ? fetcher.data.preview : undefined;
  return { run, from, setFrom, chart, setChart, running: fetcher.state !== 'idle', preview };
}

/**
 * The chart a preview draws with: the one that suits the data, or any query.
 *
 * @param props - The query chosen, the suggested one and the change callback.
 * @param props.value - The query chosen, or an empty string for the suggested one.
 * @param props.suggested - The query that suits the data, if known.
 * @param props.onChange - Called with another query.
 * @returns The dropdown.
 */
export function ChartSelect({
  value,
  suggested,
  onChange,
}: {
  readonly value: string;
  readonly suggested: string | undefined;
  readonly onChange: (recipe: string) => void;
}) {
  const options = [
    { value: '', label: suggested ? `Suggested: ${suggested}` : 'Suggested for the data' },
    ...chartRecipes.map((recipe) => ({
      value: recipe.id,
      label: `${recipe.title} · ${recipe.id}`,
      group: recipe.family,
    })),
  ];
  return (
    <Select
      label="Chart"
      options={options}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * The time range a preview covers.
 *
 * @param props - The range and its setter.
 * @param props.value - The range.
 * @param props.onChange - Called with another range.
 * @returns The dropdown.
 */
export function RangeSelect({
  value,
  onChange,
}: {
  readonly value: PreviewRange;
  readonly onChange: (range: PreviewRange) => void;
}) {
  return (
    <Select
      label="Time range"
      options={rangeOptions}
      value={value}
      onChange={(event) => onChange(event.target.value as PreviewRange)}
    />
  );
}

/** Props of {@link ConnectorSelect}. */
interface ConnectorSelectProps {
  /** Every connector. */
  readonly connectors: readonly PreviewConnector[];
  /** The query's language; only its connectors are offered. */
  readonly language: QueryLanguage;
  /** The connector chosen. */
  readonly value: string;
  /** Called with another connector. */
  readonly onChange: (name: string) => void;
}

/**
 * The connector a preview runs on, among those of the query's language.
 *
 * @param props - The connectors, the language, the value and the change callback.
 * @returns The dropdown, or a note when there is no such connector.
 */
export function ConnectorSelect({ connectors, language, value, onChange }: ConnectorSelectProps) {
  const matching = connectors.filter((connector) => connector.language === language);
  if (matching.length === 0) {
    return (
      <p className={styles.hint}>
        Add a connector that runs {queryLanguageNames[language]} to preview this query.
      </p>
    );
  }
  return (
    <Select
      label="Run on"
      options={matching.map((connector) => ({ value: connector.name, label: connector.name }))}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * The connector a preview runs on: the one chosen when it has the query's language, else the
 * first one that has it.
 *
 * @param connectors - Every connector.
 * @param language - The query's language.
 * @param chosen - The connector chosen, if any.
 * @returns Its name, or an empty string when no connector has the language.
 */
export function connectorFor(
  connectors: readonly PreviewConnector[],
  language: QueryLanguage,
  chosen = '',
): string {
  const matching = connectors.filter((connector) => connector.language === language);
  return (matching.find((connector) => connector.name === chosen) ?? matching[0])?.name ?? '';
}

/**
 * A preview: the queries written, then the panel drawn from its run, or what went wrong.
 *
 * @param props - The preview.
 * @param props.preview - The preview.
 * @returns The result.
 */
export function PreviewResult({ preview }: { readonly preview: QueryPreview }) {
  const failures = preview.ok ? preview.run.queries.filter((query) => query.error) : [];
  const empty =
    preview.ok &&
    preview.run.queries.every((query) => query.frames.every((frame) => frame.meta.rowCount === 0));
  return (
    <div className={styles.result}>
      {preview.ok && preview.columns.length > 0 && (
        <p className={styles.hint}>Columns: {preview.columns.join(', ')}</p>
      )}
      {preview.queries.map((query) => (
        <pre key={query} className={styles.code}>
          {query}
        </pre>
      ))}
      {!preview.ok && <p className={styles.error}>{preview.message}</p>}
      {failures.map((query) => (
        <p key={query.refId} className={styles.error}>
          {query.error?.message}
        </p>
      ))}
      {empty && failures.length === 0 && (
        <p className={styles.hint}>No rows in this time range. Try a longer one.</p>
      )}
      {preview.ok && failures.length === 0 && !empty && (
        <div className={styles.panel}>
          <PanelView
            panel={preview.panel}
            queries={preview.run.queries}
            markers={preview.run.markers}
            timeZone={undefined}
          />
        </div>
      )}
    </div>
  );
}
