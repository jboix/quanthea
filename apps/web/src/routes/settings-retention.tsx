import { Page } from '../ui/page.tsx';
import { Placeholder } from '../ui/placeholder.tsx';

/**
 * Settings → Retention: how long binned dashboards are kept.
 *
 * @returns The screen.
 */
export function SettingsRetentionRoute() {
  return (
    <Page title="Retention" subtitle="Binned dashboards are kept forever unless you set a limit.">
      <Placeholder title="Keep binned dashboards: forever, or for N days.">
        This screen is not designed yet. It follows the visual language of the others.
      </Placeholder>
    </Page>
  );
}
