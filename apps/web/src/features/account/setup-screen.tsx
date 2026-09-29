import { type FormEvent, useState } from 'react';
import { Logo } from '../../ui/brand.tsx';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Input } from '../../ui/input.tsx';
import styles from './account.module.css';
import { FormRefusal, NewPasswordFields, useNewPassword } from './new-password.tsx';
import { useAccountForm } from './use-account-form.ts';

/**
 * The form of the default admin's own name, email and password.
 *
 * @returns The form.
 */
function SetupForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const state = useNewPassword();
  const form = useAccountForm('/setup');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!state.mismatch) form.submit({ name, email, password: state.password });
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <Input
        label="Your name"
        autoComplete="name"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Input
        label="Your email"
        type="email"
        autoComplete="email"
        required
        error={form.refusal?.fields.email}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <NewPasswordFields state={state} error={form.refusal?.fields.password} />
      <FormRefusal refusal={form.refusal} />
      <Button type="submit" variant="primary" disabled={form.busy || Boolean(state.mismatch)}>
        Save and continue
      </Button>
    </form>
  );
}

/**
 * The page the default admin sees after the first sign-in: they choose their own email and
 * password, which replace `admin` and the password from the log.
 *
 * @returns The page.
 */
export function SetupScreen() {
  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        <Logo height={40} />
        <Card
          title="Set up your admin account"
          description="Your email and password replace “admin” and the password from the log."
        >
          <SetupForm />
        </Card>
      </div>
    </div>
  );
}
