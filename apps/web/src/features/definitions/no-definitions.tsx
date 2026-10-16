import { BookIcon } from '../../ui/icons.tsx';
import styles from './no-definitions.module.css';

/**
 * The screen before the first definition: what a definition is for, with examples.
 *
 * @param props - Whether the person may write one.
 * @param props.canEdit - Whether the person may write definitions.
 * @returns The empty state.
 */
export function NoDefinitions({ canEdit }: { readonly canEdit: boolean }) {
  return (
    <section className={styles.blank} aria-label="No definitions yet">
      <span className={styles.blankIcon}>
        <BookIcon />
      </span>
      <h2>Say once what your terms mean</h2>
      <p>
        “Revenue”, “failure rate”, “active customer”: each team means something exact by them. A
        definition writes it down once, so every dashboard the agent builds counts the same way.
      </p>
      <ul className={styles.examples}>
        <li>
          <strong>Failure rate</strong> The share of orders whose status is failed, out of all
          orders.
        </li>
        <li>
          <strong>Revenue</strong> The sum of what customers paid, cancelled orders left out.
        </li>
        <li>
          <strong>Production traffic</strong> Only the requests of the prod environment.
        </li>
      </ul>
      {canEdit && (
        <p className={styles.blankHint}>
          Describe your terms to the assistant, or paste your glossary: it checks them against your
          data and proposes them for you to save.
        </p>
      )}
    </section>
  );
}
