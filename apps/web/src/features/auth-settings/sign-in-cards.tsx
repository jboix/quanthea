/** The ways to sign in: the providers, each tested before it is turned on, and passwords. */
import {
  dayMonthYear,
  type IdentityProvidersView,
  type IdentityProviderView,
  type ManagedSettings,
  providerFlowFailure,
  providerStartPath,
} from '@quanthea/shared';
import { useCallback, useState } from 'react';
import { type SubmitTarget, useFetcher, useRouteLoaderData, useSearchParams } from 'react-router';
import { Button, buttonClassName } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Pill } from '../../ui/pill.tsx';
import { Switch } from '../../ui/switch.tsx';
import styles from './auth-settings.module.css';
import type { AuthSettingsOutcome, ProviderIntent } from './data.ts';
import { kindNames, ProviderForm } from './provider-form.tsx';

/**
 * Submits provider intents; the loader runs again after each.
 *
 * @returns The submit function, whether one is on its way, and the refusal, if any.
 */
function useProviderIntent() {
  const fetcher = useFetcher<AuthSettingsOutcome>();
  const submit = (intent: ProviderIntent) =>
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  const refusal = fetcher.data?.ok === false ? fetcher.data.message : undefined;
  return { submit, busy: fetcher.state !== 'idle', refusal };
}

/**
 * The words under a provider's name: its kind, who may join, and its last test.
 *
 * @param provider - The provider.
 * @returns Such as `GitHub · invited people only · tested 3 May 2026`.
 */
function metaOf(provider: IdentityProviderView): string {
  const { mode, values } = provider.join;
  const joins: Record<typeof mode, string> = {
    invite: 'invited people only',
    tenant: 'everyone in the tenant',
    domain: `anyone at ${values.join(', ')}`,
    organisation: `members of ${values.join(', ')}`,
    group: `members of ${values.join(', ')}`,
  };
  const tested = provider.testedAt ? `tested ${dayMonthYear(provider.testedAt)}` : 'not tested';
  const credentials = provider.hasCredentials ? '' : 'no client';
  return [kindNames[provider.kind], joins[mode], tested, credentials].filter(Boolean).join(' · ');
}

/**
 * Removing a provider, in two clicks: it unlinks everyone who signs in through it.
 *
 * @param props - What removing does.
 * @param props.onRemove - Removes the provider.
 * @param props.busy - Whether a change is on its way.
 * @returns The button.
 */
function RemoveButton({
  onRemove,
  busy,
}: {
  readonly onRemove: () => void;
  readonly busy: boolean;
}) {
  const [asked, setAsked] = useState(false);
  if (!asked)
    return (
      <Button size="small" disabled={busy} onClick={() => setAsked(true)}>
        Remove
      </Button>
    );
  return (
    <Button size="small" variant="danger" disabled={busy} onClick={onRemove}>
      Remove and unlink everyone
    </Button>
  );
}

/** Props of {@link ProviderActions}. */
interface ProviderActionsProps {
  /** The provider. */
  readonly provider: IdentityProviderView;
  /** Whether the server has a public URL, which a test sign-in needs. */
  readonly reachable: boolean;
  /** Opens the form. */
  readonly onEdit: () => void;
}

/**
 * Turning a provider on or off, and removing it.
 *
 * @param props - The provider.
 * @param props.provider - The provider.
 * @returns The buttons, and a refusal, if any.
 */
function ChangeButtons({ provider }: { readonly provider: IdentityProviderView }) {
  const { submit, busy, refusal } = useProviderIntent();
  const providerId = provider.id;
  const toggle = () =>
    submit({ intent: 'enable-provider', providerId, enabled: !provider.enabled });
  return (
    <>
      <Button
        size="small"
        disabled={busy || (!provider.enabled && provider.testedAt === null)}
        title={provider.testedAt === null ? 'A test sign-in must succeed first.' : undefined}
        onClick={toggle}
      >
        {provider.enabled ? 'Turn off' : 'Turn on'}
      </Button>
      <RemoveButton
        busy={busy}
        onRemove={() => submit({ intent: 'remove-provider', providerId })}
      />
      {refusal && <p className={styles.error}>{refusal}</p>}
    </>
  );
}

/**
 * What an admin can do with a provider: edit it, test it, turn it on or off, remove it. A
 * provider the configuration file manages can only be tested.
 *
 * @param props - The provider, whether it can be tested, and the edit handler.
 * @returns The buttons.
 */
function ProviderActions({ provider, reachable, onEdit }: ProviderActionsProps) {
  const editable = !provider.managedBy;
  return (
    <div className={styles.actions}>
      {editable && (
        <Button size="small" onClick={onEdit}>
          Edit
        </Button>
      )}
      {provider.hasCredentials && reachable && (
        <a
          className={buttonClassName('secondary', 'small')}
          href={providerStartPath(provider.id, 'test', '/settings/auth')}
        >
          Test sign-in
        </a>
      )}
      {editable && <ChangeButtons provider={provider} />}
    </div>
  );
}

/**
 * What a provider flow reported on its way back: a test that succeeded, or why one failed.
 *
 * @param props - The providers, for their names.
 * @param props.providers - The providers.
 * @returns The note, or nothing.
 */
