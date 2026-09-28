import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { ApiError } from '../lib/api-client.ts';
import { Page } from '../ui/page.tsx';
import { Placeholder } from '../ui/placeholder.tsx';

/** What the error page says. */
interface ErrorCopy {
  /** The heading. */
  readonly title: string;
  /** One sentence of explanation. */
  readonly message: string;
}

/**
 * Chooses the wording for an error thrown by a loader or a render.
 *
 * @param error - The routing error.
 * @returns Heading and explanation. A 403 says the role is the reason, as the architecture asks.
 */
function describeError(error: unknown): ErrorCopy {
  if (isRouteErrorResponse(error) && error.status === 403) {
    return { title: "Your role can't do this", message: 'Ask an admin if you need access.' };
  }
  if (isRouteErrorResponse(error) && error.status === 404) {
    return { title: 'Not found', message: 'Nothing lives at this address.' };
  }
  if (error instanceof ApiError) {
    return { title: 'The server answered with an error', message: error.message };
  }
  return { title: 'Something went wrong', message: 'Reload the page to try again.' };
}

/**
 * The error boundary of the app. Inside the layout it keeps the rail visible.
 *
 * @returns The error screen.
 */
export function ErrorPage() {
  const { title, message } = describeError(useRouteError());
  return (
    <Page title={title}>
      <Placeholder title={message}>
        <Link to="/">Go to the start page</Link>
      </Placeholder>
    </Page>
  );
}
