import type { Principal } from '@quanthea/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { Dialog } from '../../ui/dialog.tsx';
import { Popover } from '../../ui/popover.tsx';
import styles from './account.module.css';
import { ChangePasswordForm, ProvidersForm } from './account-forms.tsx';
import type { AccountIdentities } from './data.ts';
import { useAccountForm } from './use-account-form.ts';

/** A dialog the menu opens. */
type AccountDialog = 'password' | 'providers' | null;

/**
 * One entry of the menu.
 *
 * @param props - What it says and does.
 * @param props.children - What it says.
 * @param props.onClick - What it does.
 * @param props.disabled - Whether it is off.
 * @returns The entry.
 */
function MenuItem({
  children,
  onClick,
  disabled = false,
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <button type="button" className={styles.menuItem} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * One's providers, loaded once, for the menu's entries and the providers dialog.
 *
 * @returns The providers, once loaded.
 */
function useIdentities(): AccountIdentities | undefined {
  const fetcher = useFetcher<AccountIdentities>();
  useEffect(() => {
    if (fetcher.state === 'idle' && !fetcher.data) void fetcher.load('/account');
  }, [fetcher]);
  return fetcher.data;
}

/**
 * The entries: change the password, the providers, and signing out.
 *
 * @param props - One's providers and the dialog opener.
 * @param props.identities - One's providers, once loaded.
 * @param props.open - Opens a dialog.
 * @returns The entries.
 */
function MenuItems({
  identities,
  open,
}: {
  readonly identities: AccountIdentities | undefined;
  readonly open: (dialog: AccountDialog) => void;
}) {
  const signOut = useAccountForm('/account');
  const hasProviders = (identities?.linked.length ?? 0) + (identities?.available.length ?? 0) > 0;
  return (
    <div className={styles.menuItems}>
      {identities?.hasPassword && (
        <MenuItem onClick={() => open('password')}>Change password</MenuItem>
      )}
      {hasProviders && <MenuItem onClick={() => open('providers')}>Sign-in providers</MenuItem>}
      <MenuItem
        disabled={signOut.busy}
        onClick={() => signOut.submit({ intent: 'sign-out-everywhere' })}
      >
        Sign out everywhere
      </MenuItem>
      <MenuItem disabled={signOut.busy} onClick={() => signOut.submit({ intent: 'sign-out' })}>
        Sign out
      </MenuItem>
    </div>
  );
}

/** Props of {@link AccountMenu}. */
interface AccountMenuProps {
  /** Who is signed in. */
  readonly principal: Principal;
  /** What the menu's button shows. */
  readonly trigger: ReactNode;
  /** The button's class, a navigation rail link's. */
  readonly triggerClassName: string;
}

/**
 * The account menu behind the user icon: who is signed in, changing the password and the
 * providers in dialogs, and signing out.
 *
 * @param props - Who is signed in, and the button.
 * @returns The menu and its dialogs.
 */
export function AccountMenu({ principal, trigger, triggerClassName }: AccountMenuProps) {
  const identities = useIdentities();
  const [dialog, setDialog] = useState<AccountDialog>(null);
  const close = () => setDialog(null);
  return (
    <>
      <Popover
        label="Your account"
        trigger={trigger}
        triggerClassName={triggerClassName}
        placement="side"
      >
        <div className={styles.menu}>
          <div className={styles.who}>
            <strong>{principal.name}</strong>
            <span className={styles.note}>{principal.role}</span>
          </div>
          <MenuItems identities={identities} open={setDialog} />
        </div>
      </Popover>
      <Dialog title="Change password" open={dialog === 'password'} onClose={close}>
        <ChangePasswordForm />
      </Dialog>
      <Dialog title="Sign-in providers" open={dialog === 'providers'} onClose={close}>
        {identities && <ProvidersForm identities={identities} />}
      </Dialog>
    </>
  );
}
