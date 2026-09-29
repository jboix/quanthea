import { useState } from 'react';
import { Input } from '../../ui/input.tsx';
import styles from './account.module.css';
import type { AccountOutcome } from './data.ts';

/**
 * A new password typed twice.
 *
 * @returns The password, the repeat, their setters, and whether they differ.
 */
export function useNewPassword() {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const mismatch = again !== '' && again !== password ? 'The two passwords differ.' : undefined;
  return { password, setPassword, again, setAgain, mismatch };
}

/**
 * The fields of a new password, twice, with the policy as a hint.
 *
 * @param props - The new password's state, and the server's refusal of it.
 * @param props.state - The state from {@link useNewPassword}.
 * @param props.error - Why the server refused the password, if it did.
 * @returns The fields.
 */
export function NewPasswordFields({
  state,
  error,
}: {
  readonly state: ReturnType<typeof useNewPassword>;
  readonly error: string | undefined;
}) {
  return (
    <>
      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        hint="At least 12 characters. Not your name or email, nor a common password."
        error={error}
        value={state.password}
        onChange={(event) => state.setPassword(event.target.value)}
      />
      <Input
        label="The same again"
        type="password"
        autoComplete="new-password"
        required
        error={state.mismatch}
        value={state.again}
        onChange={(event) => state.setAgain(event.target.value)}
      />
    </>
  );
}

/**
 * A refusal the fields do not show: one without problems by field.
 *
 * @param props - The refusal.
 * @param props.refusal - The refused outcome, if any.
 * @returns The message, or nothing.
 */
export function FormRefusal({
  refusal,
}: {
  readonly refusal: Extract<AccountOutcome, { ok: false }> | undefined;
}) {
  if (!refusal || Object.keys(refusal.fields).length > 0) return null;
  return (
    <p className={styles.error} role="alert">
      {refusal.message}
    </p>
  );
}
