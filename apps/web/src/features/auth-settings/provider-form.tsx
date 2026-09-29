/** The form of one sign-in provider: its kind, name, where it is, who may join, and its client. */
import {
  type IdentityProviderView,
  type JoinPolicy,
  type ProviderKind,
  providerCallbackPath,
} from '@querent/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { Select } from '../../ui/select.tsx';
import styles from './auth-settings.module.css';
import type { AuthSettingsIntent, AuthSettingsOutcome, ProviderBody } from './data.ts';

/** How each kind reads. */
export const kindNames: Readonly<Record<ProviderKind, string>> = {
  github: 'GitHub',
  google: 'Google',
  gitlab: 'GitLab',
  entra: 'Microsoft Entra ID',
};

/** A join mode. */
type JoinMode = JoinPolicy['mode'];

/** Who may join without an invite, as each kind can check it. */
const joinChoices: Readonly<Record<ProviderKind, readonly { value: JoinMode; label: string }[]>> = {
  github: [
    { value: 'invite', label: 'Invited people only' },
    { value: 'organisation', label: 'Members of a GitHub organisation' },
  ],
  google: [
    { value: 'invite', label: 'Invited people only' },
    { value: 'domain', label: 'Google Workspace accounts of a domain' },
  ],
  gitlab: [
    { value: 'invite', label: 'Invited people only' },
    { value: 'domain', label: 'Verified emails at a domain' },
    { value: 'group', label: 'Members of a GitLab group' },
  ],
  entra: [
    { value: 'invite', label: 'Invited people only' },
    { value: 'tenant', label: 'Everyone in the tenant' },
  ],
};

/** The field that names who may join, for the modes that need names. */
const joinValueFields: Partial<Record<JoinMode, { label: string; placeholder: string }>> = {
  domain: { label: 'Domains', placeholder: 'example.com, example.org' },
  organisation: { label: 'Organisations', placeholder: 'acme' },
  group: { label: 'Groups, with their subgroups', placeholder: 'acme/platform' },
};

/** Where an admin registers querent with each kind. */
const registerHints: Readonly<Record<ProviderKind, string>> = {
  github: 'Register an OAuth app in GitHub, under Settings → Developer settings.',
  google: 'Create an OAuth client of type “Web application” in the Google Cloud console.',
  gitlab:
    'Add an application with the openid, email and profile scopes, then keep it confidential.',
  entra: 'Register an app in Entra ID with a Web redirect URI, then add a client secret.',
};

/** The form's fields, as typed. */
interface ProviderDraft {
  /** The kind. */
  readonly kind: ProviderKind;
  /** The name on the sign-in button. */
  readonly name: string;
  /** GitLab only: a self-managed GitLab's address. */
  readonly baseUrl: string;
  /** Entra only: the tenant. */
  readonly tenant: string;
  /** Who may join without an invite. */
  readonly mode: JoinMode;
  /** The domains, organisations or groups, comma separated. */
  readonly values: string;
  /** A new client id, or empty to keep the saved one. */
  readonly clientId: string;
  /** A new client secret, or empty to keep the saved one. */
  readonly clientSecret: string;
}

/**
 * The fields of a saved provider, or of a new GitHub one.
 *
 * @param provider - The saved provider, if any.
 * @returns The fields.
 */
function draftOf(provider: IdentityProviderView | undefined): ProviderDraft {
  const kind = provider?.kind ?? 'github';
  return {
    kind,
    name: provider?.name ?? kindNames[kind],
    baseUrl: provider?.baseUrl ?? '',
    tenant: provider?.tenant ?? '',
    mode: provider?.join.mode ?? 'invite',
    values: provider?.join.values.join(', ') ?? '',
    clientId: '',
    clientSecret: '',
  };
}

/**
 * What the form sends: the credentials only when typed.
 *
 * @param draft - The fields.
 * @returns The body.
 */
