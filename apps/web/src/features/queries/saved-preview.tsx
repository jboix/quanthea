import type { QueryLanguage, SavedQuery } from '@querent/shared';
import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
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
 * A value for each placeholder, as the agent would give them.
 *
 * @param props - The placeholders, the values and the change callback.
 * @param props.params - The placeholders.
 * @param props.values - The values by placeholder.
 * @param props.onChange - Called with the new values.
 * @returns The fields.
 */
function ParamInputs({
  params,
  values,
  onChange,
}: {
  readonly params: SavedQuery['params'];
  readonly values: Readonly<Record<string, string>>;
  readonly onChange: (values: Record<string, string>) => void;
}) {
  return (
    <div className={styles.pair}>
      {params.map((param) => (
        <Input
          key={param.name}
          label={param.name}
          mono
          hint={param.description || param.kind}
          value={values[param.name] ?? ''}
          onChange={(event) => onChange({ ...values, [param.name]: event.target.value })}
        />
      ))}
    </div>
  );
}

/** Props of {@link SavedPreview}. */
interface SavedPreviewProps {
  /** The query, or `undefined` while a draft has problems. */
  readonly recipe: SavedQuery | undefined;
  /** The query's language, for the connectors offered. */
  readonly language: QueryLanguage;
  /** The connectors a preview can run on. */
  readonly connectors: readonly PreviewConnector[];
}

/**
 * Tries a query as edited on a real connector: a value for each placeholder, as the agent would
 * give them, then the queries written and the panel drawn. The query goes along with the
 * preview, so changes not saved yet are tried too.
 *
 * @param props - The query, its language and the connectors.
 * @returns The preview's fields, its button and its result.
 */
export function SavedPreview({ recipe, language, connectors }: SavedPreviewProps) {
  const [chosen, setConnector] = useState('');
  const connector = connectorFor(connectors, language, chosen);
  const [values, setValues] = useState<Record<string, string>>({});
  const { run, from, setFrom, chart, setChart, running, preview } = usePreview();
  const start = () => {
    if (!recipe) return;
    const data = { kind: 'saved', name: recipe.id, connector, params: values };
    run(data, recipe);
  };
  return (
    <div className={styles.preview}>
      <div className={styles.pair}>
        <ConnectorSelect
          connectors={connectors}
          language={language}
          value={connector}
          onChange={setConnector}
        />
        <RangeSelect value={from} onChange={setFrom} />
      </div>
      <ChartSelect value={chart} suggested={undefined} onChange={setChart} />
      <ParamInputs params={recipe?.params ?? []} values={values} onChange={setValues} />
      <div className={styles.actions}>
        <Button onClick={start} disabled={!recipe || connector === '' || running}>
          {running ? 'Running…' : 'Run preview'}
        </Button>
        {!recipe && <span className={styles.hint}>Fix the query above to try it.</span>}
      </div>
      {preview && <PreviewResult preview={preview} />}
    </div>
  );
}
