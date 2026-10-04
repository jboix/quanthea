/** Settings → Alerts: how many alerts may be active per connector, for admins. */
import type { AlertSettings } from '@quanthea/shared';
import { useState } from 'react';
import { type SubmitTarget, useFetcher, useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Input } from '../../ui/input.tsx';
import { Page } from '../../ui/page.tsx';
import styles from './alert.module.css';
import type { AlertOutcome } from './data.ts';

/** The most a connector may have. */
const highest = 10_000;

/**
 * Reads the typed maximum.
 *
 * @param text - What is typed.
 * @returns The number, or `undefined` when it is not a whole number from 1 to 10,000.
 */
function maximumOf(text: string): number | undefined {
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= highest ? value : undefined;
}

/**
 * The Settings → Alerts screen.
 *
 * @returns The screen.
 */
export function AlertSettingsScreen() {
  const saved = useLoaderData() as AlertSettings;
  const [text, setText] = useState(String(saved.maxActivePerConnector));
  const fetcher = useFetcher<AlertOutcome>();
  const maximum = maximumOf(text);
  const changed = maximum !== undefined && maximum !== saved.maxActivePerConnector;
  const save = () => {
    const body: AlertSettings = { maxActivePerConnector: maximum ?? 1 };
    void fetcher.submit(body as SubmitTarget, { method: 'post', encType: 'application/json' });
  };
  return (
    <Page title="Alerts" subtitle="Limits on the alerts the server evaluates.">
      <Card
        title="Active alerts per connector"
        description="Each active alert runs its query on its connector at every interval. Past this many on one connector, activating another is refused."
      >
        <div className={styles.form}>
          <Input
            label="At most"
            type="number"
            min={1}
            max={highest}
            mono
            value={text}
            error={maximum === undefined ? 'A whole number from 1 to 10,000.' : undefined}
            onChange={(event) => setText(event.target.value)}
          />
          {fetcher.data?.ok === false && (
            <p className={styles.chartError}>{fetcher.data.message}</p>
          )}
          {fetcher.data?.ok === true && !changed && <p className={styles.chartNote}>Saved.</p>}
          <Button variant="primary" disabled={!changed || fetcher.state !== 'idle'} onClick={save}>
            Save
          </Button>
        </div>
      </Card>
    </Page>
  );
}