function bodyOf(draft: ProviderDraft): ProviderBody {
  const values = draft.values
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    kind: draft.kind,
    name: draft.name,
    baseUrl: draft.kind === 'gitlab' && draft.baseUrl ? draft.baseUrl : null,
    tenant: draft.kind === 'entra' ? draft.tenant : null,
    join: { mode: draft.mode, values },
    ...(draft.clientId ? { clientId: draft.clientId } : {}),
    ...(draft.clientSecret ? { clientSecret: draft.clientSecret } : {}),
  };
}

/**
 * The id of a new provider: its kind, then `kind-2` and so on when taken.
 *
 * @param kind - The kind.
 * @param taken - The ids in use.
 * @returns The id.
 */
function newIdFor(kind: ProviderKind, taken: readonly string[]): string {
  let id: string = kind;
  for (let count = 2; taken.includes(id); count += 1) id = `${kind}-${count}`;
  return id;
}

/** Props of the parts of the form. */
interface DraftProps {
  /** The fields. */
  readonly draft: ProviderDraft;
  /** Changes some fields. */
  readonly change: (fields: Partial<ProviderDraft>) => void;
}

/**
 * The kind and the name. The kind is fixed once saved, since identities belong to it.
 *
 * @param props - The fields, and whether the provider is saved.
 * @param props.saved - Whether the provider is saved.
 * @returns The fields.
 */
function KindAndName({ draft, change, saved }: DraftProps & { readonly saved: boolean }) {
  const chooseKind = (kind: ProviderKind) =>
    change({ kind, name: kindNames[kind], mode: 'invite', values: '' });
  return (
    <div className={styles.pair}>
      <Select
        label="Provider"
        disabled={saved}
        options={Object.entries(kindNames).map(([value, label]) => ({ value, label }))}
        value={draft.kind}
        onChange={(event) => chooseKind(event.target.value as ProviderKind)}
      />
      <Input
        label="Name on the button"
        required
        maxLength={60}
        value={draft.name}
        onChange={(event) => change({ name: event.target.value })}
      />
    </div>
  );
}

/**
 * Where the provider is: a self-managed GitLab's address, or the Entra tenant.
 *
 * @param props - The fields.
 * @returns The field, or nothing for GitHub and Google.
 */
function WhereField({ draft, change }: DraftProps) {
  if (draft.kind === 'gitlab')
    return (
      <Input
        label="GitLab address"
        mono
        placeholder="https://gitlab.com"
        hint="Leave empty for gitlab.com."
        value={draft.baseUrl}
        onChange={(event) => change({ baseUrl: event.target.value })}
      />
    );
  if (draft.kind !== 'entra') return null;
  return (
    <Input
      label="Tenant"
      mono
      required
      placeholder="contoso.onmicrosoft.com"
      hint="Its id or its domain. One tenant only."
      value={draft.tenant}
      onChange={(event) => change({ tenant: event.target.value })}
    />
  );
}

/**
 * Who may join without an invite. People who join start as viewers.
 *
 * @param props - The fields.
 * @returns The fields.
 */
function JoinFields({ draft, change }: DraftProps) {
  const valueField = joinValueFields[draft.mode];
  return (
    <div className={styles.pair}>
      <Select
        label="Who may join"
        hint="Invited people keep their role. Others join as viewers."
        options={joinChoices[draft.kind]}
        value={draft.mode}
        onChange={(event) => change({ mode: event.target.value as JoinMode })}
      />
      {valueField && (
        <Input
          label={valueField.label}
          required
          placeholder={valueField.placeholder}
          value={draft.values}
          onChange={(event) => change({ values: event.target.value })}
        />
      )}
    </div>
  );
}

/**
 * The client id and secret. They are never shown again once saved.
 *
 * @param props - The fields, and whether credentials are saved.
 * @param props.saved - Whether a client id and secret are saved.
 * @returns The fields.
 */
