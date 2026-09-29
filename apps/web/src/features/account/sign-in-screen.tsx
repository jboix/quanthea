import { type FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Logo } from '../../ui/brand.tsx';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Input } from '../../ui/input.tsx';
import styles from './account.module.css';
import { FormRefusal } from './new-password.tsx';
import { useAccountForm } from './use-account-form.ts';

/**
 * The sign-in form: an email and a password.
 *
 * @returns The form.
 */
function SignInForm() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const form = useAccountForm('/login');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    form.submit({ email, password, next: params.get('next') ?? '/' });
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <Input
        label="Email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Input
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <FormRefusal refusal={form.refusal} />
      <Button type="submit" variant="primary" disabled={form.busy}>
        Sign in
      </Button>
    </form>
  );
}

/**
 * The sign-in page.
 *
 * @returns The page.
 */
export function SignInScreen() {
  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        <Logo height={40} />
        <Card title="Sign in to querent">
          <SignInForm />
        </Card>
        <p className={styles.note}>No account? Ask an admin for an invite link.</p>
      </div>
    </div>
  );
}
