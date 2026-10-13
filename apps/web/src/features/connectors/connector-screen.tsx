import { useLoaderData } from 'react-router';
import { AccessSection } from './access-section.tsx';
import styles from './connector.module.css';
import { ConnectorHeader } from './connector-header.tsx';
import type { ConnectorData } from './data.ts';
import { GuardrailsSection } from './guardrails-section.tsx';
import { useHealth } from './health.ts';
import { ObjectsSection } from './objects-section.tsx';
import { SchemaPanel } from './schema-panel.tsx';
import { useConnectorsData } from './use-connectors-data.ts';
import { writeAccessOf } from './write-access.ts';
import { WriteWarning } from './write-warning.tsx';

/**
 * One connector: its header, the warning when its credentials can write, what the model can see,
 * what the connector shows, its guardrails, and the schema the model gets. The settings are
 * read-only when the configuration file manages it; the warning shows all the same.
 *
 * @returns The screen.
 */
export function ConnectorScreen() {
  const { connector, schema } = useLoaderData() as ConnectorData;
  const { kinds } = useConnectorsData();
  const { report } = useHealth(connector.id, connector.updatedAt);
  const language = kinds.find((kind) => kind.kind === connector.kind)?.language;
  return (
    <div className={styles.screen}>
      <ConnectorHeader connector={connector} />
      <WriteWarning access={writeAccessOf(report)} />
      <div className={styles.columns}>
        <fieldset className={styles.settings} disabled={connector.managedBy !== undefined}>
          <AccessSection connector={connector} schema={schema} />
          <ObjectsSection
            key={connector.id}
            connector={connector}
            schema={schema}
            language={language}
          />
          <GuardrailsSection key={connector.id} connector={connector} language={language} />
        </fieldset>
        <SchemaPanel key={connector.id} connector={connector} schema={schema} />
      </div>
    </div>
  );
}
