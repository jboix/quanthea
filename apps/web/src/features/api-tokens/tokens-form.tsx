/** The MCP tokens dialog of the account menu: one's tokens, a form to make one, and Revoke. */
import {
  type ApiTokenView,
  dayMonthTime,
  dayMonthYear,
  hasRole,
  type Principal,
  type Role,
  roles,
} from '@quanthea/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { Select } from '../../ui/select.tsx';
import type { CreatedToken, TokenIntent, TokenList, TokenOutcome } from './data.ts';
import styles from './tokens.module.css';

/** The route the dialog loads from and posts to. */
const tokensPath = '/account/tokens';

/** The lifetimes the form offers, in days. */
const lifetimes = [7, 30, 90, 365] as const;

/**
 * One's tokens and the settings, loaded when the dialog first shows.
 *
 * @returns The tokens and settings, once loaded.
 */
function useTokenList(): TokenList | undefined {
  const fetcher = useFetcher<TokenList>();
  useEffect(() => {
    if (fetcher.state === 'idle' && !fetcher.data) void fetcher.load(tokensPath);
  }, [fetcher]);
  return fetcher.data;
}

/**
 * Submits the dialog's intents, and keeps the last outcome.
 *
 * @returns The submit function, whether one is on its way, and the outcome.
 */
function useTokenIntent() {
  const fetcher = useFetcher<TokenOutcome>();
  const submit = (intent: TokenIntent) =>
    void fetcher.submit(intent as SubmitTarget, {
      method: 'post',
      action: tokensPath,
      encType: 'application/json',
    });
  return { submit, busy: fetcher.state !== 'idle', outcome: fetcher.data };
}

/**
 * A token just made, with a copy button. It is the only time the token is shown.
 *
 * @param props - The token.
 * @param props.created - The token just made.
 * @returns The box.
 */
