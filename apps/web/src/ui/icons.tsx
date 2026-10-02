import type { ReactNode } from 'react';

/** Props of {@link Icon}. */
interface IconProps {
  /** The SVG shapes, drawn on a 24×24 grid. */
  readonly children: ReactNode;
  /** The rendered width and height in pixels. */
  readonly size?: number;
}

/**
 * quanthea's outline icon style: 1.8 px round strokes in the current text colour. Icons
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
 * A square speech bubble with two lines of text, for threads.
 *
 * @returns The icon.
 */
export function ThreadsIcon() {
  return (
    <Icon>
      <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M8 9h8M8 12.5h5" />
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

/**
 * A clock turning back, for past threads.
 *
 * @returns The icon, drawn at 18 px.
 */
export function HistoryIcon() {
  return (
    <Icon size={18}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}

/**
 * A small downward chevron, for dropdowns.
 *
 * @returns The icon.
 */
export function ChevronDownIcon() {
  return (
    <Icon size={14}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

/**
 * An i in a circle, for where something comes from.
 *
 * @returns The icon.
 */
export function InfoIcon() {
  return (
    <Icon size={16}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5v.5" />
    </Icon>
  );
}

/**
 * A question mark in a circle, for what something is about.
 *
 * @returns The icon.
 */
export function QuestionIcon() {
  return (
    <Icon size={18}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.4M12 16.8v.2" />
    </Icon>
  );
}

/**
 * A magnifying glass, for search.
 *
 * @returns The icon.
 */
export function SearchIcon() {
  return (
    <Icon size={18}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Icon>
  );
}

/**
 * A branch splitting in two, for a dashboard copied from another.
 *
 * @returns The icon.
 */
export function VariantIcon() {
  return (
    <Icon size={16}>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="8" r="2" />
      <path d="M6 7v10M18 10c0 4-6 3-12 7" />
    </Icon>
  );
}

/**
 * A push pin, for a thread whose dashboard is pinned.
 *
 * @returns The icon.
 */
export function PinIcon() {
  return (
    <Icon size={14}>
      <path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6ZM12 15v5" />
    </Icon>
  );
}

/**
 * Two arrows turning in a circle, for running again.
 *
 * @returns The icon.
 */
export function RefreshIcon() {
  return (
    <Icon size={16}>
      <path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9" />
      <path d="M18.5 3v4.2h-4.2M5.5 21v-4.2h4.2" />
    </Icon>
  );
}

/**
 * Three dots in a row, for a menu of more actions.
 *
 * @returns The icon.
 */
export function MoreIcon() {
  return (
    <Icon size={18}>
      <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />
    </Icon>
  );
}

/**
 * Two overlapping sheets, for a copy.
 *
 * @returns The icon.
 */
export function CopyIcon() {
  return (
    <Icon size={16}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </Icon>
  );
}

/**
 * A camera, for a snapshot.
 *
 * @returns The icon.
 */
export function CameraIcon() {
  return (
    <Icon size={16}>
      <path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </Icon>
  );
}

/**
 * A person's head and shoulders, for one's account.
 *
 * @returns The icon.
 */
export function UserIcon() {
  return (
    <Icon>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </Icon>
  );
}
