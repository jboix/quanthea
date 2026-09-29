import { gatewayPresets, type ModelSettings, type ModelSettingsView } from '@querent/shared';
import { useState } from 'react';
import { type SubmitTarget, useFetcher, useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { CheckIcon, WarningIcon } from '../../ui/icons.tsx';
import { Input } from '../../ui/input.tsx';
import { Page } from '../../ui/page.tsx';
import { RadioCards } from '../../ui/radio-cards.tsx';
import { Switch } from '../../ui/switch.tsx';
import type { ModelSettingsIntent, ModelSettingsOutcome, ModelTest } from './data.ts';
import { ModelPicker, useModelList } from './model-picker.tsx';
import styles from './model-settings.module.css';
import { useModelSettingsForm } from './model-settings-form.ts';

/** The form state {@link useModelSettingsForm} returns. */
type Form = ReturnType<typeof useModelSettingsForm>;

/** Props of the sections of the form. */
interface SectionProps {
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
 * @returns The test line.
 */
function ConnectionTest({ dirty }: { readonly dirty: boolean }) {
  const fetcher = useFetcher<ModelSettingsOutcome>();
  const result = fetcher.data?.intent === 'test' ? fetcher.data.result : undefined;
  const testing = fetcher.state !== 'idle';
  const intent: ModelSettingsIntent = { intent: 'test' };
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
 * away.
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
              onClick={() => form.set('baseUrl', preset.baseUrl)}
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
 * The provider card: the provider, where it is, the key and the connection test.
 *
 * @param props - The form, the stored key and the issues.
 * @param props.stored - The stored key, masked, or `null`.
 * @returns The card.
 */
function ProviderCard({ form, stored, issues }: SectionProps & { readonly stored: string | null }) {
  return (
    <Card title="Provider">
      <RadioCards
        label="Provider"
        options={providerOptions}
        value={form.settings.provider}
        onChange={form.chooseProvider}
      />
      <div className={styles.pair}>
        <BaseUrlField form={form} issues={issues} />
        <ApiKeyField form={form} stored={stored} issues={issues} />
      </div>
      <ConnectionTest dirty={form.dirty} />
    </Card>
  );
}

/** The jobs, in the order the card lists them. */
const jobs = [
  { key: 'plan', label: 'Talk the question through and plan' },
  { key: 'build', label: 'Build and edit dashboards' },
  { key: 'repair', label: 'Repair a failed query' },
  { key: 'metadata', label: 'Titles, tags and descriptions' },
] as const;

/**
 * The card that picks the model for each job, from the models the provider lists.
 *
 * @param props - The form and the issues.
 * @returns The card.
 */
function JobsCard({ form, issues }: SectionProps) {
  const list = useModelList(form.settings.provider, form.settings.baseUrl, form.apiKey);
  return (
    <Card
      title="Model for each job"
      description="Building needs a strong tool-calling model. Talking, planning and tagging can use a cheaper one."
    >
      {jobs.map((job) => (
        <div key={job.key} className={styles.job}>
          <span className={styles.jobLabel}>{job.label}</span>
          <ModelPicker
            label={job.label}
            value={form.settings.models[job.key]}
            sameAsBuild={job.key !== 'build'}
            list={list}
            onChange={(value) => form.set(`models.${job.key}`, value)}
            error={issues[`models.${job.key}`]}
          />
        </div>
      ))}
    </Card>
  );
}

/**
 * The behaviour switches.
 *
 * @param props - The form.
 * @returns The card.
 */
function BehaviourCard({ form }: SectionProps) {
  const { behaviour } = form.settings;
  return (
    <Card title="Behaviour">
      <Switch
        label="Ask for plan approval before building"
        description="Small edits to an existing panel skip the plan."
        checked={behaviour.planApproval}
        onChange={(on) => form.set('behaviour.planApproval', on)}
      />
      <Switch
        label="Test-run every query before showing a panel"
        description="Failed queries go back to the model with the error."
        checked={behaviour.testRun}
        onChange={(on) => form.set('behaviour.testRun', on)}
      />
      <Switch
        label="Keep the model's reasoning short"
        description="Faster and cheaper. Turn it off if a gateway rejects the reasoning effort."
        checked={behaviour.shortReasoning}
        onChange={(on) => form.set('behaviour.shortReasoning', on)}
      />
      <Switch
        label="Custom JS formatters"
        description="Not available. Specs format values with named formatters only."
        checked={false}
        onChange={() => undefined}
        disabled
      />
    </Card>
  );
}

/** The limits, in the order the card lists them. */
const limitFields = [
  { key: 'threadTokens', label: 'Stop a thread after (tokens)' },
  { key: 'toolCallsPerTurn', label: 'Max tool calls per turn' },
  { key: 'repairAttempts', label: 'Repair attempts per panel' },
] as const;

/**
 * The limits of a run.
 *
 * @param props - The form and the issues.
 * @returns The card.
 */
function LimitsCard({ form, issues }: SectionProps) {
  return (
    <Card title="Limits">
      {limitFields.map(({ key, label }) => (
        <Input
          key={key}
          label={label}
          mono
          inputMode="numeric"
          value={String(form.settings.limits[key])}
          onChange={(event) => form.set(`limits.${key}`, Number(event.target.value))}
          error={issues[`limits.${key}`]}
        />
      ))}
    </Card>
  );
}

/**
 * This month's usage: what threads spent, and what pinned dashboards did not.
 *
 * @param props - The usage.
 * @param props.usage - Tokens and threads this month.
 * @returns The card.
 */
function UsageCard({ usage }: { readonly usage: ModelSettingsView['usage'] }) {
  const figures = [
    ['Threads', usage.threads.toLocaleString('en')],
    ['Tokens', usage.tokens.toLocaleString('en')],
    ['Pinned views', '0 tokens'],
  ];
  return (
    <Card title="This month">
      <dl className={styles.figures}>
        {figures.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/**
 * Saves the form through the route action.
 *
 * @param form - The form state.
 * @returns The save function, whether a save runs, and the outcome's message and issues.
 */
function useSave(form: Form) {
  const fetcher = useFetcher<ModelSettingsOutcome>();
  const outcome = fetcher.data?.intent === 'save' && !fetcher.data.ok ? fetcher.data : undefined;
  const save = () => {
    const key = form.apiKey ? { apiKey: form.apiKey } : {};
    const intent: ModelSettingsIntent = {
      intent: 'save',
      settings: form.settings as ModelSettings,
      ...key,
    };
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  };
  return {
    save,
    saving: fetcher.state !== 'idle',
    message: outcome?.message,
    issues: outcome?.issues ?? {},
  };
}

/**
 * The form, reset whenever the saved settings change.
 *
 * @param props - The saved view.
 * @param props.view - The saved settings, the masked key and the usage.
 * @returns The form.
 */
function ModelSettingsForm({ view }: { readonly view: ModelSettingsView }) {
  const form = useModelSettingsForm(view.settings);
  const { save, saving, message, issues } = useSave(form);
  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <ProviderCard form={form} stored={view.apiKey} issues={issues} />
        <JobsCard form={form} issues={issues} />
        <BehaviourCard form={form} issues={issues} />
        <div className={styles.saveBar}>
          <Button variant="primary" onClick={save} disabled={!form.dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {message !== undefined && <span className={styles.error}>{message}</span>}
        </div>
      </div>
      <aside className={styles.side}>
        <UsageCard usage={view.usage} />
        <LimitsCard form={form} issues={issues} />
        <p className={styles.note}>
          Keys are stored on this machine only and sent to the provider or base URL above, nowhere
          else.
        </p>
      </aside>
    </div>
  );
}

/**
 * The model settings screen.
 *
 * @returns The screen.
 */
export function ModelSettingsScreen() {
  const view = useLoaderData() as ModelSettingsView;
  return (
    <Page
      title="Model"
      subtitle="Bring your own key or point at your own gateway. Pinned dashboards never use it."
    >
      <ModelSettingsForm key={JSON.stringify([view.settings, view.apiKey])} view={view} />
    </Page>
  );
}
