/** The card of Settings → MCP access that revokes every token of everyone, after a confirmation. */
import { useState } from 'react';
import { type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import type { ApiAccessIntent, ApiAccessOutcome } from './data.ts';
import styles from './tokens.module.css';

/**
 * How many tokens a revocation stopped, in words.
 *
 * @param revoked - The number.
 * @returns The sentence.
 */
function revokedLine(revoked: number): string {
  if (revoked === 0) return 'There was no token to revoke.';
  return revoked === 1 ? 'Revoked 1 token.' : `Revoked ${revoked} tokens.`;
}

/**
 * Revoking every token.
 *
 * @returns The function that revokes, whether it runs, and how many the last one stopped.
 */
function useRevokeEvery() {
  const fetcher = useFetcher<ApiAccessOutcome>();
  const intent: ApiAccessIntent = { intent: 'revoke-every' };
  const revoke = () =>
    void fetcher.submit(intent as unknown as SubmitTarget, {
      method: 'post',
      encType: 'application/json',
    });
  const revoked = fetcher.data?.ok ? fetcher.data.revoked : undefined;
  return { revoke, revoked, busy: fetcher.state !== 'idle' };
}

/**
 * The card that revokes every token of everyone.
 *
 * @returns The card, with its confirmation dialog.
 */
export function RevokeEveryCard() {
  const [asking, setAsking] = useState(false);
  const { revoke, revoked, busy } = useRevokeEvery();
  const confirm = () => {
    setAsking(false);
    revoke();
  };
  return (
    <Card
      title="Revoke every token"
      description="For when a token may have leaked and you do not know which. Every token of every person stops at once. People make new ones from the account menu."
    >
      <div className={styles.revokeEvery}>
        <p className={styles.note}>{revoked === undefined ? '' : revokedLine(revoked)}</p>
        <Button variant="danger" disabled={busy} onClick={() => setAsking(true)}>
          {busy ? 'Revoking…' : 'Revoke every token'}
        </Button>
      </div>
      <Dialog title="Revoke every token?" open={asking} onClose={() => setAsking(false)}>
        <div className={styles.confirm}>
          <p className={styles.note}>
            Every assistant connected to quanthea stops reading until its owner makes a new token.
            This cannot be undone.
          </p>
          <div className={styles.actions}>
            <Button onClick={() => setAsking(false)}>Cancel</Button>
            <Button variant="danger" onClick={confirm}>
              Revoke every token
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
