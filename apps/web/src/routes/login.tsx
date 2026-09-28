import { Logo } from '../ui/brand.tsx';
import { Card } from '../ui/card.tsx';
import styles from './login.module.css';

/**
 * The sign-in page, used in the `basic` and `oidc` authentication modes.
 *
 * @returns The screen.
 */
export function LoginRoute() {
  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        <Logo height={40} />
        <Card
          title="Sign in to querent"
          description="Sign-in is not available yet on this server."
        />
      </div>
    </div>
  );
}
