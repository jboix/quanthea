import type { ManagedSettings } from '@quanthea/shared';
import { NavLink, Outlet, useLoaderData, useLocation } from 'react-router';
import { Banner } from '../ui/banner.tsx';
import { InfoIcon } from '../ui/icons.tsx';
import styles from './settings-layout.module.css';

/** The settings sections, in groups, in menu order. */
const groups = [
  {
    label: 'Agent',
    sections: [
      { to: '/settings/model', label: 'Model' },
      { to: '/settings/queries', label: 'Queries' },
    ],
  },
  {
    label: 'Dashboards',
    sections: [
      { to: '/settings/charts', label: 'Charts' },
      { to: '/settings/hosts', label: 'Links and images' },
    ],
  },
  {
    label: 'Alerts and reports',
    sections: [{ to: '/settings/notifications', label: 'Notifications' }],
  },
  {
    label: 'People',
    sections: [
      { to: '/settings/users', label: 'Users' },
      { to: '/settings/auth', label: 'Sign-in' },
    ],
  },
  {
    label: 'System',
    sections: [
      { to: '/settings/usage', label: 'Usage' },
      { to: '/settings/server', label: 'Server' },
    ],
  },
] as const;

/**
 * The section menu, its sections in labelled groups.
 *
 * @returns The menu.
 */
function SettingsMenu() {
  return (
    <nav aria-label="Settings" className={styles.nav}>
      {groups.map((group) => (
        <div key={group.label} className={styles.group}>
          <h2 className={styles.groupLabel}>{group.label}</h2>
          {group.sections.map((section) => (
            <NavLink key={section.to} to={section.to} className={styles.link ?? ''}>
              {section.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

/**
 * The file that manages the section on screen, if any.
 *
 * @param managed - Which sections the configuration file manages.
 * @param pathname - The current path, such as `/settings/model`.
 * @returns The file's path, or `undefined`.
 */
function managingFile(managed: ManagedSettings | undefined, pathname: string): string | undefined {
  const section = pathname.split('/')[2] ?? '';
  return managed?.sections[section];
}

/**
 * The settings frame: a section menu beside the selected section. A section the configuration file
 * manages is shown read-only, under a banner naming the file.
 *
 * @returns The layout around the section screen.
 */
export function SettingsLayout() {
  const managed = useLoaderData() as ManagedSettings | undefined;
  const file = managingFile(managed, useLocation().pathname);
  return (
    <div className={styles.frame}>
      <SettingsMenu />
      <div className={styles.content}>
        {file && (
          <Banner tone="info" icon={<InfoIcon />}>
            <span title={file}>{file.split('/').at(-1)}</span> manages these settings. Change them
            there.
          </Banner>
        )}
        <fieldset className={styles.section} disabled={file !== undefined}>
          <Outlet />
        </fieldset>
      </div>
    </div>
  );
}
