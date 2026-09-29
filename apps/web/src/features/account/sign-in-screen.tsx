import {
  type EndpointOutput,
  providerFlowFailure,
  providerStartPath,
  type signInOptionsEndpoint,
} from '@querent/shared';
import { type FormEvent, useState } from 'react';
import { useLoaderData, useSearchParams } from 'react-router';
import { Logo } from '../../ui/brand.tsx';
import { Button, buttonClassName } from '../../ui/button.tsx';
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
        autoComplete="username"
        autoCapitalize="none"
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

/** The ways to sign in, as the page loads them. */
type SignInOptions = EndpointOutput<typeof signInOptionsEndpoint>;

/**
 * A button per provider that is on, each a full-page link to the provider.
 *
 * @param props - The providers.
 * @param props.providers - The providers that are on.
 * @returns The buttons, or nothing.
 */
function ProviderButtons({ providers }: { readonly providers: SignInOptions['providers'] }) {
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/';
  if (providers.length === 0) return null;
  return (
    <div className={styles.providers}>
      {providers.map((provider) => (
        <a
          key={provider.id}
          className={buttonClassName('secondary', 'large')}
          href={providerStartPath(provider.id, 'sign-in', next)}
        >
          Continue with {provider.name}
        </a>
      ))}
    </div>
  );
}

/**
 * Why a provider sign-in failed, from the page's `error` parameter.
 *
 * @returns The message, or nothing.
 */
function FlowFailure() {
  const [params] = useSearchParams();
  const failure = providerFlowFailure(params.get('error'));
  if (!failure) return null;
  return (
    <p className={styles.error} role="alert">
      {failure}
    </p>
  );
}

/**
 * The sign-in page: a button per provider, then the password form while passwords are on.
 *
 * @returns The page.
 */
export function SignInScreen() {
  const options = useLoaderData() as SignInOptions | null;
  const passwords = options?.passwordSignIn !== false;
  const providers = options?.providers ?? [];
  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        <Logo height={40} />
        <Card title="Sign in to querent">
          <div className={styles.form}>
            <FlowFailure />
            <ProviderButtons providers={providers} />
            {passwords && providers.length > 0 && <p className={styles.or}>or</p>}
            {passwords && <SignInForm />}
          </div>
        </Card>
        <p className={styles.note}>No account? Ask an admin for an invite link.</p>
      </div>
    </div>
  );
}
