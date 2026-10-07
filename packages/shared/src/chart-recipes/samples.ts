/**
 * Small, obviously fake datasets the recipes draw from on their own, with no connector. Values
 * come from a seeded generator, so every run draws the same.
 */
import type { Cell, Dataset, DimensionType } from '../dataset/contract.ts';

/**
 * A seeded generator of numbers from 0 to 1 (mulberry32).
 *
 * @param seed - The seed.
 * @returns The generator.
 */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A dataset from column names, their types and rows.
 *
 * @param columns - The columns, as name and type.
 * @param source - The rows.
 * @returns The dataset.
 */
function table(columns: readonly [string, DimensionType][], source: Cell[][]): Dataset {
  return { dimensions: columns.map(([name, type]) => ({ name, type })), source };
}

/** Monday 5 January 2026, 00:00 UTC: where fake time starts. */
const start = Date.UTC(2026, 0, 5);

/** An hour and a day, in milliseconds. */
const [hour, day] = [3_600_000, 86_400_000];

/**
 * Rounds to two decimals.
 *
 * @param value - A number.
 * @returns The rounded number.
 */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Requests per second of three fake services, every hour for 16 hours: a long table. */
export const trafficLong: Dataset = (() => {
  const random = seeded(1);
  const services = [
    ['web', 120],
    ['api', 80],
    ['batch', 30],
  ] as const;
  const rows = Array.from({ length: 16 }, (_hour, index) =>
    services.map(([name, base]) => {
      const wave = Math.sin((index / 16) * Math.PI) * base * 0.6;
      return [start + index * hour, name, round(base + wave + random() * base * 0.2)];
    }),
  ).flat();
  return table(
    [
      ['time', 'time'],
      ['service', 'string'],
      ['requests', 'number'],
    ],
    rows,
  );
})();

/** Daily revenue of two fake products and the orders behind it, for 14 days: a wide table. */
export const revenueWide: Dataset = (() => {
  const random = seeded(2);
  const rows = Array.from({ length: 14 }, (_day, index) => [
    start + index * day,
    round(4000 + index * 120 + random() * 900),
    round(2500 + random() * 700),
    Math.round(90 + random() * 40),
  ]);
  return table(
    [
      ['day', 'time'],
      ['Alpha', 'number'],
      ['Beta', 'number'],
      ['orders', 'number'],
    ],
    rows,
  );
})();

/** Sales of fake regions: one number per category. */
export const regionSales: Dataset = table(
  [
    ['region', 'string'],
    ['sales', 'number'],
    ['target', 'number'],
  ],
  [
    ['North', 820, 900],
    ['South', 640, 600],
    ['East', 510, 550],
    ['West', 470, 500],
    ['Central', 330, 300],
    ['Islands', 120, 150],
  ],
);

/** Sales of fake regions by channel: a long table of categories. */
export const channelSales: Dataset = table(
  [
    ['region', 'string'],
    ['channel', 'string'],
    ['sales', 'number'],
  ],
  ['North', 'South', 'East', 'West'].flatMap((region, index) => [
    [region, 'Online', 300 + index * 40],
    [region, 'Store', 420 - index * 60],
    [region, 'Partner', 90 + index * 15],
  ]),
);

/** Response times of three fake endpoints, 16 each: raw values with a group. */
export const latencyValues: Dataset = (() => {
  const random = seeded(3);
  const rows = (['/login', '/search', '/checkout'] as const).flatMap((endpoint, group) =>
    Array.from({ length: 16 }, () => [
      endpoint,
      round(40 + group * 35 + random() * 60 + (random() > 0.9 ? 150 : 0)),
    ]),
  );
  return table(
    [
      ['endpoint', 'string'],
      ['ms', 'number'],
    ],
    rows,
  );
})();

/** Fake errors by weekday and hour band: a matrix. */
export const weekMatrix: Dataset = (() => {
  const random = seeded(4);
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const bands = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'];
  const rows = days.flatMap((name, index) =>
    bands.map((band, at) => [
      band,
      name,
      Math.round((at > 1 && at < 5 ? 40 : 10) + random() * 25 - index),
    ]),
  );
  return table(
    [
      ['hours', 'string'],
      ['weekday', 'string'],
      ['errors', 'number'],
    ],
    rows,
  );
})();

/** Fake daily sign-ups for 49 days, for calendars and sparklines. */
export const dailyCounts: Dataset = (() => {
  const random = seeded(5);
  const rows = Array.from({ length: 49 }, (_day, index) => [
    start + index * day,
    Math.round(20 + index * 0.8 + random() * 30 - (index % 7 > 4 ? 15 : 0)),
  ]);
  return table(
    [
      ['day', 'time'],
      ['signups', 'number'],
    ],
    rows,
  );
})();

