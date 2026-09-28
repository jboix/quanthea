import { Link } from 'react-router';
import { Page } from '../ui/page.tsx';
import { Placeholder } from '../ui/placeholder.tsx';

/**
 * Shown for any path no screen handles.
 *
 * @returns The screen.
 */
export function NotFoundRoute() {
  return (
    <Page title="Not found">
      <Placeholder title="Nothing lives at this address.">
        <Link to="/">Go to the start page</Link>
      </Placeholder>
    </Page>
  );
}
