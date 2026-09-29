import { NavLink, Outlet } from 'react-router';
import styles from './settings-layout.module.css';

/** The settings sections, in menu order. */
const sections = [
  { to: '/settings/model', label: 'Model' },
  { to: '/settings/usage', label: 'Usage' },
  { to: '/settings/auth', label: 'Authentication' },
  { to: '/settings/retention', label: 'Retention' },
] as const;

/**
 * The settings frame: a section menu above the selected section.
 *
 * @returns The layout around the section screen.
 */
export function SettingsLayout() {
  return (
    <>
      <nav aria-label="Settings" className={styles.nav}>
        {sections.map((section) => (
          <NavLink key={section.to} to={section.to} className={styles.link ?? ''}>
            {section.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
