import { type Role, roles, type UserView } from '@quanthea/shared';
import { type FormEvent, useState } from 'react';
import { type SubmitTarget, useFetcher, useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Input } from '../../ui/input.tsx';
import { Page } from '../../ui/page.tsx';
import { Pill } from '../../ui/pill.tsx';
import { Select } from '../../ui/select.tsx';
import type { UsersData, UsersIntent, UsersOutcome } from './data.ts';
import styles from './users.module.css';

/** The role choices. */
const roleOptions = roles.map((role) => ({ value: role, label: role }));

/**
 * Submits users intents, and keeps the last outcome.
 *
 * @returns The submit function, whether one is on its way, and the outcome.
 */
function useUsersIntent() {
  const fetcher = useFetcher<UsersOutcome>();
  const submit = (intent: UsersIntent) =>
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  return { submit, busy: fetcher.state !== 'idle', outcome: fetcher.data };
}

/**
 * A link to hand to its person, with a copy button.
 *
 * @param props - The link.
 * @param props.link - The link, when an intent made one.
 * @returns The box, or nothing.
 */
function LinkBox({ link }: { readonly link: Extract<UsersOutcome, { ok: true }>['link'] }) {
  const [copied, setCopied] = useState(false);
  if (!link) return null;
  const until = new Date(link.expiresAt).toLocaleString();
  const copy = async () => {
    await navigator.clipboard.writeText(link.url);
    setCopied(true);
  };
  return (
    <div className={styles.link} role="status">
      <span>
        Send this link{link.name ? ` to ${link.name}` : ''}. It sets a password once, until {until}.
      </span>
      <div className={styles.linkRow}>
        <code className={styles.linkText}>{link.url}</code>
        <Button size="small" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

/**
 * The invite form's fields.
 *
 * @param props - What to submit.
 * @param props.onInvite - Submits the invite.
 * @param props.busy - Whether one is on its way.
 * @returns The form.
 */
function InviteForm({
  onInvite,
  busy,
}: {
  readonly onInvite: (person: { name: string; email: string; role: Role }) => void;
  readonly busy: boolean;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const invite = (event: FormEvent) => {
    event.preventDefault();
    onInvite({ name, email, role });
  };
  return (
    <form className={styles.invite} onSubmit={invite}>
      <Input label="Name" required value={name} onChange={(event) => setName(event.target.value)} />
      <Input
        label="Email"
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Select
        label="Role"
        options={roleOptions}
        value={role}
        onChange={(event) => setRole(event.target.value as Role)}
      />
      <Button type="submit" variant="primary" disabled={busy}>
        Invite
      </Button>
    </form>
  );
}

/**
 * The invite card: the form, then the link to send or why not.
 *
 * @returns The card.
 */
function InviteCard() {
  const { submit, busy, outcome } = useUsersIntent();
  return (
    <Card title="Invite someone" description="They choose their own password from the link.">
      <InviteForm busy={busy} onInvite={(person) => submit({ intent: 'invite', ...person })} />
      {outcome?.ok === false && <p className={styles.error}>{outcome.message}</p>}
      {outcome?.ok && <LinkBox link={outcome.link} />}
    </Card>
  );
}

/**
 * A user's state in words, and whether the configuration file manages them.
 *
 * @param props - The user.
 * @param props.user - The user.
 * @returns The pills.
 */
function StatePill({ user }: { readonly user: UserView }) {
  const state = stateOf(user);
  if (!user.managedBy) return state;
  return (
    <span className={styles.states} title={user.managedBy}>
      {state}
      <Pill tone="accent">from file</Pill>
    </span>
  );
}

/**
 * A user's state as a pill.
 *
 * @param user - The user.
 * @returns The pill.
 */
function stateOf(user: UserView) {
  if (user.disabled) return <Pill tone="danger">disabled</Pill>;
  if (!user.hasPassword) return <Pill tone="draft">invited</Pill>;
  return <Pill tone="ok">active</Pill>;
}

/**
 * What an admin can do to a user: a reset or invite link, signing them out, disabling them.
 *
 * @param props - The user, and the intent submitter.
 * @param props.user - The user.
 * @param props.submit - Submits an intent.
 * @param props.busy - Whether one is on its way.
 * @returns The buttons.
 */
function UserActions({
  user,
  submit,
  busy,
}: {
  readonly user: UserView;
  readonly submit: (intent: UsersIntent) => void;
  readonly busy: boolean;
}) {
  const userId = user.id;
  return (
    <div className={styles.actions}>
      <Button
        size="small"
        disabled={busy || user.disabled}
        onClick={() => submit({ intent: 'reset-link', userId })}
      >
        {user.hasPassword ? 'Reset link' : 'New invite link'}
      </Button>
      <Button
        size="small"
        disabled={busy}
        onClick={() => submit({ intent: 'end-sessions', userId })}
      >
        Sign out everywhere
      </Button>
      <Button
        size="small"
        variant={user.disabled ? 'secondary' : 'danger'}
        disabled={busy || user.managedBy !== undefined}
        onClick={() => submit({ intent: 'update', userId, disabled: !user.disabled })}
      >
        {user.disabled ? 'Enable' : 'Disable'}
      </Button>
    </div>
  );
}

/**
 * The line under a user after an intent: a link to send, or why not.
 *
 * @param props - The outcome.
 * @param props.outcome - The last outcome, if any.
 * @returns The row, or nothing.
 */
function OutcomeRow({ outcome }: { readonly outcome: UsersOutcome | undefined }) {
  if (!outcome || (outcome.ok && !outcome.link)) return null;
  return (
    <tr>
      <td colSpan={6}>
        {outcome.ok ? (
          <LinkBox link={outcome.link} />
        ) : (
          <p className={styles.error}>{outcome.message}</p>
        )}
      </td>
    </tr>
  );
}

/**
 * One user: their role, state, last sign-in, and what an admin can do.
 *
 * @param props - The user.
 * @param props.user - The user.
 * @returns The row, and any link or refusal under it.
 */
function UserRow({ user }: { readonly user: UserView }) {
  const { submit, busy, outcome } = useUsersIntent();
  const lastSignIn = user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleString() : 'never';
  const changeRole = (role: Role) => submit({ intent: 'update', userId: user.id, role });
  return (
    <>
      <tr data-disabled={user.disabled}>
        <td>{user.name}</td>
        <td>{user.email}</td>
        <td>
          <Select
            label={`Role of ${user.name}`}
            hideLabel
            options={roleOptions}
            value={user.role}
            disabled={busy || user.managedBy !== undefined}
            onChange={(event) => changeRole(event.target.value as Role)}
          />
        </td>
        <td>
          <StatePill user={user} />
        </td>
        <td>{lastSignIn}</td>
        <td>
          <UserActions user={user} submit={submit} busy={busy} />
        </td>
      </tr>
      <OutcomeRow outcome={outcome} />
    </>
  );
}

/**
 * Settings → Users: invite people, set their roles, disable them, reset their passwords.
 *
 * @returns The screen.
 */
export function UsersScreen() {
  const { users } = useLoaderData() as UsersData;
  return (
    <Page
      title="Users"
      subtitle="Viewers read pinned dashboards, editors build them, admins run querent."
    >
      <InviteCard />
      <Card title={users.length === 1 ? '1 user' : `${users.length} users`}>
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>State</th>
                <th>Last sign-in</th>
                <th>
                  <span className={styles.visuallyHidden}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <UserRow key={user.id} user={user} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}
