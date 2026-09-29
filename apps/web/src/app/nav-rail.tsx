import { hasRole, type Role } from '@querent/shared';
import type { ReactNode } from 'react';
import { Link, useMatch } from 'react-router';
import { BrandIcon } from '../ui/brand.tsx';
import {
  BinIcon,
  ConnectorsIcon,
  LibraryIcon,
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
    label: 'Connectors',
    to: '/connectors',
    section: '/connectors',
    minimum: 'admin',
    icon: <ConnectorsIcon />,
  },
];

/** The items at the bottom of the rail. */
const bottomItems: readonly RailItem[] = [
  { label: 'Bin', to: '/bin', section: '/bin', minimum: 'editor', icon: <BinIcon /> },
  {
    label: 'Settings',
    to: '/settings/model',
    section: '/settings',
    minimum: 'admin',
    icon: <SettingsIcon />,
  },
  {
    label: 'Your account',
    to: '/account',
    section: '/account',
    minimum: 'viewer',
    icon: <UserIcon />,
  },
];

/**
 * One icon link, marked as the current page while the location is inside its section.
 *
 * @param props - The item to render.
 * @returns The link.
 */
function RailLink({ item }: { readonly item: RailItem }) {
  const isCurrent = useMatch(`${item.section}/*`) !== null;
  return (
    <Link
      to={item.to}
      aria-label={item.label}
      title={item.label}
      aria-current={isCurrent ? 'page' : undefined}
      className={styles.railLink}
    >
      {item.icon}
    </Link>
  );
}

/**
 * The 56 px navigation rail. It shows only the destinations the role can open.
 *
 * @param props - The role of the current user.
 * @returns The rail.
 */
export function NavRail({ role }: { readonly role: Role }) {
  const visible = (item: RailItem): boolean => hasRole(role, item.minimum);
  return (
    <nav aria-label="Primary" className={styles.rail}>
      <Link to="/" aria-label="querent home" className={styles.logo}>
        <BrandIcon size={32} />
      </Link>
      {topItems.filter(visible).map((item) => (
        <RailLink key={item.to} item={item} />
      ))}
      <div className={styles.spacer} />
      {bottomItems.filter(visible).map((item) => (
        <RailLink key={item.to} item={item} />
      ))}
    </nav>
  );
}
