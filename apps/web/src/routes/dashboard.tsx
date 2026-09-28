import { useParams } from 'react-router';
import { Page } from '../ui/page.tsx';
import { Pill } from '../ui/pill.tsx';
import { Placeholder } from '../ui/placeholder.tsx';

/**
 * The pinned, read-only dashboard: the latest pinned version, or the version in the URL.
 *
 * @returns The screen.
 */
export function DashboardRoute() {
  const { dashboardId = '', version } = useParams();
  return (
    <Page
      title="Dashboard"
      actions={
        <Pill tone="ok" mono>
          {version === undefined
            ? `${dashboardId} · latest pinned`
            : `${dashboardId} · v${version}`}
        </Pill>
      }
    >
      <Placeholder title="The pinned dashboard goes here.">
        Its saved queries run on the server with no model call.
      </Placeholder>
    </Page>
  );
}