function FlowReport({ providers }: { readonly providers: readonly IdentityProviderView[] }) {
  const [params] = useSearchParams();
  const tested = providers.find((provider) => provider.id === params.get('tested'));
  const failure = providerFlowFailure(params.get('error'));
  if (tested)
    return (
      <p className={styles.done} role="status">
        The test sign-in with {tested.name} succeeded. You can turn it on.
      </p>
    );
  if (!failure) return null;
  return (
    <p className={styles.error} role="alert">
      The test sign-in failed. {failure}
    </p>
  );
}

/**
 * One provider: its name, state and actions, or its form while it is edited.
 *
 * @param props - The provider, the settings, and the editing state.
 * @param props.provider - The provider.
 * @param props.signIn - The sign-in settings.
 * @param props.editing - Whether its form is open.
 * @param props.onEdit - Opens or closes its form.
 * @returns The list item.
 */
function ProviderRow({
  provider,
  signIn,
  editing,
  onEdit,
}: {
  readonly provider: IdentityProviderView;
  readonly signIn: IdentityProvidersView;
  readonly editing: boolean;
  readonly onEdit: (open: boolean) => void;
}) {
  const close = useCallback(() => onEdit(false), [onEdit]);
  if (editing)
    return (
      <li className={styles.provider}>
        <ProviderForm
          provider={provider}
          takenIds={[]}
          publicUrl={signIn.publicUrl}
          onClose={close}
        />
      </li>
    );
  return (
    <li className={styles.provider}>
      <div className={styles.providerHead}>
        <span className={styles.providerName}>{provider.name}</span>
        <Pill tone={provider.enabled ? 'ok' : 'neutral'}>{provider.enabled ? 'on' : 'off'}</Pill>
        {provider.managedBy && (
          <span title={provider.managedBy}>
            <Pill tone="accent">from file</Pill>
          </span>
        )}
      </div>
      <span className={styles.note}>{metaOf(provider)}</span>
      <ProviderActions
        provider={provider}
        reachable={signIn.publicUrl !== null}
        onEdit={() => onEdit(true)}
      />
    </li>
  );
}

/** Props of {@link ProviderList}. */
interface ProviderListProps {
  /** The sign-in settings. */
  readonly signIn: IdentityProvidersView;
  /** The provider whose form is open, `''` for a new one, or `null`. */
  readonly editing: string | null;
  /** Opens a form, or closes it with `null`. */
  readonly setEditing: (editing: string | null) => void;
}

/**
 * The providers, and the form of a new one while it is added.
 *
 * @param props - The settings and the editing state.
 * @returns The list.
 */
function ProviderList({ signIn, editing, setEditing }: ProviderListProps) {
  const closeNew = useCallback(() => setEditing(null), [setEditing]);
  const takenIds = signIn.providers.map((provider) => provider.id);
  return (
    <ul className={styles.providers}>
      {signIn.providers.map((provider) => (
        <ProviderRow
          key={provider.id}
          provider={provider}
          signIn={signIn}
          editing={editing === provider.id}
          onEdit={(open) => setEditing(open ? provider.id : null)}
        />
      ))}
      {editing === '' && (
        <li className={styles.provider}>
          <ProviderForm
            provider={undefined}
            takenIds={takenIds}
            publicUrl={signIn.publicUrl}
            onClose={closeNew}
          />
        </li>
      )}
    </ul>
  );
}

/**
 * The providers: each one, and a form to add another.
 *
 * @param props - The sign-in settings.
 * @param props.signIn - The sign-in settings.
 * @returns The card.
 */
export function ProvidersCard({ signIn }: { readonly signIn: IdentityProvidersView }) {
  const [editing, setEditing] = useState<string | null>(null);
  const adding = editing === '';
  return (
    <Card
      title="Sign-in providers"
      description="A provider stays off until a test sign-in with it succeeds."
      actions={
        <Button size="small" disabled={adding} onClick={() => setEditing('')}>
          Add provider
        </Button>
      }
    >
      <FlowReport providers={signIn.providers} />
      {signIn.providers.length === 0 && !adding && (
        <p className={styles.note}>None yet. People sign in with a password.</p>
      )}
      <ProviderList signIn={signIn} editing={editing} setEditing={setEditing} />
    </Card>
  );
}

/**
 * Password sign-in: on by default, off once an admin can sign in through a provider.
 *
 * @param props - The sign-in settings.
 * @param props.signIn - The sign-in settings.
 * @returns The card.
 */
export function PasswordCard({ signIn }: { readonly signIn: IdentityProvidersView }) {
  const { submit, busy, refusal } = useProviderIntent();
  const managedBy = (useRouteLoaderData('settings') as ManagedSettings | undefined)?.sections[
    'password-sign-in'
  ];
  return (
    <Card title="Passwords">
      <Switch
        label="Password sign-in"
        description="Off, people sign in through a provider only. Invited people join with the email they were invited at."
        checked={signIn.passwordSignIn}
        disabled={busy || managedBy !== undefined}
        onChange={(enabled) => submit({ intent: 'password-sign-in', enabled })}
      />
      {managedBy && (
        <p className={styles.note} title={managedBy}>
          {managedBy.split('/').at(-1)} sets this.
        </p>
      )}
      {refusal && <p className={styles.error}>{refusal}</p>}
    </Card>
  );
}
