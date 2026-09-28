import { Page } from '../ui/page.tsx';
import { Placeholder } from '../ui/placeholder.tsx';

/**
 * The Model settings screen: provider, key, capability test and the model for each job.
 *
 * @returns The screen.
 */
export function SettingsModelRoute() {
  return (
    <Page
      title="Model"
      subtitle="Bring your own key or point at your own gateway. Pinned dashboards never use it."
    >
      <Placeholder title="Provider, capability test, model per job and limits go here.">
        Pinned dashboards never use the model.
      </Placeholder>
    </Page>
  );
}
