import { type FormEvent, useState } from 'react';
import { Logo } from '../../ui/brand.tsx';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import styles from './account.module.css';
import { FormRefusal, NewPasswordFields, useNewPassword } from './new-password.tsx';
import { useAccountForm } from './use-account-form.ts';

/**
 * The link's token, read once from after the `#` and then removed from the address bar, so it
 * stays out of the browser's history and any screenshot.
 *
 * @returns The token, or an empty string.
 */
function useLinkToken(): string {
  const [token] = useState(() => {
    const value = window.location.hash.slice(1);
    if (value) window.history.replaceState(null, '', window.location.pathname);
    return value;
  });
  return token;
}

/**
 * The form of the new password, twice.
 *
 * @param props - The token.
 * @param props.token - The link's token.
 * @returns The form.
 */
function NewPasswordForm({ token }: { readonly token: string }) {
  const state = useNewPassword();
  const form = useAccountForm('/set-password');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!state.mismatch) form.submit({ token, password: state.password });
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <NewPasswordFields state={state} error={form.refusal?.fields.password} />
      <FormRefusal refusal={form.refusal} />
      <Button type="submit" variant="primary" disabled={form.busy || Boolean(state.mismatch)}>
        Set password and sign in
      </Button>
    </form>
  );
}

/**
 * The page an invite or reset link opens: choose a password, then sign in.
 *
 * @returns The page.
 */
export function SetPasswordScreen() {
  const token = useLinkToken();
  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        <Logo height={40} />
        <Card title="Choose a password">
          {token ? (
            <NewPasswordForm token={token} />
          ) : (
            <p className={styles.error}>
              This link is incomplete. Open the whole link you were sent.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
