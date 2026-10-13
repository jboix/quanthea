import { useState } from 'react';
import { Banner } from '../../ui/banner.tsx';
import { Button } from '../../ui/button.tsx';
import { WarningIcon } from '../../ui/icons.tsx';
import { type WriteAccess, writeHeadline } from './write-access.ts';
import styles from './write-warning.module.css';

/**
 * The statements that make an account that only reads, with a button that copies them.
 *
 * @param props - The statements.
 * @param props.setup - The statements, as the connector kind gives them.
 * @returns The block.
 */
function ReadOnlySetup({ setup }: { readonly setup: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(setup);
    setCopied(true);
  };
  return (
    <div className={styles.setup}>
      <pre className={styles.statements}>
        <code>{setup}</code>
      </pre>
      <Button size="small" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

/**
 * What to do about credentials that can write: the account to create, when the kind gives one.
 *
 * @param props - The statements.
 * @param props.setup - The statements, if the kind gives them.
 * @returns The advice.
 */
function WhatToDo({ setup }: { readonly setup: string | undefined }) {
  if (setup === undefined)
    return (
      <p className={styles.text}>
        Give the connector an account that can only read, if the source has one.
      </p>
    );
  return (
    <>
      <p className={styles.text}>
        Create an account that can only read, and use it for this connector. Change the name, the
        password and what it reads to fit:
      </p>
      <ReadOnlySetup setup={setup} />
    </>
  );
}

/**
 * The warning on a connector's page when its credentials can do more than read, and the note
 * when the source cannot say. It is advice: the connector is saved and used as it is.
 *
 * @param props - What the last connection test said.
 * @param props.access - What to show about writing.
 * @returns The warning, the note, or nothing.
 */
export function WriteWarning({ access }: { readonly access: WriteAccess }) {
  if (access.state === 'quiet') return null;
  if (access.state === 'unknown')
    return (
      <section className={styles.note} aria-label="Whether the credentials can write">
        <p className={styles.text}>
          The connection test could not tell whether these credentials can write. quanthea only
          reads, but an account that can only read is the guarantee.
        </p>
        <WhatToDo setup={access.setup} />
      </section>
    );
  return (
    <section className={styles.warning} aria-label="The credentials can write">
      <Banner tone="warning" icon={<WarningIcon />}>
        <strong className={styles.headline}>{writeHeadline}</strong>
      </Banner>
      <div className={styles.body}>
        {access.canDo.length > 0 && (
          <ul className={styles.findings}>
            {access.canDo.map((finding) => (
              <li key={finding}>{finding}</li>
            ))}
          </ul>
        )}
        <p className={styles.text}>
          quanthea only reads, and refuses a query that is not a read. A model writes the queries,
          so an account that cannot write is the guarantee. Nothing is blocked: the connector works
          as it is.
        </p>
        <WhatToDo setup={access.setup} />
      </div>
    </section>
  );
}
