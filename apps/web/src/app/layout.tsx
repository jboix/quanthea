import { Outlet, useLoaderData } from 'react-router';
import { AccountNotice } from '../features/account/index.ts';
import { BrandMark } from '../ui/brand.tsx';
import styles from './layout.module.css';
import { NavRail } from './nav-rail.tsx';
import type { Session } from './session.ts';

/**
 * The app frame: what an account change reported, the navigation rail, and the screen.
 *
 * @returns The layout around the current screen.
 */
export function AppLayout() {
  const session = useLoaderData<Session>();
  return (
    <div className={styles.app}>
      <AccountNotice />
      <div className={styles.shell}>
        <NavRail principal={session.principal} />
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/**
 * Shown while the first session request is in flight: the quanthea mark, pulsing unless the user
 * asked for reduced motion.
 *
 * @returns The loading page.
 */
export function LoadingScreen() {
  return (
    <div className={styles.fullPage} aria-busy="true">
      <span className={styles.pulse}>
        <BrandMark size={40} label="Loading quanthea" />
      </span>
    </div>
  );
}
