import logoOnLightUrl from './brand/quanthea-logo.svg';
import logoOnDarkUrl from './brand/quanthea-logo-dark.svg';
import styles from './brand.module.css';

/** Accessible name of a brand graphic. Without one, the graphic is decorative and hidden. */
interface BrandLabel {
  /** The accessible name, such as "quanthea". Omit it when the surrounding control is named. */
  readonly label?: string;
}

/**
 * The shapes of the mark on the 64 × 64 grid of the brand files: a lens with a spike, a handle,
 * and the orange signal dot.
 *
 * @param props - The stroke colour of the lens, spike and handle.
 * @returns The SVG shapes.
 */
function MarkShapes({ stroke }: { readonly stroke: string }) {
  return (
    <>
      <circle cx="29" cy="29" r="16" fill="none" stroke={stroke} strokeWidth="5.5" />
      <polyline
        points="18,32 23,32 27.5,20 31,29 34,31"
        fill="none"
        stroke={stroke}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M37 37 L49 49" stroke={stroke} strokeWidth="5.5" strokeLinecap="round" />
      <circle cx="27.5" cy="20" r="3.4" className={styles.signal} />
    </>
  );
}

/** Props of {@link BrandMark}. */
interface BrandMarkProps extends BrandLabel {
  /** Width and height in pixels. */
  readonly size?: number;
}

/**
 * The bare mark (`quanthea-mark.svg`). The lens takes the current text colour; the dot stays orange.
 *
 * @param props - Size and optional accessible name.
 * @returns The SVG element.
 */
export function BrandMark({ size = 24, label }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="10 8 44 44"
      role="img"
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    >
      <MarkShapes stroke="currentColor" />
    </svg>
  );
}

/** Props of {@link BrandIcon}. */
interface BrandIconProps extends BrandLabel {
  /** Width and height in pixels. */
  readonly size?: number;
  /** `accent` is the blue tile (`quanthea-icon.svg`), `ink` the near-black one (`quanthea-icon-dark.svg`). */
  readonly tone?: 'accent' | 'ink';
}

/**
 * The app icon: the mark in white on a rounded tile.
 *
 * @param props - Size, tile colour and optional accessible name.
 * @returns The SVG element.
 */
export function BrandIcon({ size = 32, tone = 'accent', label }: BrandIconProps) {
  const tileClass = tone === 'accent' ? styles.tileAccent : styles.tileInk;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    >
      <rect width="64" height="64" rx="14" className={tileClass} />
      <MarkShapes stroke="#ffffff" />
    </svg>
  );
}

/** Props of {@link Logo}. */
interface LogoProps {
  /** The surface it sits on: `light` uses ink lettering, `dark` white lettering. */
  readonly surface?: 'light' | 'dark';
  /** Height in pixels. The width follows the 228 × 64 artwork. */
  readonly height?: number;
}

/**
 * The full logo: the icon and the "quanthea" wordmark, from the brand files unchanged.
 *
 * @param props - The surface colour and the height.
 * @returns The image element, named "quanthea".
 */
export function Logo({ surface = 'light', height = 32 }: LogoProps) {
  return (
    <img
      src={surface === 'light' ? logoOnLightUrl : logoOnDarkUrl}
      alt="quanthea"
      height={height}
      width={Math.round((height * 228) / 64)}
      className={styles.logo}
    />
  );
}
