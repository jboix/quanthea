import type { ConnectorKindInfo, ConnectorSummary } from '@querent/shared';
import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { buttonClassName } from '../../ui/button.tsx';
import { SearchIcon } from '../../ui/icons.tsx';
import { Placeholder } from '../../ui/placeholder.tsx';
import { StatusDot } from '../../ui/status-dot.tsx';
import { accessLevelName } from './access-levels.ts';
import styles from './connectors.module.css';
import { type Health, healthStatus, useHealth } from './health.ts';
import { KindIcon } from './kind-icon.tsx';
import { useConnectorsData } from './use-connectors-data.ts';

/** From how many connectors the list gets a filter. */
const filterFrom = 7;

/**
 * The connectors whose name or kind holds every word of a filter.
 *
 * @param connectors - The connectors.
 * @param kinds - The kinds, for their names.
 * @param filter - What the admin typed.
 * @returns The matching connectors, in order.
 */
function matchingConnectors(
  connectors: readonly ConnectorSummary[],
  kinds: readonly ConnectorKindInfo[],
  filter: string,
): ConnectorSummary[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  return connectors.filter((connector) => {
    const kindName = kinds.find((kind) => kind.kind === connector.kind)?.displayName ?? '';
    const text = `${connector.name} ${connector.kind} ${kindName}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
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
 * One connector in the list: kind icon, name, kind and access level, and its health.
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
        <KindIcon kind={connector.kind} info={kind} />
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
 * The filter of a long connector list.
 *
 * @param props - The filter text and its setter.
 * @param props.value - The filter text.
 * @param props.onChange - Called with the new text.
 * @returns The search field.
 */
function ConnectorFilter({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <search className={styles.filter}>
      <span className={styles.filterIcon}>
        <SearchIcon />
      </span>
      <input
        type="search"
        aria-label="Filter the connectors"
        className={styles.filterInput}
        placeholder="Filter"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </search>
  );
}

/**
 * The connectors screen: the list on the left, the selected connector or a form on the right. A
 * long list gets a filter by name and kind.
 *
 * @returns The layout.
 */
export function ConnectorsLayout() {
  const { connectors, kinds } = useConnectorsData();
  const [filter, setFilter] = useState('');
  const shown = matchingConnectors(connectors, kinds, filter);
  return (
    <div className={styles.screen}>
      <aside className={styles.sidebar}>
        <header className={styles.sidebarHeader}>
          <h1 className={styles.sidebarTitle}>Connectors</h1>
          <Link to="/connectors/new" className={buttonClassName('primary')}>
            Add
          </Link>
        </header>
        {connectors.length >= filterFrom && <ConnectorFilter value={filter} onChange={setFilter} />}
        <nav aria-label="Connectors">
          <ul className={styles.list}>
            {shown.map((connector) => (
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
