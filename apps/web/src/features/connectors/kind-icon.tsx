import type { ConnectorKindInfo } from '@quanthea/shared';
import type { CSSProperties } from 'react';
import styles from './kind-icon.module.css';
import { badgeTone, needsDarkGlyph } from './kinds.ts';

/** Props of {@link KindIcon}. */
interface KindIconProps {
  /** The kind identifier, which picks the tone of a badge without a logo. */
  readonly kind: string;
  /** The kind as the server describes it, when it still offers it. */
  readonly info: ConnectorKindInfo | undefined;
  /** The width and height in pixels; 32 by default. */
  readonly size?: number;
}

/**
 * A kind's badge: its logo on its brand colour, or the first letters of its name. It is
 * decorative: the name next to it says the same.
 *
 * @param props - The kind, its information and the size.
 * @returns The badge.
 */
export function KindIcon({ kind, info, size = 32 }: KindIconProps) {
  const box = { width: size, height: size } satisfies CSSProperties;
  if (!info?.icon) {
    return (
      <span className={styles.badge} data-tone={badgeTone(kind)} style={box} aria-hidden="true">
        {(info?.displayName ?? kind).slice(0, 2).toUpperCase()}
      </span>
    );
  }
  const glyph = needsDarkGlyph(info.icon.color) ? 'dark' : 'light';
  return (
    <span
      className={styles.badge}
      data-glyph={glyph}
      style={{ ...box, background: info.icon.color }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        width={Math.round(size * 0.7)}
        height={Math.round(size * 0.7)}
      >
        <path d={info.icon.path} fill="currentColor" />
      </svg>
    </span>
  );
}
