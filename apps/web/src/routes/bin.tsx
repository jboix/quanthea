import { Page } from '../ui/page.tsx';
import { Placeholder } from '../ui/placeholder.tsx';

/**
 * The bin: binned dashboards, restore, and permanent deletion for admins.
 *
 * @returns The screen.
 */
export function BinRoute() {
  return (
    <Page
      title="Bin"
      subtitle="Binned dashboards stay here until an admin deletes them or the retention setting purges them."
    >
      <Placeholder title="Binned dashboards go here.">
        This screen is not designed yet. It follows the visual language of the others.
      </Placeholder>
    </Page>
  );
}
