import type { ManagedSettings } from '@querent/shared';
import { NavLink, Outlet, useLoaderData, useLocation } from 'react-router';
import { Banner } from '../ui/banner.tsx';
import { InfoIcon, WarningIcon } from '../ui/icons.tsx';
import styles from './settings-layout.module.css';

/** The settings sections, in menu order. */
const sections = [
  { to: '/settings/model', label: 'Model' },
  { to: '/settings/charts', label: 'Charts' },
  { to: '/settings/queries', label: 'Queries' },
  { to: '/settings/usage', label: 'Usage' },
  { to: '/settings/users', label: 'Users' },
  { to: '/settings/auth', label: 'Authentication' },
  { to: '/settings/retention', label: 'Retention' },
  { to: '/settings/server', label: 'Server' },
] as const;

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
 * What happened to the configuration file since startup: a change that was refused, or system
 * settings that wait for a restart.
 *
 * @param props - What the file manages, and its status.
 * @param props.managed - What the file manages, and its status.
 * @returns The banners, or nothing.
 */
function FileStatus({ managed }: { readonly managed: ManagedSettings | undefined }) {
  if (!managed) return null;
  return (
    <>
      {managed.problem && (
        <Banner tone="warning" icon={<WarningIcon />}>
          The last change to the configuration file was not applied, so the one before stays:{' '}
          {managed.problem}
        </Banner>
      )}
      {managed.restartNeeded.length > 0 && (
        <Banner tone="info" icon={<InfoIcon />}>
          Restart querent to apply the file's change to {managed.restartNeeded.join(', ')}.
        </Banner>
      )}
    </>
  );
}

/**
 * The settings frame: a section menu above the selected section. A section the configuration file
 * manages is shown read-only, under a banner naming the file.
 *
 * @returns The layout around the section screen.
 */
export function SettingsLayout() {
  const managed = useLoaderData() as ManagedSettings | undefined;
  const file = managingFile(managed, useLocation().pathname);
  return (
    <>
      <nav aria-label="Settings" className={styles.nav}>
        {sections.map((section) => (
          <NavLink key={section.to} to={section.to} className={styles.link ?? ''}>
            {section.label}
          </NavLink>
        ))}
      </nav>
      <FileStatus managed={managed} />
      {file && (
        <Banner tone="info" icon={<InfoIcon />}>
          <span title={file}>{file.split('/').at(-1)}</span> manages these settings. Change them
          there.
        </Banner>
      )}
      <fieldset className={styles.section} disabled={file !== undefined}>
        <Outlet />
      </fieldset>
    </>
  );
}
