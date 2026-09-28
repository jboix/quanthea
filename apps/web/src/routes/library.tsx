import { Link } from 'react-router';
import { buttonClassName } from '../ui/button.tsx';
import { Page } from '../ui/page.tsx';
import { Placeholder } from '../ui/placeholder.tsx';

/**
 * The Library screen: search over pinned dashboards.
 *
 * @returns The screen.
 */
export function LibraryRoute() {
  return (
    <Page
      title="Library"
      subtitle="Pinned dashboards are frozen. Opening one runs its saved queries, with no model involved."
      actions={
        <Link to="/threads/new" className={buttonClassName('primary', 'large')}>
          New thread
        </Link>
      }
    >
      <Placeholder title="Search, tag filters and dashboard cards go here.">
        Opening a pinned dashboard never calls a model.
      </Placeholder>
    </Page>
  );
}
