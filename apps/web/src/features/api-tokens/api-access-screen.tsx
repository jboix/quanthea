/**
 * Settings → MCP access: whether MCP clients may connect, how long a new token may last, and
 * whether a client may run written queries.
 */
import type { ApiAccessSettings } from '@quanthea/shared';
import { useState } from 'react';
import { type SubmitTarget, useFetcher, useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Input } from '../../ui/input.tsx';
import { Page } from '../../ui/page.tsx';
import { Switch } from '../../ui/switch.tsx';
import { ActivityCard } from './activity-card.tsx';
import type { ApiAccessData, ApiAccessIntent, ApiAccessOutcome } from './data.ts';
import { RevokeEveryCard } from './revoke-every.tsx';
import styles from './tokens.module.css';

/** The longest lifetime the settings take, in days. */
const longestDays = 3650;

/**
 * Saving the settings.
 *
 * @param settings - The settings as edited.
 * @returns The save function, whether a save runs, and a refusal.
 */
function useSave(settings: ApiAccessSettings) {
  const fetcher = useFetcher<ApiAccessOutcome>();
  const intent: ApiAccessIntent = { intent: 'save', settings };
  const save = () =>
    void fetcher.submit(intent as unknown as SubmitTarget, {
      method: 'post',
      encType: 'application/json',
    });
  const refused = fetcher.data?.ok === false ? fetcher.data.message : undefined;
  return { save, refused, saving: fetcher.state !== 'idle' };
}

/**
 * Whether a lifetime is one the settings take.
 *
 * @param days - The lifetime, in days.
 * @returns Whether it is a whole number within the limits.
 */
function isLifetime(days: number): boolean {
  return Number.isInteger(days) && days >= 1 && days <= longestDays;
}

/** The settings as the screen edits them, with the lifetime as typed. */
interface Draft {
  /** Whether the MCP endpoint answers. */
  readonly mcp: boolean;
  /** The longest lifetime of a token, as typed. */
  readonly days: string;
  /** Whether editors get the MCP tools that run a written query. */
  readonly mcpQueryTools: boolean;
}

/** Props of the cards: the draft, and how to change it. */
interface CardProps {
  /** The settings as edited. */
  readonly draft: Draft;
  /** Changes some of them. */
  readonly onChange: (patch: Partial<Draft>) => void;
}

/**
 * The settings a draft stands for.
 *
 * @param draft - The draft.
 * @returns The settings, with the lifetime as a number.
 */
function settingsOf({ days, ...switches }: Draft): ApiAccessSettings {
  return { ...switches, maxLifetimeDays: Number(days) };
}

/**
 * Whether two settings differ.
 *
 * @param first - The settings.
 * @param second - The others.
 * @returns Whether any field differs.
 */
function differ(first: ApiAccessSettings, second: ApiAccessSettings): boolean {
  const names = ['mcp', 'maxLifetimeDays', 'mcpQueryTools'] as const;
  return names.some((name) => first[name] !== second[name]);
}

/**
 * The card for the MCP endpoint: whether it answers, and whether it runs written queries.
 *
 * @param props - The draft and the change callback.
 * @returns The card.
 */
function McpCard({ draft, onChange }: CardProps) {
  return (
    <Card
      title="MCP server"
      description="An assistant connects to /api/mcp with a token and reads pinned dashboards, alerts and reports. It changes nothing."
    >
      <Switch
        label="Allow MCP clients"
        description="What a tool returns of the data follows each connector’s access level, as it does for quanthea’s own assistant. Turned off, the address refuses every client and no token can be made."
        checked={draft.mcp}
        onChange={(mcp) => onChange({ mcp })}
      />
      <Switch
        label="Allow written queries"
        description="Adds two tools for tokens with the editor role: one describes a connector’s schema, one runs a query the assistant writes. Both stay inside the connector’s scope, limits and access level."
        checked={draft.mcpQueryTools}
        disabled={!draft.mcp}
        onChange={(mcpQueryTools) => onChange({ mcpQueryTools })}
      />
    </Card>
  );
}

/**
 * The card for the tokens: the longest a new one may last.
 *
 * @param props - The draft and the change callback.
 * @returns The card.
 */
function TokensCard({ draft, onChange }: CardProps) {
  const valid = isLifetime(Number(draft.days));
  return (
    <Card
      title="MCP tokens"
      description="Each person makes their own, from the account menu. A token works on the MCP address only: every other part of quanthea refuses it."
    >
      <div className={styles.lifetime}>
        <Input
          label="Longest lifetime, in days"
          type="number"
          min={1}
          max={longestDays}
          mono
          value={draft.days}
          onChange={(event) => onChange({ days: event.target.value })}
          error={valid ? undefined : `A whole number of days, from 1 to ${longestDays}.`}
          hint="Tokens made earlier keep the lifetime they were given."
        />
      </div>
    </Card>
  );
}

/**
 * The MCP access screen: the MCP card, the tokens card and Save, then revoking every token and
 * what tokens did.
 *
 * @returns The screen.
 */
export function ApiAccessScreen() {
  const { settings: saved, calls } = useLoaderData() as ApiAccessData;
  const { maxLifetimeDays, ...switches } = saved;
  const [draft, setDraft] = useState<Draft>({ ...switches, days: String(maxLifetimeDays) });
  const change = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const settings = settingsOf(draft);
  const { save, refused, saving } = useSave(settings);
  const ready = differ(settings, saved) && isLifetime(settings.maxLifetimeDays) && !saving;
  return (
    <Page title="MCP access" subtitle="How an assistant outside quanthea reads it.">
      <McpCard draft={draft} onChange={change} />
      <TokensCard draft={draft} onChange={change} />
      <div className={styles.actions}>
        {refused && <p className={styles.error}>{refused}</p>}
        <Button variant="primary" onClick={save} disabled={!ready}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <RevokeEveryCard />
      <ActivityCard calls={calls} />
    </Page>
  );
}
