/**
 * The list of saved providers, each with how it connects: pick one to edit, add one, remove one,
 * choose the default.
 */
import type { ModelProvider, ProviderConfig } from '@quanthea/shared';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import styles from './model-settings.module.css';
import type { Form } from './model-settings-form.ts';

/** How each vendor reads. */
const vendorNames: Readonly<Record<ModelProvider, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  mistral: 'Mistral',
  'openai-compatible': 'OpenAI-compatible',
};

/**
 * The words under a provider's name: its vendor and its build model.
 *
 * @param config - The provider.
 * @returns Such as `Mistral · mistral-large-latest`.
 */
function metaOf(config: ProviderConfig): string {
  return `${vendorNames[config.provider]} · ${config.models.build || 'no build model'}`;
}

/**
 * The name of the identity provider an issuer belongs to.
 *
 * @param url - The issuer or token URL, if any.
 * @returns Such as `Entra ID`.
 */
function identityName(url: string | null): string {
  if (url === null || !URL.canParse(url)) return 'Identity provider';
  const { host, pathname } = new URL(url);
  if (host.endsWith('microsoftonline.com')) return 'Entra ID';
  if (host.includes('okta')) return 'Okta';
  return pathname.includes('/realms/') ? 'Keycloak' : 'Identity provider';
}

/**
 * How a provider connects, for the chip beside it.
 *
 * @param config - The provider.
 * @param hasSecret - Whether a key or client secret is stored or typed.
 * @returns The words and the tone.
 */
function connectionOf(config: ProviderConfig, hasSecret: boolean) {
  const { auth } = config;
  if (auth.type === 'oauth-client-credentials')
    return hasSecret
      ? { label: `${identityName(auth.tokenUrl ?? auth.issuer)} token`, tone: 'token' }
      : { label: 'No client secret yet', tone: 'missing' };
  if (hasSecret) return { label: 'API key', tone: 'key' };
  // An OpenAI-compatible gateway, such as Ollama, may need no key.
  return config.provider === 'openai-compatible'
    ? { label: 'No key', tone: 'key' }
    : { label: 'No key yet', tone: 'missing' };
}

/**
 * The chip that says how a provider connects.
 *
 * @param props - The provider and whether it has a secret.
 * @param props.config - The provider.
 * @param props.hasSecret - Whether a key or client secret is stored or typed.
 * @returns The chip.
 */
function ConnectionChip({
  config,
  hasSecret,
}: {
  readonly config: ProviderConfig;
  readonly hasSecret: boolean;
}) {
  const { label, tone } = connectionOf(config, hasSecret);
  return (
    <span className={styles.connectChip} data-tone={tone}>
      {label}
    </span>
  );
}

/** Props of {@link ProviderRow}. */
interface ProviderRowProps {
  /** The form state. */
  readonly form: Form;
  /** The provider. */
  readonly config: ProviderConfig;
  /** Whether a key or client secret is stored or typed for it. */
  readonly hasSecret: boolean;
}

/**
 * One saved provider: pick it to edit, see how it connects, make it the default or remove it.
 *
 * @param props - The form, the provider and whether it has a secret.
 * @returns The row.
 */
function ProviderRow({ form, config, hasSecret }: ProviderRowProps) {
  const { gateway } = form;
  return (
    <li className={styles.providerRow} data-selected={config.id === form.selected?.id}>
      <button type="button" className={styles.providerPick} onClick={() => form.select(config.id)}>
        <span className={styles.providerName}>{config.name}</span>
        <span className={styles.providerMeta}>{metaOf(config)}</span>
      </button>
      <ConnectionChip config={config} hasSecret={hasSecret} />
      {config.id === gateway.defaultProviderId ? (
        <span className={styles.defaultBadge}>Default</span>
      ) : (
        <Button size="small" onClick={() => form.makeDefault(config.id)}>
          Make default
        </Button>
      )}
      {gateway.providers.length > 1 && (
        <Button size="small" onClick={() => form.removeProvider(config.id)}>
          Remove
        </Button>
      )}
    </li>
  );
}

/**
 * The saved providers.
 *
 * @param props - The form and the stored secrets.
 * @param props.form - The form state.
 * @param props.keys - Each provider's stored key or client secret, masked, or `null`.
 * @returns The card.
 */
export function ProvidersCard({
  form,
  keys,
}: {
  readonly form: Form;
  readonly keys: Readonly<Record<string, string | null>>;
}) {
  return (
    <Card
      title="Providers"
      description="Threads use the default unless they are started on another."
      actions={
        <Button size="small" onClick={form.addProvider}>
          Add provider
        </Button>
      }
    >
      <ul className={styles.providers}>
        {form.gateway.providers.map((config) => (
          <ProviderRow
            key={config.id}
            form={form}
            config={config}
            hasSecret={Boolean(keys[config.id]) || form.apiKeys[config.id] !== undefined}
          />
        ))}
      </ul>
    </Card>
  );
}
