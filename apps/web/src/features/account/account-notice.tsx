import { providerFlowFailure } from '@quanthea/shared';
import { useSearchParams } from 'react-router';
import { Banner } from '../../ui/banner.tsx';
import { InfoIcon, WarningIcon } from '../../ui/icons.tsx';

/** What each account change says once it is done. */
const doneMessages: Readonly<Record<string, string>> = {
  'password-changed': 'Your password is changed. Other sessions are signed out.',
  unlinked: 'The provider is unlinked.',
  linked: 'The provider is linked. You can sign in with it now.',
};

/**
 * What an account change reported on its way back to a page: a changed password, a provider
 * linked or unlinked, or why linking failed. Dismissing it clears the address.
 *
 * @returns The banner, or nothing.
 */
export function AccountNotice() {
  const [params, setParams] = useSearchParams();
  const failure = providerFlowFailure(params.get('account-error'));
  const done = doneMessages[params.get('account') ?? ''];
  if (!failure && !done) return null;
  const dismiss = () => {
    const next = new URLSearchParams(params);
    next.delete('account');
    next.delete('account-error');
    setParams(next, { replace: true });
  };
  return (
    <Banner
      tone={failure ? 'warning' : 'info'}
      icon={failure ? <WarningIcon /> : <InfoIcon />}
      onDismiss={dismiss}
    >
      {failure ?? done}
    </Banner>
  );
}
