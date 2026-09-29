import type { AuthMode, AuthSettingsView } from '@querent/shared';
import { useEffect, useState } from 'react';
import { Link, type SubmitTarget, useFetcher, useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Page } from '../../ui/page.tsx';
import { RadioCards } from '../../ui/radio-cards.tsx';
import { Select } from '../../ui/select.tsx';
import styles from './auth-settings.module.css';
import type { AuthSettingsIntent, AuthSettingsOutcome } from './data.ts';

/** The two modes, as the screen offers them. */
const modeOptions = [
  {
    value: 'none',
    title: 'Open access',
    description: 'Everyone who reaches this address is an admin. For a machine only you can reach.',
  },
  {
    value: 'accounts',
    title: 'Accounts',
    description:
      'People sign in, and their role sets what they can do. Their threads are their own.',
  },
] as const;

/**
 * Submits authentication intents; after a switch, loads the next page in full, since every
 * session ended.
 *
 * @returns The submit function, whether one is on its way, and the refusal, if any.
 */
function useAuthIntent() {
  const fetcher = useFetcher<AuthSettingsOutcome>();
  const outcome = fetcher.data;
  useEffect(() => {
    if (outcome?.ok)
      window.location.assign(outcome.mode === 'accounts' ? '/login' : '/settings/auth');
  }, [outcome]);
  const submit = (intent: AuthSettingsIntent) =>
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  return {
    submit,
    busy: fetcher.state !== 'idle',
    refusal: outcome?.ok === false ? outcome.message : undefined,
  };
}

/**
 * Why accounts cannot start yet: keys the server lacks, or no admin who can sign in.
 *
 * @param props - The settings.
 * @param props.settings - The authentication settings.
 * @returns The list, or nothing when accounts can start.
 */
function Readiness({ settings }: { readonly settings: AuthSettingsView }) {
  const missing = [
    ...settings.problems,
    ...(settings.signInAdmins.length === 0 ? ['No admin can sign in yet.'] : []),
  ];
  if (missing.length === 0) return null;
  return (
    <>
      <ul className={styles.problems}>
        {missing.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
      {settings.signInAdmins.length === 0 && (
        <p className={styles.note}>
          Invite an admin in <Link to="/settings/users">Settings → Users</Link> and let them set a
          password.
        </p>
      )}
    </>
  );
}

/**
 * The admin that the threads from open access go to.
 *
 * @param props - The settings, the chosen admin and its setter.
 * @param props.settings - The authentication settings.
 * @param props.heir - The chosen admin.
 * @param props.onHeir - Chooses another.
 * @returns The select, or nothing when there are no such threads.
 */
function HeirSelect({
  settings,
  heir,
  onHeir,
}: {
  readonly settings: AuthSettingsView;
  readonly heir: string;
  readonly onHeir: (id: string) => void;
}) {
  if (settings.openAccessThreads === 0 || settings.signInAdmins.length === 0) return null;
  const count = settings.openAccessThreads;
  return (
    <Select
      label={
        count === 1
          ? 'The thread from open access goes to'
          : `The ${count} threads from open access go to`
      }
      options={settings.signInAdmins.map((admin) => ({ value: admin.id, label: admin.name }))}
      value={heir}
      onChange={(event) => onHeir(event.target.value)}
    />
  );
}

/**
 * The mode card: the choice, what accounts still need, and where open-access threads go.
 *
 * @param props - The settings.
 * @param props.settings - The authentication settings.
 * @returns The card.
 */
function ModeCard({ settings }: { readonly settings: AuthSettingsView }) {
  const [mode, setMode] = useState<AuthMode>(settings.mode);
  const [heir, setHeir] = useState(settings.signInAdmins[0]?.id ?? '');
  const { submit, busy, refusal } = useAuthIntent();
  const changed = mode !== settings.mode;
  const save = () => submit({ intent: 'switch', mode, ...(heir ? { adoptTo: heir } : {}) });
  return (
    <Card title="Who can reach querent" description="Switching ends every session, yours too.">
      <div className={styles.form}>
        {settings.overridden && (
          <p className={styles.note}>
            QUERENT_AUTH_MODE is set on the server, so the mode cannot change here.
          </p>
        )}
        <RadioCards<AuthMode>
          label="Mode"
          value={mode}
          onChange={setMode}
          options={modeOptions}
          disabled={settings.overridden}
        />
        {mode === 'accounts' && <Readiness settings={settings} />}
        {mode === 'accounts' && changed && (
          <HeirSelect settings={settings} heir={heir} onHeir={setHeir} />
        )}
        {refusal && <p className={styles.error}>{refusal}</p>}
        <div>
          <Button variant="primary" disabled={!changed || busy} onClick={save}>
            {mode === 'accounts' ? 'Switch to accounts' : 'Switch to open access'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * Handing the threads from open access to an admin, after the switch.
 *
 * @param props - The settings.
 * @param props.settings - The authentication settings.
 * @returns The card, or nothing when there are no such threads.
 */
function AdoptCard({ settings }: { readonly settings: AuthSettingsView }) {
  const [heir, setHeir] = useState(settings.signInAdmins[0]?.id ?? '');
  const { submit, busy, refusal } = useAuthIntent();
  if (settings.mode !== 'accounts' || settings.openAccessThreads === 0) return null;
  return (
    <Card
      title="Threads from open access"
      description="They belong to no one; only admins can read them."
    >
      <div className={styles.row}>
        <HeirSelect settings={settings} heir={heir} onHeir={setHeir} />
        <Button disabled={busy || !heir} onClick={() => submit({ intent: 'adopt', userId: heir })}>
          Hand them over
        </Button>
      </div>
      {refusal && <p className={styles.error}>{refusal}</p>}
    </Card>
  );
}

/**
 * Settings → Authentication: open access or accounts.
 *
 * @returns The screen.
 */
export function AuthSettingsScreen() {
  const settings = useLoaderData() as AuthSettingsView;
  return (
    <Page title="Authentication" subtitle="Choose who can reach querent, and how they sign in.">
      <ModeCard settings={settings} />
      <AdoptCard settings={settings} />
    </Page>
  );
}
