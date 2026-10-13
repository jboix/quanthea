import type { ConnectorDetail } from '@quanthea/shared';
import { type FormEvent, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Switch } from '../../ui/switch.tsx';
import { bucketScriptsEffect, bucketScriptsPatch } from './bucket-scripts.ts';
import styles from './connector.module.css';
import { failureOf, useConnectorChange } from './use-connector-change.ts';

/** Props of {@link BucketScriptsForm}. */
interface BucketScriptsFormProps {
  /** Whether the connector allows bucket scripts. */
  readonly stored: boolean;
  /** Whether the switch is on. */
  readonly draft: boolean;
  /** Flips the switch. */
  readonly onChange: (allowed: boolean) => void;
  /** Saves the switch. */
  readonly onSave: () => void;
  /** Whether a change is on its way. */
  readonly pending: boolean;
  /** Why the last change failed, if it did. */
  readonly failure: string | undefined;
}

/**
 * The card of the bucket scripts setting: the switch, what it does as it stands, what stays
 * refused either way, and a button that saves it.
 *
 * @param props - The stored value, the draft and the callbacks.
 * @returns The form.
 */
export function BucketScriptsForm(props: BucketScriptsFormProps) {
  const { stored, draft, onChange, onSave, pending, failure } = props;
  const save = (event: FormEvent) => {
    event.preventDefault();
    onSave();
  };
  return (
    <form className={styles.card} aria-labelledby="bucket-scripts-title" onSubmit={save}>
      <h4 id="bucket-scripts-title" className={styles.cardTitle}>
        Bucket scripts
      </h4>
      <Switch
        label="Allow a script in bucket_script and bucket_selector"
        description={bucketScriptsEffect(draft)}
        checked={draft}
        onChange={onChange}
      />
      <p className={styles.cardNote}>
        Off unless you allow it. Every script that reads documents stays refused either way, as
        listed under Always enforced.
      </p>
      {failure !== undefined && <p className={styles.cardNote}>{failure}</p>}
      <div className={styles.formActions}>
        <Button type="submit" variant="primary" disabled={stored === draft || pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

/**
 * The bucket scripts setting of a search connector, saved with a button.
 *
 * @param props - The connector.
 * @param props.connector - The connector.
 * @returns The card.
 */
export function BucketScriptsCard({ connector }: { readonly connector: ConnectorDetail }) {
  const change = useConnectorChange(connector.id);
  const [draft, setDraft] = useState(connector.bucketScripts);
  const save = () => {
    const patch = bucketScriptsPatch(connector.bucketScripts, draft);
    if (patch) change.submit({ intent: 'update', patch });
  };
  return (
    <BucketScriptsForm
      stored={connector.bucketScripts}
      draft={draft}
      onChange={setDraft}
      onSave={save}
      pending={change.pending}
      failure={failureOf(change.outcome, 'bucketScripts')}
    />
  );
}
