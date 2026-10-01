/** The forms of the account menu's dialogs: changing the password, and linking providers. */
import { providerStartPath } from '@quanthea/shared';
import { type FormEvent, useState } from 'react';
import { useLocation } from 'react-router';
import { Button, buttonClassName } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import styles from './account.module.css';
import type { AccountIdentities } from './data.ts';
import { FormRefusal, NewPasswordFields, useNewPassword } from './new-password.tsx';
import { useAccountForm } from './use-account-form.ts';

/**
 * Changing the password: the current one, then the new one twice. It signs out every other
 * session, and brings back to the page it was opened on.
 *
 * @returns The form.
 */
export function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const state = useNewPassword();
  const back = useLocation().pathname;
  const form = useAccountForm('/account');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!state.mismatch)
      form.submit({ intent: 'change-password', current, password: state.password, back });
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <p className={styles.note}>Changing it signs you out everywhere else.</p>
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
      <Button type="submit" variant="primary" disabled={form.busy || Boolean(state.mismatch)}>
        Change password
      </Button>
    </form>
  );
}

/**
 * The providers one signs in with, to unlink, and those one may link.
 *
 * @param props - One's providers.
 * @param props.identities - One's providers.
 * @returns The list.
 */
export function ProvidersForm({ identities }: { readonly identities: AccountIdentities }) {
  const form = useAccountForm('/account');
  const back = useLocation().pathname;
  const linkedIds = new Set(identities.linked.map((each) => each.providerId));
  const linkable = identities.available.filter((provider) => !linkedIds.has(provider.id));
  const last = identities.linked.length === 1 && !identities.hasPassword;
  return (
    <div className={styles.form}>
      <p className={styles.note}>Sign in with any of them, as the same person.</p>
      <ul className={styles.linked}>
        {identities.linked.map((each) => (
          <li key={each.providerId}>
            <span>{each.name}</span>
            <Button
              size="small"
              disabled={form.busy || last}
              title={last ? 'Your only way to sign in.' : undefined}
              onClick={() => form.submit({ intent: 'unlink', providerId: each.providerId, back })}
            >
              Unlink
            </Button>
          </li>
        ))}
      </ul>
      <FormRefusal refusal={form.refusal} />
      <div className={styles.buttons}>
        {linkable.map((provider) => (
          <a
            key={provider.id}
            className={buttonClassName('secondary', 'small')}
            href={providerStartPath(provider.id, 'link', back)}
          >
            {`Link ${provider.name}`}
          </a>
        ))}
      </div>
    </div>
  );
}
