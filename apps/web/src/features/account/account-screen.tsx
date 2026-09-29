import { providerFlowFailure, providerStartPath } from '@querent/shared';
import { type FormEvent, useState } from 'react';
import { useLoaderData, useRouteLoaderData, useSearchParams } from 'react-router';
import { Button, buttonClassName } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Input } from '../../ui/input.tsx';
import { Page } from '../../ui/page.tsx';
import styles from './account.module.css';
import type { AccountIdentities } from './data.ts';
import { FormRefusal, NewPasswordFields, useNewPassword } from './new-password.tsx';
import { useAccountForm } from './use-account-form.ts';

/** The session the root route loads. */
interface RootSession {
  /** Who is signed in. */
  readonly principal: { readonly name: string; readonly role: string };
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
 * What a provider flow or an unlink reported on the way back to this page.
 *
 * @param props - The providers, for their names.
 * @param props.identities - One's providers.
 * @returns The note, or nothing.
 */
function ProviderReport({ identities }: { readonly identities: AccountIdentities }) {
  const [params] = useSearchParams();
  const failure = providerFlowFailure(params.get('error'));
  const linked = identities.linked.find((each) => each.providerId === params.get('linked'));
  if (failure)
    return (
      <p className={styles.error} role="alert">
        {failure}
      </p>
    );
  if (!linked && !params.get('unlinked')) return null;
  return <p className={styles.done}>{linked ? `${linked.name} is linked.` : 'Unlinked.'}</p>;
}

/**
 * The providers one signs in with, and those one may link.
 *
 * @param props - One's providers.
 * @param props.identities - One's providers.
 * @returns The card.
 */
function SignInProviders({ identities }: { readonly identities: AccountIdentities }) {
  const form = useAccountForm('/account');
  const linkedIds = new Set(identities.linked.map((each) => each.providerId));
  const linkable = identities.available.filter((provider) => !linkedIds.has(provider.id));
  const last = identities.linked.length === 1 && !identities.hasPassword;
  if (identities.linked.length === 0 && linkable.length === 0) return null;
  return (
    <Card title="Sign-in providers" description="Sign in with any of them, as the same person.">
      <ProviderReport identities={identities} />
      {identities.linked.length > 0 && (
        <ul className={styles.linked}>
          {identities.linked.map((each) => (
            <li key={each.providerId}>
              <span>
                {each.name} · linked {new Date(each.linkedAt).toLocaleDateString()}
              </span>
              <Button
                size="small"
                disabled={form.busy || last}
                title={last ? 'Your only way to sign in.' : undefined}
                onClick={() => form.submit({ intent: 'unlink', providerId: each.providerId })}
              >
                Unlink
              </Button>
            </li>
          ))}
        </ul>
      )}
      <FormRefusal refusal={form.refusal} />
      <div className={styles.buttons}>
        {linkable.map((provider) => (
          <a
            key={provider.id}
            className={buttonClassName('secondary', 'small')}
            href={providerStartPath(provider.id, 'link', '/account')}
          >
            {`Link ${provider.name}`}
          </a>
        ))}
      </div>
    </Card>
  );
}

/**
 * Signing out, here or everywhere.
 *
 * @returns The buttons.
 */
function SignOut() {
  const form = useAccountForm('/account');
  return (
    <div className={styles.buttons}>
      <Button disabled={form.busy} onClick={() => form.submit({ intent: 'sign-out-everywhere' })}>
        Sign out everywhere
      </Button>
      <Button disabled={form.busy} onClick={() => form.submit({ intent: 'sign-out' })}>
        Sign out
      </Button>
    </div>
  );
}

/**
 * The account page: who you are, your providers, your password, and signing out.
 *
 * @returns The page.
 */
export function AccountScreen() {
  const session = useRouteLoaderData('root') as RootSession | undefined;
  const identities = useLoaderData() as AccountIdentities;
  if (!session) return null;
  return (
    <Page title="Your account" actions={<SignOut />}>
      <Card title="You">
        <dl className={styles.facts}>
          <dt>Name</dt>
          <dd>{session.principal.name}</dd>
          <dt>Role</dt>
          <dd>{session.principal.role}</dd>
        </dl>
      </Card>
      <SignInProviders identities={identities} />
      {identities.hasPassword && <ChangePassword />}
    </Page>
  );
}