function CreatedBox({ created }: { readonly created: CreatedToken }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(created.token);
    setCopied(true);
  };
  return (
    <div className={styles.created} role="status">
      <span>Copy “{created.details.name}” now. It is not shown again.</span>
      <div className={styles.createdRow}>
        <code className={styles.createdText}>{created.token}</code>
        <Button size="small" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

/**
 * When a token was last used and when it stops working.
 *
 * @param token - The token.
 * @param now - The current time.
 * @returns The line under its name.
 */
function usageLine(token: ApiTokenView, now: number): string {
  const used =
    token.lastUsedAt === null ? 'Never used' : `Used ${dayMonthTime(token.lastUsedAt, now)}`;
  const end = dayMonthYear(token.expiresAt);
  return token.expiresAt <= now ? `${used}. Expired ${end}.` : `${used}. Expires ${end}.`;
}

/** Props of {@link TokenRows}. */
interface TokenRowsProps {
  /** The tokens, the newest first. */
  readonly tokens: readonly ApiTokenView[];
  /** Revokes a token. */
  readonly onRevoke: (tokenId: string) => void;
  /** Whether an intent is on its way. */
  readonly busy: boolean;
}

/**
 * One's tokens, each with its role, its use and Revoke.
 *
 * @param props - The tokens and the revoke callback.
 * @returns The list, or a line when there is none.
 */
function TokenRows({ tokens, onRevoke, busy }: TokenRowsProps) {
  if (tokens.length === 0) return <p className={styles.note}>You have no tokens.</p>;
  const now = Date.now();
  return (
    <ul className={styles.tokens}>
      {tokens.map((token) => (
        <li key={token.id}>
          <span className={styles.token}>
            <strong>{token.name}</strong>
            <span className={styles.note}>{`${token.role}. ${usageLine(token, now)}`}</span>
          </span>
          <Button size="small" disabled={busy} onClick={() => onRevoke(token.id)}>
            Revoke
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** Props of {@link NewTokenForm}. */
interface NewTokenFormProps {
  /** The strongest role a token of this person may have. */
  readonly ownRole: Role;
  /** The longest a token may last, in days. */
  readonly maxLifetimeDays: number;
  /** Makes the token. */
  readonly onCreate: (token: { name: string; role: Role; expiresInDays: number }) => void;
  /** Whether an intent is on its way. */
  readonly busy: boolean;
}

/**
 * The lifetimes a person may choose: the usual ones up to the longest allowed, and that one.
 *
 * @param maxLifetimeDays - The longest a token may last.
 * @returns The options, shortest first.
 */
function lifetimeOptions(maxLifetimeDays: number) {
  const days = [
    ...new Set([...lifetimes.filter((each) => each < maxLifetimeDays), maxLifetimeDays]),
  ];
  return days.map((each) => ({
    value: String(each),
    label: each === 1 ? '1 day' : `${each} days`,
  }));
}

/**
 * The form that makes a token: its name, its role and how long it lasts.
 *
 * @param props - The person's role, the longest lifetime and the create callback.
 * @returns The form.
 */
function NewTokenForm({ ownRole, maxLifetimeDays, onCreate, busy }: NewTokenFormProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [days, setDays] = useState(String(Math.min(30, maxLifetimeDays)));
  const create = (event: FormEvent) => {
    event.preventDefault();
    onCreate({ name, role, expiresInDays: Number(days) });
    setName('');
  };
  return (
    <form className={styles.form} onSubmit={create}>
      <Input
        label="Name"
        hint="What it is for, such as the assistant that uses it."
        required
        maxLength={80}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <div className={styles.pair}>
        <RoleSelect ownRole={ownRole} role={role} onChange={setRole} />
        <Select
          label="Lasts"
          options={lifetimeOptions(maxLifetimeDays)}
          value={days}
          onChange={(event) => setDays(event.target.value)}
        />
      </div>
      <Button type="submit" variant="primary" disabled={busy || name.trim() === ''}>
        Make a token
      </Button>
    </form>
  );
}

/** Props of {@link RoleSelect}. */
interface RoleSelectProps {
  /** The strongest role on offer: the person's own. */
  readonly ownRole: Role;
  /** The role chosen. */
  readonly role: Role;
  /** Called with the role picked. */
  readonly onChange: (role: Role) => void;
}

/**
 * The role of a new token: any role up to the person's own.
 *
 * @param props - The person's role, the role chosen and the change callback.
 * @returns The select.
 */
function RoleSelect({ ownRole, role, onChange }: RoleSelectProps) {
  const options = roles
    .filter((each) => hasRole(ownRole, each))
    .map((each) => ({ value: each, label: each }));
  return (
    <Select
      label="Role"
      options={options}
      value={role}
      onChange={(event) => onChange(event.target.value as Role)}
    />
  );
}

/**
 * What the last intent gave: the token just made, or why it was refused.
 *
 * @param props - The outcome.
 * @param props.outcome - The last outcome, if any.
 * @returns The box or the refusal, or nothing.
 */
function LastOutcome({ outcome }: { readonly outcome: TokenOutcome | undefined }) {
  if (outcome?.ok === false) return <p className={styles.error}>{outcome.message}</p>;
  return outcome?.created ? <CreatedBox created={outcome.created} /> : null;
}

/** Props of {@link TokensIntro}. */
interface TokensIntroProps {
  /** Whether the MCP endpoint answers. */
  readonly enabled: boolean;
}

/**
 * What a token is, where an assistant connects with one, and whether an admin has turned the MCP
 * server off.
 *
 * @param props - Whether the MCP endpoint answers.
 * @returns The lines.
 */
function TokensIntro({ enabled }: TokensIntroProps) {
  return (
    <>
      <p className={styles.note}>
        A token lets an assistant that speaks MCP read quanthea as you, with the role you give it.
        It connects to <code>{`${window.location.origin}/api/mcp`}</code> and sends the token as{' '}
        <code>Authorization: Bearer</code>.
      </p>
      <p className={styles.note}>
        It reads pinned dashboards, alerts and reports, each through its connector’s access level,
        and changes nothing. The token opens nothing else in quanthea.
      </p>
      {!enabled && <p className={styles.error}>An admin has turned the MCP server off.</p>}
    </>
  );
}

/**
 * One's MCP tokens: what a token is, the tokens, and the form to make one. With tokens turned
 * off, it says so and offers only Revoke.
 *
 * @param props - Who is signed in.
 * @param props.principal - Who is signed in.
 * @returns The dialog's content.
 */
export function ApiTokensForm({ principal }: { readonly principal: Principal }) {
  const list = useTokenList();
  const { submit, busy, outcome } = useTokenIntent();
  if (!list) return <p className={styles.note}>Loading…</p>;
  const { mcp: enabled, maxLifetimeDays } = list.settings;
  return (
    <div className={styles.dialog}>
      <TokensIntro enabled={enabled} />
      <TokenRows
        tokens={list.tokens}
        busy={busy}
        onRevoke={(tokenId) => submit({ intent: 'revoke', tokenId })}
      />
      <LastOutcome outcome={outcome} />
      {enabled && (
        <NewTokenForm
          ownRole={principal.role}
          maxLifetimeDays={maxLifetimeDays}
          busy={busy}
          onCreate={(token) => submit({ intent: 'create', ...token })}
        />
      )}
    </div>
  );
}
