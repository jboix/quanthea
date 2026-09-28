import { Page } from '../ui/page.tsx';
import { Placeholder } from '../ui/placeholder.tsx';

/**
 * Settings → Authentication: open, basic or OIDC, role mapping and local users.
 *
 * @returns The screen.
 */
export function SettingsAuthRoute() {
  return (
    <Page title="Authentication" subtitle="Choose who can reach querent and with which role.">
      <Placeholder title="The mode selector, OIDC fields, role mapping and local users go here.">
        This screen is not designed yet. It follows the visual language of the others.
      </Placeholder>
    </Page>
  );
}
