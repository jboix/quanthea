import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Href } from './links.ts';

/**
 * A link from a cell or a stat: in the app, or to a page outside it in a new tab that learns
 * neither the page it came from nor a way back to it.
 *
 * @param props - Where it leads, its class and what it wraps.
 * @param props.to - Where it leads.
 * @param props.className - Its class.
 * @param props.children - What it wraps.
 * @returns The link.
 */
export function LinkTo({
  to,
  className,
  children,
}: {
  readonly to: Href;
  readonly className: string | undefined;
  readonly children: ReactNode;
}) {
  if (!to.external)
    return (
      <Link to={to.href} className={className}>
        {children}
      </Link>
    );
  return (
    <a href={to.href} className={className} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
