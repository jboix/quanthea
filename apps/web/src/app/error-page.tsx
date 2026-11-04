import type { ReactNode } from 'react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { ApiError } from '../lib/api-client.ts';
import { Button, buttonClassName } from '../ui/button.tsx';
import { EmptyState } from '../ui/empty-state.tsx';
import { LockIcon, SearchIcon, WarningIcon } from '../ui/icons.tsx';

/** What the error page says. */
interface ErrorCopy {
  /** The heading. */
  readonly title: string;
  /** One sentence of explanation. */
  readonly message: string;
  /** The mark above the heading. */
  readonly icon: ReactNode;
  /** Whether reloading may help: a fault, not a refusal or a missing page. */
  readonly retry: boolean;
}

/**
 * Chooses the wording for an error thrown by a loader or a render.
 *
 * @param error - The routing error.
 * @returns Heading, explanation, mark, and whether to offer Reload. A 403 says the role is the
 *   reason, as the architecture asks.
 */
function describeError(error: unknown): ErrorCopy {
  if (isRouteErrorResponse(error) && error.status === 403) {
    return {
      title: "Your role can't open this",
      message: 'Ask an admin if you need access.',
      icon: <LockIcon />,
      retry: false,
    };
  }
  if (isRouteErrorResponse(error) && error.status === 404) {
    return {
      title: 'Nothing lives here',
      message: 'It may have been deleted, or the link is old.',
      icon: <SearchIcon />,
      retry: false,
    };
  }
  if (error instanceof ApiError) {
    return {
      title: 'The server answered with an error',
      message: error.message,
      icon: <WarningIcon />,
      retry: true,
    };
  }
  return {
    title: 'Something went wrong',
    message: 'This screen failed to draw. Reloading usually fixes it.',
    icon: <WarningIcon />,
    retry: true,
  };
}

/**
 * The error boundary of the app. Inside the layout it keeps the rail visible.
 *
 * @returns The error screen.
 */
export function ErrorPage() {
  const { title, message, icon, retry } = describeError(useRouteError());
  const home = (
    <Link to="/" className={buttonClassName(retry ? 'secondary' : 'primary')}>
      Go to the start page
    </Link>
  );
  return (
    <EmptyState
      page
      icon={icon}
      title={title}
      action={
        retry ? (
          <>
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
            {home}
          </>
        ) : (
          home
        )
      }
    >
      {message}
    </EmptyState>
  );
}
