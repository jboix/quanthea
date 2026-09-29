import type { ConnectorDetail } from '@querent/shared';
import { Link } from 'react-router';
import { Button, buttonClassName } from '../../ui/button.tsx';
import { Pill } from '../../ui/pill.tsx';
import styles from './connector.module.css';
import { type Health, useHealth } from './health.ts';

/**
 * The pill next to the name: the result of the last connection test.
 *
 * @param props - The health.
 * @param props.health - The connector's health.
 * @returns The pill.
 */
function HealthPill({ health }: { readonly health: Health }) {
  if (health.testing) return <Pill>testing…</Pill>;
  if (!health.report) return <Pill>not tested</Pill>;
  if (!health.report.ok) return <Pill tone="danger">failed</Pill>;
  return <Pill tone="ok">connected · {Math.round(health.report.latencyMs)} ms</Pill>;
}

/**
 * The top of a connector's screen: name, health, target, and the Test and Edit actions. A failed
 * test says why under the target. A connector the configuration file manages has no Edit.
 *
 * @param props - The connector.
 * @param props.connector - The connector.
 * @returns The header.
 */
export function ConnectorHeader({ connector }: { readonly connector: ConnectorDetail }) {
  const health = useHealth(connector.id, connector.updatedAt);
  const failure = health.report && !health.report.ok ? health.report.message : undefined;
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        <div className={styles.titleRow}>
          <h2 className={styles.name}>{connector.name}</h2>
          <HealthPill health={health} />
          {connector.managedBy && (
            <span title={connector.managedBy}>
              <Pill tone="accent">managed by {connector.managedBy.split('/').at(-1)}</Pill>
            </span>
          )}
        </div>
        {connector.target !== null && <p className={styles.target}>{connector.target}</p>}
        {connector.managedBy && (
          <p className={styles.target}>
            The configuration file manages this connector. Change it there.
          </p>
        )}
        {failure !== undefined && (
          <p role="alert" className={styles.failure}>
            {failure}
          </p>
        )}
      </div>
      <div className={styles.headerActions}>
        <Button onClick={health.retest} disabled={health.testing}>
          Test
        </Button>
        {!connector.managedBy && (
          <Link to="edit" className={buttonClassName()}>
            Edit connection
          </Link>
        )}
      </div>
    </header>
  );
}
