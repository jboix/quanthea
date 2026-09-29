import type { ConnectorKindInfo, ConnectorSummary } from '@querent/shared';
import { Link, NavLink, Outlet } from 'react-router';
import { buttonClassName } from '../../ui/button.tsx';
import { Placeholder } from '../../ui/placeholder.tsx';
import { StatusDot } from '../../ui/status-dot.tsx';
import { accessLevelName } from './access-levels.ts';
import styles from './connectors.module.css';
import { type Health, healthStatus, useHealth } from './health.ts';
import { useConnectorsData } from './use-connectors-data.ts';

/** The badge colours, picked by kind so each kind keeps its colour. */
const badgeTones = ['accent', 'draft', 'ok', 'plain'] as const;

/**
 * The badge tone of a kind.
 *
 * @param kind - The kind identifier.
 * @returns A tone, stable for the kind.
 */
function badgeTone(kind: string): (typeof badgeTones)[number] {
  const sum = [...kind].reduce((total, character) => total + character.charCodeAt(0), 0);
  return badgeTones[sum % badgeTones.length] ?? 'plain';
}

/**
 * What a health dot means, in words.
 *
 * @param health - The health.
 * @returns The label.
 */
function healthLabel(health: Health): string {
  if (health.report) return health.report.ok ? 'Connected' : health.report.message;
  return health.testing ? 'Testing the connection' : 'Not tested';
}

/** Props of {@link ConnectorListItem}. */
interface ConnectorListItemProps {
  /** The connector. */
  readonly connector: ConnectorSummary;
  /** Its kind, when this server still offers it. */
  readonly kind: ConnectorKindInfo | undefined;
}

/**
 * One connector in the list: kind badge, name, kind and access level, and its health.
 *
 * @param props - The connector and its kind.
 * @returns The list item.
 */
function ConnectorListItem({ connector, kind }: ConnectorListItemProps) {
  const health = useHealth(connector.id, connector.updatedAt);
  const kindName = kind?.displayName ?? connector.kind;
  return (
    <li>
      <NavLink to={`/connectors/${connector.id}`} className={styles.item ?? ''}>
        <span className={styles.badge} data-tone={badgeTone(connector.kind)} aria-hidden="true">
          {kindName.slice(0, 2).toUpperCase()}
        </span>
        <span className={styles.itemText}>
          <span className={styles.itemName}>{connector.name}</span>
          <span className={styles.itemMeta}>
            {kindName} · {accessLevelName(connector.accessLevel)}
            {connector.managedBy && ' · from file'}
          </span>
        </span>
        <StatusDot status={healthStatus(health)} label={healthLabel(health)} />
      </NavLink>
    </li>
  );
}

/**
 * The connectors screen: the list on the left, the selected connector or a form on the right.
 *
 * @returns The layout.
 */
export function ConnectorsLayout() {
  const { connectors, kinds } = useConnectorsData();
  return (
    <div className={styles.screen}>
      <aside className={styles.sidebar}>
        <header className={styles.sidebarHeader}>
          <h1 className={styles.sidebarTitle}>Connectors</h1>
          <Link to="/connectors/new" className={buttonClassName('primary')}>
            Add
          </Link>
        </header>
        <nav aria-label="Connectors">
          <ul className={styles.list}>
            {connectors.map((connector) => (
              <ConnectorListItem
                key={connector.id}
                connector={connector}
                kind={kinds.find((kind) => kind.kind === connector.kind)}
              />
            ))}
          </ul>
        </nav>
        <p className={styles.note}>
          Credentials stay on this machine. The model only ever sees what each connector's access
          level allows.
        </p>
      </aside>
      <div className={styles.content}>
        <Outlet />
      </div>
    </div>
  );
}

/**
 * The right side when no connector is selected.
 *
 * @returns A prompt to pick or add one.
 */
export function ConnectorsIndex() {
  const { connectors } = useConnectorsData();
  const title =
    connectors.length === 0
      ? 'Add a connector to give the model something to query.'
      : 'Pick a connector to see what the model can see of it.';
  return (
    <div className={styles.empty}>
      <Placeholder title={title}>Only admins see this screen.</Placeholder>
    </div>
  );
}