/** A fake budget by department and team: a hierarchy. */
export const budgetTree: Dataset = table(
  [
    ['department', 'string'],
    ['team', 'string'],
    ['budget', 'number'],
  ],
  [
    ['Engineering', 'Platform', 420],
    ['Engineering', 'Product', 380],
    ['Engineering', 'Data', 210],
    ['Sales', 'Field', 300],
    ['Sales', 'Inside', 160],
    ['Marketing', 'Brand', 140],
    ['Marketing', 'Growth', 190],
    ['Operations', 'Support', 170],
    ['Operations', 'Finance', 90],
  ],
);

/** Fake visitor flows between pages: links. */
export const pageFlows: Dataset = table(
  [
    ['from', 'string'],
    ['to', 'string'],
    ['visits', 'number'],
  ],
  [
    ['Home', 'Search', 520],
    ['Home', 'Deals', 310],
    ['Search', 'Product', 430],
    ['Deals', 'Product', 240],
    ['Product', 'Cart', 330],
    ['Product', 'Exit', 340],
    ['Cart', 'Checkout', 210],
    ['Cart', 'Exit', 120],
    ['Checkout', 'Paid', 180],
  ],
);

/** Fake funnel stages. */
export const funnelStages: Dataset = table(
  [
    ['stage', 'string'],
    ['people', 'number'],
  ],
  [
    ['Visited', 1000],
    ['Signed up', 420],
    ['Activated', 260],
    ['Subscribed', 90],
    ['Renewed', 60],
  ],
);

/** Fake values by country, named as on the world map. */
export const countryValues: Dataset = table(
  [
    ['country', 'string'],
    ['customers', 'number'],
  ],
  [
    ['United States of America', 920],
    ['Canada', 210],
    ['Brazil', 340],
    ['United Kingdom', 380],
    ['France', 300],
    ['Germany', 410],
    ['Spain', 260],
    ['India', 520],
    ['China', 610],
    ['Japan', 280],
    ['Australia', 190],
    ['South Africa', 120],
    ['Mexico', 230],
    ['Nigeria', 90],
  ],
);

/** Fake offices at latitude and longitude. */
export const cityPoints: Dataset = table(
  [
    ['office', 'string'],
    ['lat', 'number'],
    ['lon', 'number'],
    ['staff', 'number'],
  ],
  [
    ['Barcelona', 41.39, 2.17, 120],
    ['London', 51.51, -0.13, 240],
    ['New York', 40.71, -74.01, 310],
    ['São Paulo', -23.55, -46.63, 90],
    ['Tokyo', 35.68, 139.69, 150],
    ['Sydney', -33.87, 151.21, 60],
    ['Nairobi', -1.29, 36.82, 40],
    ['Toronto', 43.65, -79.38, 80],
  ],
);

/** A fake price, day by day for 30 days: open, close, low, high. */
export const pricesOhlc: Dataset = (() => {
  const random = seeded(6);
  let close = 100;
  const rows = Array.from({ length: 30 }, (_day, index) => {
    const open = close;
    close = round(open + (random() - 0.48) * 6);
    const low = round(Math.min(open, close) - random() * 3);
    const high = round(Math.max(open, close) + random() * 3);
    return [start + index * day, open, close, low, high];
  });
  return table(
    [
      ['day', 'time'],
      ['open', 'number'],
      ['close', 'number'],
      ['low', 'number'],
      ['high', 'number'],
    ],
    rows,
  );
})();

/** Fake servers with several measures each, for scatter plots and parallel axes. */
export const serverMeasures: Dataset = (() => {
  const random = seeded(7);
  const rows = Array.from({ length: 24 }, (_server, index) => {
    const cpu = round(10 + random() * 80);
    return [
      ['eu', 'us', 'asia'][index % 3] ?? 'asia',
      cpu,
      round(cpu * 1.8 + random() * 40),
      round(1 + random() * 15),
      Math.round(20 + random() * 200),
    ];
  });
  return table(
    [
      ['zone', 'string'],
      ['cpu', 'number'],
      ['latency', 'number'],
      ['errors', 'number'],
      ['requests', 'number'],
    ],
    rows,
  );
})();

/** Fake scores of two teams on five skills: a long table of categories. */
export const skillScores: Dataset = table(
  [
    ['skill', 'string'],
    ['team', 'string'],
    ['score', 'number'],
  ],
  [
    ['Speed', 'Red', 80],
    ['Quality', 'Red', 65],
    ['Cost', 'Red', 70],
    ['Support', 'Red', 55],
    ['Scale', 'Red', 90],
    ['Speed', 'Blue', 60],
    ['Quality', 'Blue', 85],
    ['Cost', 'Blue', 75],
    ['Support', 'Blue', 80],
    ['Scale', 'Blue', 50],
  ],
);

/** A fake budget walk: the changes from one month's total to the next. */
export const budgetChanges: Dataset = table(
  [
    ['step', 'string'],
    ['change', 'number'],
  ],
  [
    ['January', 1200],
    ['New deals', 340],
    ['Renewals', 180],
    ['Churn', -260],
    ['Refunds', -90],
    ['Upsell', 120],
  ],
);

/** A fake share of disk in use. */
export const diskUse: Dataset = table([['used', 'number']], [[0.72]]);
