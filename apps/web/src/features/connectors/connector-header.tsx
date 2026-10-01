import type { ConnectorDetail, ConnectorKindInfo } from '@querent/shared';
import { Link } from 'react-router';
import { Button, buttonClassName } from '../../ui/button.tsx';
import { Pill } from '../../ui/pill.tsx';
import styles from './connector.module.css';
import { type Health, useHealth } from './health.ts';
import { KindIcon } from './kind-icon.tsx';
import { pluginLabel } from './kinds.ts';
import { useConnectorsData } from './use-connectors-data.ts';

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

/** Props of the header's parts. */
interface PartProps {
  /** The connector. */
  readonly connector: ConnectorDetail;
  /** Its health. */
  readonly health: Health;
}

/**
 * The pills beside the name: health, or a missing plugin; the kind's plugin; the managing file.
 *
 * @param props - The connector, its health and its kind.
 * @param props.kind - The kind, when it is offered.
 * @returns The pills.
 */
function TitlePills({
  connector,
  health,
  kind,
}: PartProps & { readonly kind: ConnectorKindInfo | undefined }) {
  return (
    <>
      {connector.installed ? (
        <HealthPill health={health} />
      ) : (
        <Pill tone="danger">plugin not installed</Pill>
      )}
      {kind?.plugin && (
        <span title={kind.plugin.name}>
          <Pill>{pluginLabel(kind)}</Pill>
        </span>
      )}
      {connector.managedBy && (
        <span title={connector.managedBy}>
          <Pill tone="accent">managed by {connector.managedBy.split('/').at(-1)}</Pill>
        </span>
      )}
    </>
  );
}

/**
 * Test and Edit, for a connector whose kind is offered. A connector the file manages has no Edit.
 *
 * @param props - The connector and its health.
 * @returns The actions, or nothing.
 */
function HeaderActions({ connector, health }: PartProps) {
  if (!connector.installed) return null;
  return (
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
  );
}

/**
 * The top of a connector's screen: kind icon, name, health, target, and the Test and Edit actions. A
 * failed test says why under the target. A connector whose plugin is gone says so, with no actions.
 *
 * @param props - The connector.
 * @param props.connector - The connector.
 * @returns The header.
 */
export function ConnectorHeader({ connector }: { readonly connector: ConnectorDetail }) {
  const health = useHealth(connector.id, connector.updatedAt);
  const { kinds } = useConnectorsData();
  const kind = kinds.find((candidate) => candidate.kind === connector.kind);
  const failure = health.report && !health.report.ok ? health.report.message : undefined;
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        <div className={styles.titleRow}>
          <KindIcon kind={connector.kind} info={kind} size={28} />
          <h2 className={styles.name}>{connector.name}</h2>
          <TitlePills connector={connector} health={health} kind={kind} />
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
      <HeaderActions connector={connector} health={health} />
    </header>
  );
}
