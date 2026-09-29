import { useLoaderData } from 'react-router';
import { AccessSection } from './access-section.tsx';
import styles from './connector.module.css';
import { ConnectorHeader } from './connector-header.tsx';
import type { ConnectorData } from './data.ts';
import { GuardrailsSection } from './guardrails-section.tsx';
import { SchemaPanel } from './schema-panel.tsx';
import { useConnectorsData } from './use-connectors-data.ts';

/**
 * One connector: its header, what the model can see, its guardrails, and the schema the model
 * gets. The settings are read-only when the configuration file manages it.
 *
 * @returns The screen.
 */
export function ConnectorScreen() {
  const { connector, schema } = useLoaderData() as ConnectorData;
  const { kinds } = useConnectorsData();
  const language = kinds.find((kind) => kind.kind === connector.kind)?.language;
  return (
    <div className={styles.screen}>
      <ConnectorHeader connector={connector} />
      <div className={styles.columns}>
        <fieldset className={styles.settings} disabled={connector.managedBy !== undefined}>
          <AccessSection connector={connector} schema={schema} />
          <GuardrailsSection key={connector.id} connector={connector} language={language} />
        </fieldset>
        <SchemaPanel key={connector.id} connector={connector} schema={schema} />
      </div>
    </div>
  );
}
