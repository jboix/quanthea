import { type FormEvent, useState } from 'react';
import { useRouteLoaderData, useSearchParams } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Input } from '../../ui/input.tsx';
import { Page } from '../../ui/page.tsx';
import styles from './account.module.css';
import { FormRefusal, NewPasswordFields, useNewPassword } from './new-password.tsx';
import { useAccountForm } from './use-account-form.ts';

/** The session the root route loads. */
interface RootSession {
  /** Who is signed in. */
  readonly principal: { readonly name: string; readonly role: string };
  /** The authentication mode. */
  readonly authMode: 'none' | 'accounts';
}

/**
 * Changing the password: the current one, then the new one twice.
 *
 * @returns The card.
 */
function ChangePassword() {
  const [current, setCurrent] = useState('');
  const state = useNewPassword();
  const [params] = useSearchParams();
  const form = useAccountForm('/account');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!state.mismatch)
      form.submit({ intent: 'change-password', current, password: state.password });
  };
  return (
    <Card title="Password" description="Changing it signs you out everywhere else.">
      <form className={styles.form} onSubmit={submit}>
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          error={form.refusal?.fields.current}
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
        <NewPasswordFields state={state} error={form.refusal?.fields.password} />
        <FormRefusal refusal={form.refusal} />
        {params.get('changed') && <p className={styles.done}>Password changed.</p>}
        <div>
          <Button type="submit" variant="primary" disabled={form.busy || Boolean(state.mismatch)}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Signing out.
 *
 * @returns The button.
 */
function SignOut() {
  const form = useAccountForm('/account');
  return (
    <Button disabled={form.busy} onClick={() => form.submit({ intent: 'sign-out' })}>
      Sign out
    </Button>
  );
}

/**
 * The account page: who you are, your password, and signing out.
 *
 * @returns The page.
 */
export function AccountScreen() {
  const session = useRouteLoaderData('root') as RootSession | undefined;
  if (!session) return null;
  const accounts = session.authMode === 'accounts';
  return (
    <Page title="Your account" actions={accounts && <SignOut />}>
      <Card title="You">
        <dl className={styles.facts}>
          <dt>Name</dt>
          <dd>{session.principal.name}</dd>
          <dt>Role</dt>
          <dd>{session.principal.role}</dd>
        </dl>
        {!accounts && (
          <p className={styles.note}>
            Everyone is an admin on this server, so there is no account to sign in to.
          </p>
        )}
      </Card>
      {accounts && <ChangePassword />}
    </Page>
  );
}
