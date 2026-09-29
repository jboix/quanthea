import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import styles from './usage.module.css';
import type { PersonUsage } from './usage-people.ts';

/** How many people a page lists. */
const pageSize = 10;

/** Short numbers, such as 12.4K. */
const count = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** Dollars, with two significant digits. */
const money = new Intl.NumberFormat('en', {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 2,
});

/**
 * Previous and next, and where the page is.
 *
 * @param props - The page, how many there are, and the setter.
 * @param props.page - The page shown, from 0.
 * @param props.pages - How many pages there are.
 * @param props.onPage - Shows another page.
 * @returns The controls, or nothing for one page.
 */
function Pager({
  page,
  pages,
  onPage,
}: {
  readonly page: number;
  readonly pages: number;
  readonly onPage: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <div className={styles.pager}>
      <Button size="small" disabled={page === 0} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className={styles.pageOf}>
        {page + 1} of {pages}
      </span>
      <Button size="small" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </div>
  );
}

/**
 * Who spent what: one row per person who ran model steps, the costliest first, ten a page.
 *
 * @param props - The people.
 * @param props.people - What each person spent.
 * @returns The table.
 */
export function PeopleTable({ people }: { readonly people: readonly PersonUsage[] }) {
  const [page, setPage] = useState(0);
  if (people.length === 0) return <p className={styles.empty}>No model ran in this range.</p>;
  const pages = Math.ceil(people.length / pageSize);
  const shown = people.slice(page * pageSize, (page + 1) * pageSize);
  return (
    <>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Person</th>
            <th>Role</th>
            <th>Steps</th>
            <th>Tokens</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((person) => (
            <tr key={person.userId}>
              <td>{person.name}</td>
              <td>{person.role ?? '—'}</td>
              <td>{person.steps}</td>
              <td>{count.format(person.tokens)}</td>
              <td>{person.unpriced ? 'no price' : money.format(person.dollars)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager page={page} pages={pages} onPage={setPage} />
    </>
  );
}
