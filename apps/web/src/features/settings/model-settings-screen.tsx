import type { ModelSettingsView } from '@quanthea/shared';
import { Link, type SubmitTarget, useFetcher, useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Input } from '../../ui/input.tsx';
import { Page } from '../../ui/page.tsx';
import { Switch } from '../../ui/switch.tsx';
import type { ModelSettingsIntent, ModelSettingsOutcome } from './data.ts';
import { ModelPicker, useModelList } from './model-picker.tsx';
import styles from './model-settings.module.css';
import { useModelSettingsForm } from './model-settings-form.ts';
import { type Form, ProviderCard, type SectionProps } from './provider-card.tsx';
import { ProvidersCard } from './providers-card.tsx';

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
  const { provider, baseUrl } = form.settings;
  const list = useModelList(provider, baseUrl, form.apiKey, form.selected?.id ?? '');
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

/** The behaviour switches, in the order the card lists them. */
const behaviourSwitches = [
  {
    key: 'planApproval',
    label: 'Ask for plan approval before building',
    description: 'Small edits to an existing panel skip the plan.',
  },
  {
    key: 'testRun',
    label: 'Test-run every query before showing a panel',
    description: 'Failed queries go back to the model with the error.',
  },
  {
    key: 'shortReasoning',
    label: "Keep the model's reasoning short",
    description: 'Faster and cheaper. Turn it off if a gateway rejects the reasoning effort.',
  },
  {
    key: 'planQueries',
    label: 'Show the queries in a plan',
    description:
      "A plan for an existing dashboard also shows each panel's new query, and how it changes. Plans take longer and cost more.",
  },
] as const;

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
      {behaviourSwitches.map(({ key, label, description }) => (
        <Switch
          key={key}
          label={label}
          description={description}
          checked={behaviour[key]}
          onChange={(on) => form.set(`behaviour.${key}`, on)}
        />
      ))}
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
  { key: 'repairAttempts', label: 'Repair attempts per answer' },
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
 * This month's usage, from the ledger: threads, tokens, the list-price cost, and pinned views,
 * which spend nothing.
 *
 * @param props - The usage.
 * @param props.usage - Tokens and threads this month.
 * @returns The card.
 */
function UsageCard({ usage }: { readonly usage: ModelSettingsView['usage'] }) {
  const dollars = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: 'USD',
    maximumSignificantDigits: 2,
  });
  const figures = [
    ['Threads', usage.threads.toLocaleString('en')],
    ['Tokens', usage.tokens.toLocaleString('en')],
    ['List-price cost', usage.dollars === 0 ? '$0' : dollars.format(usage.dollars)],
    ['Pinned views', usage.pinnedViews.toLocaleString('en')],
  ];
  return (
    <Card title="This month" actions={<Link to="/settings/usage">See usage</Link>}>
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
    const intent: ModelSettingsIntent = {
      intent: 'save',
      gateway: form.gateway,
      apiKeys: form.apiKeys,
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
 * The issues under a path, keyed by the rest of their path.
 *
 * @param issues - The issues by full path.
 * @param prefix - Such as `providers.1.`.
 * @returns The issues under it, such as `baseUrl`.
 */
function issuesUnder(issues: Readonly<Record<string, string>>, prefix: string) {
  return Object.fromEntries(
    Object.entries(issues).flatMap(([path, message]) =>
      path.startsWith(prefix) ? [[path.slice(prefix.length), message]] : [],
    ),
  );
}

/**
 * The form, reset whenever the saved settings change.
 *
 * @param props - The saved view.
 * @param props.view - The saved settings, the masked key and the usage.
 * @returns The form.
 */
function ModelSettingsForm({ view }: { readonly view: ModelSettingsView }) {
  const form = useModelSettingsForm(view.gateway);
  const { save, saving, message, issues } = useSave(form);
  const selected = form.gateway.providers.findIndex((config) => config.id === form.selected?.id);
  const providerIssues = issuesUnder(issues, `providers.${selected}.`);
  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <ProvidersCard form={form} keys={view.keys} />
        <ProviderCard
          form={form}
          stored={view.keys[form.selected?.id ?? ''] ?? null}
          issues={providerIssues}
        />
        <JobsCard form={form} issues={providerIssues} />
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
      <ModelSettingsForm key={JSON.stringify([view.gateway, view.keys])} view={view} />
    </Page>
  );
}
