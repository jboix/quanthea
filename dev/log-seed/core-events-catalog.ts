/**
 * What the synthetic player events draw from: the media that are played, and what a session on
 * each platform looks like. The media list is the one list of media ids in the dev environment.
 */

/** A media a session plays, as every event of the session carries it. */
export interface CoreMedia {
  /** The id. Mapping: keyword. */
  readonly id: string;
  /** The business unit that publishes it. Mapping: keyword. */
  readonly bu: string;
  /** Mapping: keyword. */
  readonly type: 'video' | 'audio';
  /** Whether it comes from the sports feed. Mapping: boolean. */
  readonly swisstxt: boolean;
  /** The page that embeds the player. Mapping: keyword. */
  readonly origin: string;
  /** The origin's short name. Mapping: keyword. */
  readonly short_origin: string;
}

/** The business units, each with the page its player is embedded in. */
const units = [
  { bu: 'north', origin: 'https://play.north.example', short_origin: 'play-north' },
  { bu: 'south', origin: 'https://play.south.example', short_origin: 'play-south' },
  { bu: 'east', origin: 'https://play.east.example', short_origin: 'play-east' },
  { bu: 'west', origin: 'https://play.west.example', short_origin: 'play-west' },
] as const;

/** The kinds of media of each business unit: two videos, one of them from the sports feed, and an audio. */
const kinds = [
  { type: 'video', swisstxt: false },
  { type: 'video', swisstxt: true },
  { type: 'audio', swisstxt: false },
] as const;

/** Every media of the dev environment: three per business unit. */
export const coreMedia: readonly CoreMedia[] = units.flatMap((unit, unitIndex) =>
  kinds.map((kind, kindIndex) => ({
    id: `urn:${unit.bu}:${kind.type}:${1000 + unitIndex * 100 + kindIndex}`,
    ...unit,
    ...kind,
  })),
);

/** A name and the versions in use, the most common first. */
export interface Versioned {
  /** The name. */
  readonly name: string;
  /** The versions. */
  readonly versions: readonly string[];
}

/** A device model, with the operating system it runs and its screen. */
export interface DeviceModel {
  /** The model. */
  readonly model: string;
  /** `desktop`, `phone`, `tablet` or `tv`. */
  readonly type: string;
  /** Its operating system. */
  readonly os: Versioned;
  /** The screen width, in pixels. */
  readonly width: number;
  /** The screen height, in pixels. */
  readonly height: number;
}

/** What a session on one platform looks like. */
export interface PlatformProfile {
  /** The platform. */
  readonly platform: 'Web' | 'Apple' | 'Android';
  /** The share of the sessions on it. */
  readonly share: number;
  /** How much of the incident's technical errors reach it, 0 to 1. */
  readonly exposure: number;
  /** The player. */
  readonly player: Versioned;
  /** The application's id and versions. */
  readonly application: Versioned;
  /** The browsers, or the web view of an application. */
  readonly browsers: readonly Versioned[];
  /** The devices. */
  readonly devices: readonly DeviceModel[];
}

/** Windows, as desktops run it. */
const windows: Versioned = { name: 'Windows', versions: ['11', '10'] };

/** macOS. */
const macos: Versioned = { name: 'macOS', versions: ['15.5', '14.7', '13.6'] };

/** iOS. */
const ios: Versioned = { name: 'iOS', versions: ['18.5', '17.2', '17.6', '16.7'] };

/** Android. */
const android: Versioned = { name: 'Android', versions: ['15', '14', '13', '12'] };

/** The three platforms. Their shares add up to 1. */
export const platformProfiles: readonly PlatformProfile[] = [
  {
    platform: 'Web',
    share: 0.5,
    exposure: 1,
    player: { name: 'web-player', versions: ['4.0.0', '3.3.1', '3.2.0'] },
    application: { name: 'web-portal', versions: ['2026.9.1', '2026.8.3'] },
    browsers: [
      { name: 'Chrome', versions: ['139.0', '138.0', '137.0'] },
      { name: 'Safari', versions: ['18.5', '17.6'] },
      { name: 'Firefox', versions: ['141.0', '140.0'] },
      { name: 'Edge', versions: ['139.0', '138.0'] },
    ],
    devices: [
      { model: 'PC', type: 'desktop', os: windows, width: 1920, height: 1080 },
      { model: 'Mac', type: 'desktop', os: macos, width: 1440, height: 900 },
      {
        model: 'Linux PC',
        type: 'desktop',
        os: { name: 'Linux', versions: ['6.12'] },
        width: 2560,
        height: 1440,
      },
      { model: 'Pixel 9', type: 'phone', os: android, width: 412, height: 915 },
    ],
  },
  {
    platform: 'Apple',
    share: 0.3,
    exposure: 0.4,
    player: { name: 'apple-player', versions: ['9.1.0', '9.0.2', '8.4.0'] },
    application: { name: 'ios-app', versions: ['5.2.0', '5.1.1', '5.0.0'] },
    browsers: [{ name: 'WebKit', versions: ['620.1', '619.2'] }],
    devices: [
      { model: 'iPhone 16', type: 'phone', os: ios, width: 393, height: 852 },
      { model: 'iPhone 14', type: 'phone', os: ios, width: 390, height: 844 },
      {
        model: 'iPad Air',
        type: 'tablet',
        os: { name: 'iPadOS', versions: ['18.5', '17.6'] },
        width: 820,
        height: 1180,
      },
      {
        model: 'Apple TV 4K',
        type: 'tv',
        os: { name: 'tvOS', versions: ['18.4', '17.5'] },
        width: 3840,
        height: 2160,
      },
    ],
  },
  {
    platform: 'Android',
    share: 0.2,
    exposure: 0.4,
    player: { name: 'android-player', versions: ['7.3.0', '7.2.1', '6.9.0'] },
    application: { name: 'android-app', versions: ['4.8.0', '4.7.2'] },
    browsers: [{ name: 'Chrome WebView', versions: ['139.0', '137.0'] }],
    devices: [
      { model: 'Pixel 9', type: 'phone', os: android, width: 412, height: 915 },
      { model: 'Galaxy S24', type: 'phone', os: android, width: 360, height: 780 },
      { model: 'Galaxy Tab S9', type: 'tablet', os: android, width: 800, height: 1280 },
      { model: 'Android TV', type: 'tv', os: android, width: 1920, height: 1080 },
    ],
  },
];

/** Why a media is blocked. */
export const blockReasons = ['GEOBLOCK', 'STARTDATE', 'ENDDATE', 'LEGAL'] as const;

/** The technical errors of a player, each with what its log says. */
export const technicalErrors = [
  { error_type: 'NetworkError', log: 'segment request failed with status 503' },
  { error_type: 'NetworkError', log: 'manifest request timed out after 10000 ms' },
  { error_type: 'DecodeError', log: 'video decoder failed on a corrupt frame' },
  { error_type: 'DrmError', log: 'licence server refused the request' },
] as const;
