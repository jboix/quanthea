import { useState } from 'react';
import { Outlet, useLoaderData } from 'react-router';
import { Banner } from '../ui/banner.tsx';
import { BrandMark } from '../ui/brand.tsx';
import { WarningIcon } from '../ui/icons.tsx';
import styles from './layout.module.css';
import { NavRail } from './nav-rail.tsx';
import type { Session } from './session.ts';

/**
 * The app frame: the open-access banner in `none` mode, the navigation rail, and the screen. The
 * banner can be dismissed until the next page load.
 *
 * @returns The layout around the current screen.
 */
export function AppLayout() {
  const session = useLoaderData<Session>();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  return (
    <div className={styles.app}>
      {session.authMode === 'none' && !bannerDismissed && (
        <Banner icon={<WarningIcon />} onDismiss={() => setBannerDismissed(true)}>
          Open access: anyone who can reach this URL is an admin.
        </Banner>
      )}
      <div className={styles.shell}>
        <NavRail role={session.principal.role} />
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/**
 * Shown while the first session request is in flight: the querent mark, pulsing unless the user
 * asked for reduced motion.
 *
 * @returns The loading page.
 */
export function LoadingScreen() {
  return (
    <div className={styles.fullPage} aria-busy="true">
      <span className={styles.pulse}>
        <BrandMark size={40} label="Loading querent" />
      </span>
    </div>
  );
}
