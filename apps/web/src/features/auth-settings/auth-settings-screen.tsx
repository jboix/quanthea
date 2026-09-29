import { useLoaderData } from 'react-router';
import { Page } from '../../ui/page.tsx';
import type { AuthSettingsData } from './data.ts';
import { PasswordCard, ProvidersCard } from './sign-in-cards.tsx';

/**
 * Settings → Authentication: the sign-in providers, and password sign-in.
 *
 * @returns The screen.
 */
export function AuthSettingsScreen() {
  const { signIn } = useLoaderData() as AuthSettingsData;
  return (
    <Page title="Authentication" subtitle="Choose how people sign in.">
      <ProvidersCard signIn={signIn} />
      <PasswordCard signIn={signIn} />
    </Page>
  );
}
