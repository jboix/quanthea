import { hasRole, type Principal, type Role } from '@quanthea/shared';
import type { ReactNode } from 'react';
import { Link, useMatch } from 'react-router';
import { AccountMenu } from '../features/account/index.ts';
import { useFiringAlerts } from '../features/alerts/index.ts';
import { useUnseenReports } from '../features/reports/index.ts';
import { BrandIcon } from '../ui/brand.tsx';
import {
  BellIcon,
  BinIcon,
  ConnectorsIcon,
  LibraryIcon,
  ReportIcon,
  SettingsIcon,
  ThreadsIcon,
  UserIcon,
} from '../ui/icons.tsx';
import styles from './layout.module.css';

/** One destination in the rail. */
interface RailItem {
  /** The accessible name, also shown as a tooltip. */
  readonly label: string;
  /** Where the link goes. */
  readonly to: string;
  /** Every path under this prefix marks the item as current. */
  readonly section: string;
  /** The weakest role that sees the item. */
  readonly minimum: Role;
  /** The icon. */
  readonly icon: ReactNode;
  /** A count shown on the icon, such as the alerts firing. */
  readonly badge?: number | undefined;
  /** Whether something new waits there, such as a report's run not opened yet: a dot. */
  readonly dot?: boolean | undefined;
}

/** The items at the top of the rail. */
const topItems: readonly RailItem[] = [
  {
    label: 'Threads',
    to: '/threads/new',
    section: '/threads',
    minimum: 'editor',
    icon: <ThreadsIcon />,
  },
  {
    label: 'Library',
    to: '/library',
    section: '/library',
    minimum: 'viewer',
    icon: <LibraryIcon />,
  },
  {
    label: 'Alerts',
    to: '/alerts',
    section: '/alerts',
    minimum: 'viewer',
    icon: <BellIcon />,
  },
  {
    label: 'Reports',
    to: '/reports',
    section: '/reports',
    minimum: 'viewer',
    icon: <ReportIcon />,
  },
  {
    label: 'Connectors',
    to: '/connectors',
    section: '/connectors',
    minimum: 'admin',
    icon: <ConnectorsIcon />,
  },
];

/** The items at the bottom of the rail. */
const bottomItems: readonly RailItem[] = [
  { label: 'Bin', to: '/bin', section: '/bin', minimum: 'analyst', icon: <BinIcon /> },
  {
    label: 'Settings',
    to: '/settings/model',
    section: '/settings',
    minimum: 'admin',
    icon: <SettingsIcon />,
  },
];

/**
 * What a rail link is named, with its count or its dot.
 *
 * @param item - The item.
 * @returns Such as `Alerts, 2 firing` or `Reports, new runs`.
 */
function railLabel(item: RailItem): string {
  if (item.badge) return `${item.label}, ${item.badge} firing`;
  return item.dot ? `${item.label}, new runs` : item.label;
}

/**
 * One icon link, marked as the current page while the location is inside its section.
 *
 * @param props - The item to render.
 * @returns The link.
 */
function RailLink({ item }: { readonly item: RailItem }) {
  const isCurrent = useMatch(`${item.section}/*`) !== null;
  const { badge, dot } = item;
  const label = railLabel(item);
  const badgeText = badge && badge > 99 ? '99+' : badge;
  return (
    <Link
      to={item.to}
      aria-label={label}
      title={label}
      aria-current={isCurrent ? 'page' : undefined}
      className={styles.railLink}
    >
      {item.icon}
      {badge ? (
        <span className={styles.badge} aria-hidden="true">
          {badgeText}
        </span>
      ) : null}
      {dot && !badge ? <span className={styles.dot} aria-hidden="true" /> : null}
    </Link>
  );
}

/**
 * The 56 px navigation rail. It shows only the destinations the role can open.
 *
 * @param props - Who is signed in.
 * @param props.principal - Who is signed in: their role sets the items, and the account menu
 *   names them.
 * @returns The rail.
 */
export function NavRail({ principal }: { readonly principal: Principal }) {
  const visible = (item: RailItem): boolean => hasRole(principal.role, item.minimum);
  const firing = useFiringAlerts();
  const unseen = useUnseenReports();
  const withCount = (item: RailItem): RailItem => {
    if (item.to === '/alerts') return { ...item, badge: firing };
    return item.to === '/reports' ? { ...item, dot: (unseen ?? 0) > 0 } : item;
  };
  return (
    <nav aria-label="Primary" className={styles.rail}>
      <Link to="/" aria-label="quanthea home" className={styles.logo}>
        <BrandIcon size={32} />
      </Link>
      {topItems.filter(visible).map((item) => (
        <RailLink key={item.to} item={withCount(item)} />
      ))}
      <div className={styles.spacer} />
      {bottomItems.filter(visible).map((item) => (
        <RailLink key={item.to} item={item} />
      ))}
      <AccountMenu
        principal={principal}
        trigger={<UserIcon />}
        triggerClassName={styles.railLink ?? ''}
      />
    </nav>
  );
}
