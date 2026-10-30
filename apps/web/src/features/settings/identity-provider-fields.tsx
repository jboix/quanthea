/**
 * The fields of a provider reached through an identity provider: the issuer or token URL, the
 * client, the scope and audience the gateway expects, and where the token goes.
 */
import type { ProviderAuth } from '@quanthea/shared';
import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import styles from './model-settings.module.css';
import type { SectionProps } from './model-settings-form.ts';
import { SecretField } from './secret-field.tsx';

/** The settings of a provider reached through an identity provider. */
type IdentityAuth = Extract<ProviderAuth, { type: 'oauth-client-credentials' }>;

/** An identity provider whose issuer has a known shape. */
interface IdentityPreset {
  /** Its name. */
  readonly name: string;
  /** Its issuer, with the parts to replace in capitals. */
  readonly issuer: string;
  /** The scope its gateways usually expect, if any. */
  readonly scope: string;
}

/** The identity providers people often use. */
const identityPresets: readonly IdentityPreset[] = [
  {
    name: 'Entra ID',
    issuer: 'https://login.microsoftonline.com/TENANT-ID/v2.0',
    scope: 'https://cognitiveservices.azure.com/.default',
  },
  { name: 'Okta', issuer: 'https://YOUR-ORG.okta.com/oauth2/default', scope: '' },
  { name: 'Keycloak', issuer: 'https://YOUR-HOST/realms/YOUR-REALM', scope: '' },
];

/** A part of a preset's issuer still to replace, such as `TENANT-ID`. */
const placeholderPart = /\b[A-Z]+(?:-[A-Z]+)+\b/;

/**
 * The host of a URL.
 *
 * @param url - The URL, if any.
 * @param fallback - What to show without one.
 * @returns The host, or the fallback.
 */
function hostOf(url: string | null, fallback: string): string {
  return url !== null && URL.canParse(url) ? new URL(url).host : fallback;
}

/**
 * A URL field's value as the settings keep it: `null` when empty.
 *
 * @param value - The text typed.
 * @returns The URL, or `null`.
 */
function urlOrNull(value: string): string | null {
  return value.trim() === '' ? null : value;
}

/**
 * Where the token goes: quanthea asks the identity provider, then calls the gateway with it.
 *
 * @param props - The issuer or token URL, and the gateway's base URL.
 * @param props.auth - The identity provider settings.
 * @param props.baseUrl - The gateway's base URL.
 * @returns The strip.
 */
function TokenPath({
  auth,
  baseUrl,
}: {
  readonly auth: IdentityAuth;
  readonly baseUrl: string | null;
}) {
  const issuer = hostOf(auth.tokenUrl ?? auth.issuer, 'your identity provider');
  return (
    <p className={styles.tokenPath}>
      <span className={styles.pathOwn}>quanthea</span>
      <span className={styles.pathStep}>client ID and secret →</span>
      <span className={styles.pathHost}>{issuer}</span>
      <span className={styles.pathStep}>token, renewed before it expires →</span>
      <span className={styles.pathHost}>{hostOf(baseUrl, 'your gateway')}</span>
    </p>
  );
}

/** Props of a section of the identity provider's fields. */
interface IdentityProps extends SectionProps {
  /** The identity provider settings. */
  readonly auth: IdentityAuth;
}

/**
 * Changes some identity provider settings.
 *
 * @param props - The form and the settings.
 * @returns The setter.
 */
function setterOf({ form, auth }: IdentityProps) {
  return (change: Partial<IdentityAuth>) => form.set('auth', { ...auth, ...change });
}

/**
 * The buttons that fill in a known identity provider's issuer and scope.
 *
 * @param props - The form and the settings.
 * @returns The buttons.
 */
function IdentityPresets(props: IdentityProps) {
  const set = setterOf(props);
  return (
    <div className={styles.presets}>
      <span className={styles.presetsLabel}>Fill in for</span>
      {identityPresets.map((preset) => (
        <Button
          key={preset.name}
          size="small"
          onClick={() => set({ issuer: preset.issuer, tokenUrl: null, scope: preset.scope })}
        >
          {preset.name}
        </Button>
      ))}
    </div>
  );
}

/**
 * The token URL, for an issuer without a discovery document: a button until it is asked for.
 *
 * @param props - The form, the settings and the issues.
 * @returns The field or the button.
 */
function TokenUrlField(props: IdentityProps) {
  const { auth, issues } = props;
  const [shown, setShown] = useState(auth.tokenUrl !== null);
  const set = setterOf(props);
  if (!shown)
    return (
      <div>
        <Button size="small" onClick={() => setShown(true)}>
          Give a token URL instead
        </Button>
      </div>
    );
  return (
    <Input
      label="Token URL"
      mono
      autoComplete="off"
      placeholder="For an issuer without a discovery document"
      value={auth.tokenUrl ?? ''}
      onChange={(event) => set({ tokenUrl: urlOrNull(event.target.value) })}
      error={issues['auth.tokenUrl']}
    />
  );
}

/**
 * The issuer.
 *
 * @param props - The form, the settings and the issues.
 * @returns The field.
 */
function IssuerField(props: IdentityProps) {
  const { auth, issues } = props;
  const set = setterOf(props);
  return (
    <Input
      label="Issuer"
      mono
      autoComplete="off"
      placeholder="https://login.example.com/realms/acme"
      value={auth.issuer ?? ''}
      onChange={(event) => set({ issuer: urlOrNull(event.target.value) })}
      hint={
        placeholderPart.test(auth.issuer ?? '')
          ? 'Replace the words in capitals with your own.'
          : 'quanthea finds the token URL from the issuer’s discovery document.'
      }
      error={issues['auth.issuer']}
    />
  );
}

/**
 * The scope and the audience the gateway expects in a token.
 *
 * @param props - The form and the settings.
 * @returns The fields.
 */
function ClaimFields(props: IdentityProps) {
  const { auth } = props;
  const set = setterOf(props);
  return (
    <>
      <Input
        label="Scope"
        mono
        autoComplete="off"
        placeholder="None"
        value={auth.scope}
        onChange={(event) => set({ scope: event.target.value })}
      />
      <Input
        label="Audience"
        mono
        autoComplete="off"
        placeholder="If your identity provider asks for one"
        value={auth.audience}
        onChange={(event) => set({ audience: event.target.value })}
      />
    </>
  );
}

/**
 * The fields of a provider reached through an identity provider.
 *
 * @param props - The form, the stored client secret and the issues.
 * @param props.stored - The stored client secret, masked, or `null`.
 * @returns The fields.
 */
export function IdentityProviderFields({
  form,
  stored,
  issues,
}: SectionProps & { readonly stored: string | null }) {
  const auth = form.selected?.auth;
  if (auth?.type !== 'oauth-client-credentials') return null;
  const props = { form, auth, issues };
  return (
    <div className={styles.identity}>
      <IdentityPresets {...props} />
      <IssuerField {...props} />
      <TokenUrlField {...props} />
      <div className={styles.pair}>
        <Input
          label="Client ID"
          mono
          autoComplete="off"
          value={auth.clientId}
          onChange={(event) => setterOf(props)({ clientId: event.target.value })}
          error={issues['auth.clientId']}
        />
        <SecretField
          key={form.selected?.id}
          {...props}
          stored={stored}
          label="Client secret"
          placeholder="Paste the secret"
        />
        <ClaimFields {...props} />
      </div>
      <TokenPath auth={auth} baseUrl={form.settings.baseUrl} />
    </div>
  );
}
