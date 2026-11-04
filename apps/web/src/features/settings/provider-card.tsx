/**
 * The card of one provider: its name, the API it speaks, where it is, how quanthea connects to it
 * (a key, or a token from an identity provider) and the connection test.
 */
import { gatewayPresets, type ProviderAuth, suggestedProviderName } from '@quanthea/shared';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Input } from '../../ui/input.tsx';
import { RadioCards } from '../../ui/radio-cards.tsx';
import { ConnectionTest } from './connection-test.tsx';
import { IdentityProviderFields } from './identity-provider-fields.tsx';
import styles from './model-settings.module.css';
import type { SectionProps } from './model-settings-form.ts';
import { SecretField } from './secret-field.tsx';

/** The APIs a provider may speak. */
const providerOptions = [
  { value: 'anthropic' as const, title: 'Anthropic', description: 'Claude models' },
  { value: 'openai' as const, title: 'OpenAI', description: 'GPT models' },
  { value: 'mistral' as const, title: 'Mistral', description: 'Mistral models' },
  {
    value: 'openai-compatible' as const,
    title: 'OpenAI-compatible',
    description: 'Azure, LiteLLM, Ollama, vLLM…',
  },
];

/** How quanthea may connect to a provider. */
const connectionOptions: readonly {
  readonly value: ProviderAuth['type'];
  readonly title: string;
  readonly description: string;
}[] = [
  {
    value: 'api-key',
    title: 'API key',
    description: 'Stored on this server.',
  },
  {
    value: 'oauth-client-credentials',
    title: 'Identity provider',
    description: 'Entra ID, Okta, Keycloak.',
  },
];

/**
 * The common gateways' base URLs, a click away. A preset that serves one vendor's models, such as
 * Gemini, also fills in each job's model.
 *
 * @param props - The form.
 * @returns The buttons.
 */
function GatewayPresets({ form }: SectionProps) {
  return (
    <div className={styles.presets}>
      {gatewayPresets.map((preset) => (
        <Button
          key={preset.name}
          size="small"
          onClick={() => {
            form.set('baseUrl', preset.baseUrl);
            if (preset.defaults) form.set('models', { ...preset.defaults });
          }}
        >
          {preset.name}
        </Button>
      ))}
    </div>
  );
}

/**
 * The base URL: the provider's own API, filled in, or a gateway's, with the common ones a click
 * away. Through an identity provider it is the company's gateway.
 *
 * @param props - The form and the issues.
 * @returns The field, and the gateway presets for an OpenAI-compatible provider with a key.
 */
function BaseUrlField({ form, issues }: SectionProps) {
  const viaToken = form.selected?.auth.type === 'oauth-client-credentials';
  const compatible = form.settings.provider === 'openai-compatible';
  const ownApi = compatible ? 'http://localhost:4000/v1' : 'The provider’s own API';
  return (
    <div className={styles.baseUrl}>
      <Input
        label="Base URL"
        mono
        autoComplete="off"
        placeholder={viaToken ? 'https://llm.your-company.example/v1' : ownApi}
        value={form.settings.baseUrl ?? ''}
        onChange={(event) =>
          form.set('baseUrl', event.target.value === '' ? null : event.target.value)
        }
        hint={viaToken ? 'Your gateway. The vendors’ own APIs take keys only.' : undefined}
        error={issues.baseUrl}
      />
      {compatible && !viaToken && <GatewayPresets form={form} issues={issues} />}
    </div>
  );
}

/**
 * The provider's name. While it is empty or one quanthea gave, the vendor its base URL reaches is
 * proposed as the placeholder.
 *
 * @param props - The form and the issues.
 * @returns The field.
 */
function NameField({ form, issues }: SectionProps) {
  const suggestion = form.selected ? suggestedProviderName(form.selected) : null;
  return (
    <Input
      label="Name"
      value={form.selected?.name ?? ''}
      placeholder={suggestion ?? undefined}
      onChange={(event) => form.rename(event.target.value)}
      hint="Threads show it, and so does the usage."
      error={issues.name}
    />
  );
}

/**
 * How quanthea connects: the choice, then the key field or the identity provider's fields.
 *
 * @param props - The form, the stored secret and the issues.
 * @param props.stored - The stored key or client secret, masked, or `null`.
 * @returns The section.
 */
function ConnectionFields({
  form,
  stored,
  issues,
}: SectionProps & { readonly stored: string | null }) {
  const type = form.selected?.auth.type ?? 'api-key';
  const compatible = form.settings.provider === 'openai-compatible';
  return (
    <div className={styles.connection}>
      <span className={styles.groupLabel} aria-hidden="true">
        Connect with
      </span>
      <RadioCards
        label="Connect with"
        options={connectionOptions}
        value={type}
        onChange={form.chooseConnection}
      />
      {type === 'api-key' ? (
        <SecretField
          key={form.selected?.id}
          form={form}
          stored={stored}
          label="API key"
          placeholder={compatible ? 'If the gateway asks for one' : 'Paste the key'}
          issues={issues}
        />
      ) : (
        <IdentityProviderFields form={form} stored={stored} issues={issues} />
      )}
    </div>
  );
}

/**
 * The card of the provider being edited: its name, the API it speaks, where it is, how quanthea
 * connects to it, and the connection test.
 *
 * @param props - The form, the stored secret and the issues.
 * @param props.stored - The stored key or client secret, masked, or `null`.
 * @returns The card.
 */
export function ProviderCard({
  form,
  stored,
  issues,
}: SectionProps & { readonly stored: string | null }) {
  const id = form.selected?.id ?? '';
  return (
    <Card title="Provider">
      <NameField form={form} issues={issues} />
      <div className={styles.connection}>
        <span className={styles.groupLabel} aria-hidden="true">
          API it speaks
        </span>
        <RadioCards
          label="API it speaks"
          options={providerOptions}
          value={form.settings.provider}
          onChange={form.chooseProvider}
        />
      </div>
      <BaseUrlField form={form} issues={issues} />
      <ConnectionFields form={form} stored={stored} issues={issues} />
      <ConnectionTest dirty={form.dirty} providerId={id} />
    </Card>
  );
}
