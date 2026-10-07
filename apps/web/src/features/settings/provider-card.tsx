/** The card of one provider: its name, vendor, base URL, key and connection test. */
import { gatewayPresets, suggestedProviderName } from '@quanthea/shared';
import { useState } from 'react';
import { type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { CheckIcon, WarningIcon } from '../../ui/icons.tsx';
import { Input } from '../../ui/input.tsx';
import { RadioCards } from '../../ui/radio-cards.tsx';
import type { ModelSettingsIntent, ModelSettingsOutcome, ModelTest } from './data.ts';
import styles from './model-settings.module.css';
import type { useModelSettingsForm } from './model-settings-form.ts';

/** The form state {@link useModelSettingsForm} returns. */
export type Form = ReturnType<typeof useModelSettingsForm>;

/** Props of the sections of the form. */
export interface SectionProps {
  /** The form state. */
  readonly form: Form;
  /** The server's issues by settings path. */
  readonly issues: Readonly<Record<string, string>>;
}

/** The provider choices. */
const providerOptions = [
  { value: 'anthropic' as const, title: 'Anthropic', description: 'API key' },
  { value: 'openai' as const, title: 'OpenAI', description: 'API key' },
  { value: 'mistral' as const, title: 'Mistral', description: 'API key' },
  {
    value: 'openai-compatible' as const,
    title: 'OpenAI-compatible',
    description: 'LiteLLM, Ollama, OpenRouter, vLLM…',
  },
];

/**
 * Describes a test result.
 *
 * @param result - The result.
 * @returns Such as `Reachable · tool calling supported · structured output supported · 812 ms`.
 */
function testLine(result: ModelTest): string {
  if (!result.ok) return result.message;
  const tools = result.toolCalling ? 'tool calling supported' : 'no tool calling';
  const structured = result.structuredOutput
    ? 'structured output supported'
    : 'no structured output';
  return `Reachable · ${tools} · ${structured} · ${Math.round(result.latencyMs)} ms`;
}

/**
 * What the test line shows.
 *
 * @param result - The last result, if any.
 * @param testing - Whether a test is running.
 * @param dirty - Whether the form has unsaved changes.
 * @returns The tone and the words.
 */
function testState(result: ModelTest | undefined, testing: boolean, dirty: boolean) {
  if (testing) return { tone: 'idle', line: 'Testing…' };
  if (result)
    return { tone: result.ok && result.toolCalling ? 'ok' : 'failed', line: testLine(result) };
  return { tone: 'idle', line: dirty ? 'Save to test these settings.' : 'Not tested yet.' };
}

/**
 * The connection test: its last result and the button that runs it on the saved settings.
 *
 * @param props - Whether the form has unsaved changes.
 * @param props.dirty - Whether the form differs from the saved settings.
 * @param props.providerId - The saved provider to test.
 * @returns The test line.
 */
function ConnectionTest({
  dirty,
  providerId,
}: {
  readonly dirty: boolean;
  readonly providerId: string;
}) {
  const fetcher = useFetcher<ModelSettingsOutcome>();
  const result = fetcher.data?.intent === 'test' ? fetcher.data.result : undefined;
  const testing = fetcher.state !== 'idle';
  const intent: ModelSettingsIntent = { intent: 'test', providerId };
  const run = () =>
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  const { tone, line } = testState(result, testing, dirty);
  return (
    <div className={styles.test} data-tone={tone} role="status">
      {tone === 'ok' && <CheckIcon />}
      {tone === 'failed' && <WarningIcon />}
      <span className={styles.testLine}>{line}</span>
      <Button size="small" onClick={run} disabled={testing || dirty}>
        {result ? 'Test again' : 'Test'}
      </Button>
    </div>
  );
}

/**
 * The API key: the stored one masked, with Replace, or a field for a new one.
 *
 * @param props - The form, the stored key and the issues.
 * @param props.stored - The stored key, masked, or `null`.
 * @returns The key field.
 */
function ApiKeyField({ form, stored, issues }: SectionProps & { readonly stored: string | null }) {
  const [replacing, setReplacing] = useState(stored === null);
  if (!replacing && stored !== null) {
    return (
      <div className={styles.keyRow}>
        <Input label="API key" mono readOnly value={stored} />
        <Button onClick={() => setReplacing(true)}>Replace</Button>
      </div>
    );
  }
  return (
    <Input
      label="API key"
      mono
      type="password"
      autoComplete="new-password"
      placeholder={
        form.settings.provider === 'openai-compatible'
          ? 'If the gateway asks for one'
          : 'Paste the key'
      }
      value={form.apiKey ?? ''}
      onChange={(event) =>
        form.setApiKey(event.target.value === '' ? undefined : event.target.value)
      }
      error={issues.apiKey}
    />
  );
}

/**
 * The base URL: the provider's own API, filled in, or a gateway's, with the common ones a click
 * away. A preset that serves one vendor's models, such as Gemini, also fills in each job's model.
 *
 * @param props - The form and the issues.
 * @returns The field, and the gateway presets for an OpenAI-compatible provider.
 */
function BaseUrlField({ form, issues }: SectionProps) {
  const compatible = form.settings.provider === 'openai-compatible';
  return (
    <div className={styles.baseUrl}>
      <Input
        label="Base URL"
        mono
        autoComplete="off"
        placeholder={compatible ? 'http://localhost:4000/v1' : 'The provider’s own API'}
        value={form.settings.baseUrl ?? ''}
        onChange={(event) =>
          form.set('baseUrl', event.target.value === '' ? null : event.target.value)
        }
        error={issues.baseUrl}
      />
      {compatible && (
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
      )}
    </div>
  );
}

/**
 * The provider's name, with the vendor its base URL reaches proposed while the name is empty or
 * one quanthea gave. The proposal is applied only when the admin takes it.
 *
 * @param props - The form and the issues.
 * @returns The field, and the proposal when there is one.
 */
function NameField({ form, issues }: SectionProps) {
  const suggestion = form.selected ? suggestedProviderName(form.selected) : null;
  return (
    <div className={styles.name}>
      <Input
        label="Name"
        value={form.selected?.name ?? ''}
        placeholder={suggestion ?? undefined}
        onChange={(event) => form.rename(event.target.value)}
        hint={
          suggestion
            ? `Its base URL reaches ${suggestion}. Threads and the usage show the name.`
            : 'Threads show it, and so does the usage.'
        }
        error={issues.name}
      />
      {suggestion && (
        <Button size="small" onClick={() => form.rename(suggestion)}>
          Name it {suggestion}
        </Button>
      )}
    </div>
  );
}

/**
 * The card of the provider being edited: its name, the vendor, where it is, its key and the
 * connection test.
 *
 * @param props - The form, the stored key and the issues.
 * @param props.stored - The stored key, masked, or `null`.
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
      <RadioCards
        label="Provider"
        options={providerOptions}
        value={form.settings.provider}
        onChange={form.chooseProvider}
      />
      <div className={styles.pair}>
        <BaseUrlField form={form} issues={issues} />
        <ApiKeyField key={id} form={form} stored={stored} issues={issues} />
      </div>
      <ConnectionTest dirty={form.dirty} providerId={id} />
    </Card>
  );
}
