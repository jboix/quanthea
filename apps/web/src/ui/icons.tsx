import type { ReactNode } from 'react';

/** Props of {@link Icon}. */
interface IconProps {
  /** The SVG shapes, drawn on a 24×24 grid. */
  readonly children: ReactNode;
  /** The rendered width and height in pixels. */
  readonly size?: number;
}

/**
 * querent's outline icon style: 1.8 px round strokes in the current text colour. Icons
 * are decorative: the control that holds one carries the accessible name.
 *
 * @param props - The shapes and the size.
 * @returns The SVG element, hidden from assistive technology.
 */
function Icon({ children, size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/**
 * A speech bubble, for threads.
 *
 * @returns The icon.
 */
export function ThreadsIcon() {
  return (
    <Icon>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </Icon>
  );
}

/**
 * Four tiles, for the library.
 *
 * @returns The icon.
 */
export function LibraryIcon() {
  return (
    <Icon>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Icon>
  );
}

/**
 * A database cylinder, for connectors.
 *
 * @returns The icon.
 */
export function ConnectorsIcon() {
  return (
    <Icon>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </Icon>
  );
}

/**
 * Three sliders, for settings.
 *
 * @returns The icon.
 */
export function SettingsIcon() {
  return (
    <Icon>
      <path d="M4 6h10" />
      <circle cx="16" cy="6" r="2" />
      <path d="M4 12h4" />
      <path d="M12 12h8" />
      <circle cx="10" cy="12" r="2" />
      <path d="M4 18h12" />
      <circle cx="18" cy="18" r="2" />
    </Icon>
  );
}

/**
 * A waste bin, for binned dashboards.
 *
 * @returns The icon.
 */
export function BinIcon() {
  return (
    <Icon>
      <path d="M4 7h16" />
      <path d="M9 7V4.5h6V7" />
      <path d="M6 7l1 13h10l1-13" />
    </Icon>
  );
}

/**
 * A warning triangle, for the open-access banner.
 *
 * @returns The icon, drawn at 16 px.
 */
export function WarningIcon() {
  return (
    <Icon size={16}>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4" />
      <path d="M12 17.5v.01" />
    </Icon>
  );
}

/**
 * A check mark, for a passed check.
 *
 * @returns The icon, drawn at 16 px.
 */
export function CheckIcon() {
  return (
    <Icon size={16}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
  );
}

/**
 * A padlock, for read-only things.
 *
 * @returns The icon, drawn at 14 px.
 */
export function LockIcon() {
  return (
    <Icon size={14}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Icon>
  );
}