function ClientFields({ draft, change, saved }: DraftProps & { readonly saved: boolean }) {
  const placeholder = saved ? 'Saved. Type to replace.' : undefined;
  return (
    <div className={styles.pair}>
      <Input
        label="Client id"
        mono
        autoComplete="off"
        required={!saved}
        placeholder={placeholder}
        value={draft.clientId}
        onChange={(event) => change({ clientId: event.target.value })}
      />
      <Input
        label="Client secret"
        mono
        type="password"
        autoComplete="new-password"
        required={!saved}
        placeholder={placeholder}
        value={draft.clientSecret}
        onChange={(event) => change({ clientSecret: event.target.value })}
      />
    </div>
  );
}

/**
 * The callback URL to register at the provider, or what the server lacks for one.
 *
 * @param props - querent's origin and the provider.
 * @param props.publicUrl - querent's origin, or `null`.
 * @param props.providerId - The provider.
 * @returns The note.
 */
function CallbackNote({
  publicUrl,
  providerId,
}: {
  readonly publicUrl: string | null;
  readonly providerId: string;
}) {
  if (!publicUrl)
    return (
      <p className={styles.problems}>
        Set QUERENT_PUBLIC_URL on the server: providers send people back to it.
      </p>
    );
  return (
    <div className={styles.callback}>
      <span className={styles.note}>Redirect URI to register</span>
      <code className={styles.code}>{`${publicUrl}${providerCallbackPath(providerId)}`}</code>
    </div>
  );
}

/** Props of {@link ProviderForm}. */
interface ProviderFormProps {
  /** The saved provider, or `undefined` for a new one. */
  readonly provider: IdentityProviderView | undefined;
  /** The ids in use, for a new provider's id. */
  readonly takenIds: readonly string[];
  /** querent's origin, or `null` when the server has none. */
  readonly publicUrl: string | null;
  /** Closes the form. */
  readonly onClose: () => void;
}

/**
 * Saves a provider, and closes the form once saved.
 *
 * @param onClose - Closes the form.
 * @returns The save function, whether it is on its way, and the refusal, if any.
 */
function useSaveProvider(onClose: () => void) {
  const fetcher = useFetcher<AuthSettingsOutcome>();
  const outcome = fetcher.data;
  useEffect(() => {
    if (outcome?.ok) onClose();
  }, [outcome, onClose]);
  const save = (intent: AuthSettingsIntent) =>
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  const refusal = outcome?.ok === false ? outcome.message : undefined;
  return { save, busy: fetcher.state !== 'idle', refusal };
}

/**
 * The form of one provider. Changing how it signs people in turns it off until a test sign-in
 * succeeds again.
 *
 * @param props - The provider, the ids in use, the callback URL and the close handler.
 * @returns The form.
 */
export function ProviderForm({ provider, takenIds, publicUrl, onClose }: ProviderFormProps) {
  const [draft, setDraft] = useState(() => draftOf(provider));
  const { save, busy, refusal } = useSaveProvider(onClose);
  const providerId = provider?.id ?? newIdFor(draft.kind, takenIds);
  const change = (fields: Partial<ProviderDraft>) => setDraft({ ...draft, ...fields });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save({ intent: 'save-provider', providerId, body: bodyOf(draft) });
  };
  return (
    <form className={styles.providerForm} onSubmit={submit}>
      <KindAndName draft={draft} change={change} saved={provider !== undefined} />
      <p className={styles.note}>{registerHints[draft.kind]}</p>
      <CallbackNote publicUrl={publicUrl} providerId={providerId} />
      <WhereField draft={draft} change={change} />
      <JoinFields draft={draft} change={change} />
      <ClientFields draft={draft} change={change} saved={provider?.hasCredentials === true} />
      {refusal && <p className={styles.error}>{refusal}</p>}
      <div className={styles.buttons}>
        <Button type="submit" variant="primary" disabled={busy}>
          Save
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}
