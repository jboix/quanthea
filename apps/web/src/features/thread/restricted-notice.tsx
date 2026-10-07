import styles from './thread.module.css';

/**
 * The notice of a thread holding data that a connector's access now restricts: an access change
 * applies to new tool calls only, so continuing the thread resends that data to the provider.
 *
 * @returns The notice.
 */
export function RestrictedNotice() {
  return (
    <p className={styles.restricted} role="note">
      An admin restricted a connector after this thread read its data. Continuing the conversation
      resends that data to the model provider. Start a new thread to leave it out.
    </p>
  );
}
