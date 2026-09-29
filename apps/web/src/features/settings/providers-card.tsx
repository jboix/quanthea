/** The list of saved providers: pick one to edit, add one, remove one, choose the default. */
import type { ModelProvider, ProviderConfig } from '@querent/shared';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import styles from './model-settings.module.css';
import type { Form } from './provider-card.tsx';

/** How each vendor reads. */
const vendorNames: Readonly<Record<ModelProvider, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  mistral: 'Mistral',
  'openai-compatible': 'OpenAI-compatible',
};

/**
 * The words under a provider's name: its vendor, its build model, and its key.
 *
 * @param config - The provider.
 * @param stored - Its stored key, masked, if any.
 * @param typed - Whether a new key is typed for it.
 * @returns Such as `Mistral · mistral-large-latest · no key`.
 */
function metaOf(config: ProviderConfig, stored: string | null | undefined, typed: boolean): string {
  const key = typed ? 'new key' : stored ? '' : 'no key';
  return [vendorNames[config.provider], config.models.build || 'no build model', key]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The saved providers.
 *
 * @param props - The form and the stored keys.
 * @param props.form - The form state.
 * @param props.keys - Each provider's stored key, masked, or `null`.
 * @returns The card.
 */
export function ProvidersCard({
  form,
  keys,
}: {
  readonly form: Form;
  readonly keys: Readonly<Record<string, string | null>>;
}) {
  const { gateway } = form;
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
        {gateway.providers.map((config) => (
          <li
            key={config.id}
            className={styles.providerRow}
            data-selected={config.id === form.selected?.id}
          >
            <button
              type="button"
              className={styles.providerPick}
              onClick={() => form.select(config.id)}
            >
              <span className={styles.providerName}>{config.name}</span>
              <span className={styles.providerMeta}>
                {metaOf(config, keys[config.id], form.apiKeys[config.id] !== undefined)}
              </span>
            </button>
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
        ))}
      </ul>
    </Card>
  );
}
