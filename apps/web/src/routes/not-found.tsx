import { Link, useLocation, useNavigate } from 'react-router';
import { Button, buttonClassName } from '../ui/button.tsx';
import { EmptyState } from '../ui/empty-state.tsx';
import { SearchIcon } from '../ui/icons.tsx';
import styles from './not-found.module.css';

/**
 * Shown for any path no screen handles: the address, and the ways back.
 *
 * @returns The screen.
 */
export function NotFoundRoute() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <EmptyState
      page
      icon={<SearchIcon />}
      title="Nothing lives here"
      action={
        <>
          <Link to="/" className={buttonClassName('primary')}>
            Go to the start page
          </Link>
          <Button onClick={() => void navigate(-1)}>Go back</Button>
        </>
      }
    >
      No screen answers at <code className={styles.path}>{pathname}</code>. The link may be old, or
      mistyped.
    </EmptyState>
  );
}
