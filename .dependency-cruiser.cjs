/**
 * dependency-cruiser rules for quanthea.
 *
 * Three kinds of rules live here:
 *   1. Hygiene: cycles, orphans, unresolvable and undeclared imports.
 *   2. Boundaries between the workspaces (web, server, shared, plugin-kit).
 *   3. Architecture rules inside each app, most importantly: the agent never
 *      sees connector output except through the access gate.
 *
 * If a rule gets in the way, change the architecture doc first, then the rule.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    // ---------------------------------------------------------------- hygiene
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make modules impossible to reason about in isolation.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'A module nothing imports is either dead or an entry point knip should know about.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|json)$',
          '[.]d[.]ts$',
          '(^|/)tsconfig[.]json$',
          '(^|/)[^/]+[.]config[.](?:js|cjs|mjs|ts)$',
          '[.]test[.]tsx?$',
          '^apps/server/src/main[.]ts$',
          '^apps/web/src/main[.]tsx$',
          // The website's modules are imported from .astro files, which dependency-cruiser does
          // not parse. knip, which reads .astro files, finds the unused ones.
          '^apps/site/src/',
        ],
      },
      to: {},
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment:
        'Bun built-ins (bun, bun:sqlite, bun:test) are provided by the runtime, not node_modules. ' +
        "The website's astro: modules are Astro's, and a ?raw import is a file Vite reads as text.",
      from: {},
      to: { couldNotResolve: true, pathNot: ['^bun$', '^bun:', '^astro:', '[?]raw$'] },
    },
    {
      name: 'no-non-package-json',
      severity: 'error',
      comment: 'Every npm import must be declared in the importing workspace package.json.',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment: 'Runtime code must not depend on devDependencies (types are fine).',
      from: {
        path: '^(apps|packages)/[^/]+/src',
        pathNot: ['[.]test[.]tsx?$', '/test/'],
      },
      to: {
        dependencyTypes: ['npm-dev'],
        dependencyTypesNot: ['type-only'],
        pathNot: ['node_modules/@types/'],
      },
    },
    {
      name: 'not-to-test',
      severity: 'error',
      comment: 'Production code never imports test code.',
      from: { pathNot: ['[.]test[.]tsx?$', '/test/'] },
      to: { path: ['[.]test[.]tsx?$', '/test/'] },
    },

    // ------------------------------------------------------ workspace boundaries
    {
      name: 'web-not-to-server',
      severity: 'error',
      comment:
        'The SPA and the server only share packages/shared (spec + API contract). Not even types: ' +
        'importing server source would make the browser build typecheck against Bun-only code.',
      from: { path: '^apps/web/' },
      to: { path: '^apps/server/' },
    },
    {
      name: 'server-not-to-web',
      severity: 'error',
      from: { path: '^apps/server/' },
      to: { path: '^apps/web/' },
    },
    {
      name: 'shared-is-a-leaf',
      severity: 'error',
      comment: 'packages/shared is imported by both apps and imports neither.',
      from: { path: '^packages/shared/' },
      to: { path: '^apps/' },
    },
    {
      name: 'shared-is-isomorphic',
      severity: 'error',
      comment:
        'shared runs in the browser too: no node: or bun: modules. Its tests run under bun test ' +
        'only and never ship, so they may import bun:test.',
      from: { path: '^packages/shared/', pathNot: ['[.]test[.]ts$'] },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'shared-no-bun-builtins',
      severity: 'error',
      from: { path: '^packages/shared/', pathNot: ['[.]test[.]ts$'] },
      to: { path: ['^bun$', '^bun:'] },
    },
    {
      name: 'shared-stays-pure',
      severity: 'error',
      comment:
        'shared holds schemas, contracts and pure functions. Its runtime dependencies are zod and ' +
        "the kit's contract entry (zod only too), so both apps can import any of it anywhere.",
      from: { path: '^packages/shared/src/', pathNot: ['[.]test[.]ts$'] },
      to: {
        pathNot: [
          '^packages/shared/src/',
          '^packages/plugin-kit/src/contract[.]ts$',
          '(^|/)node_modules/zod/',
        ],
        dependencyTypesNot: ['type-only'],
      },
    },

    {
      name: 'tokens-is-a-leaf',
      severity: 'error',
      comment:
        'packages/tokens holds the design tokens as CSS custom properties. The web app and the ' +
        'website import it; it imports nothing.',
      from: { path: '^packages/tokens/' },
      to: {},
    },

    // What the website may import.
    ...require('./scripts/arch-site-rules.cjs'),

    // Where the plugin kit, its contract entry, the examples and the generator may reach.
    ...require('./scripts/arch-plugin-rules.cjs'),

    // Who may import whom inside the server.
    ...require('./scripts/arch-server-rules.cjs'),

    // --------------------------------------------------------------- web layers
    {
      name: 'ui-is-dumb',
      severity: 'error',
      comment: 'ui/ holds presentational primitives with no knowledge of features or data.',
      from: { path: '^apps/web/src/ui/' },
      to: { path: '^apps/web/src/(app|routes|features|charts|lib)/' },
    },
    {
      name: 'charts-are-pure',
      severity: 'error',
      comment: 'charts/ turns a spec plus data frames into ECharts. No routing, no fetching.',
      from: { path: '^apps/web/src/charts/' },
      to: { path: '^apps/web/src/(app|routes|features|lib)/' },
    },
    {
      name: 'features-not-to-routes',
      severity: 'error',
      comment: 'Routes compose features, never the other way round.',
      from: { path: '^apps/web/src/(features|charts|ui|lib)/' },
      to: { path: '^apps/web/src/(app|routes)/' },
    },
    {
      name: 'features-talk-through-their-index',
      severity: 'error',
      comment: 'Another feature is only reachable through its public index.ts(x).',
      from: { path: '^apps/web/src/features/([^/]+)/' },
      to: {
        path: '^apps/web/src/features/[^/]+/',
        pathNot: ['^apps/web/src/features/$1/', '^apps/web/src/features/[^/]+/index[.]tsx?$'],
      },
    },
    {
      name: 'echarts-only-in-charts',
      severity: 'error',
      comment: 'ECharts stays behind one adapter so the spec, not the library, is the contract.',
      from: { path: '^apps/web/src/', pathNot: '^apps/web/src/charts/' },
      to: { path: 'node_modules/(echarts|zrender)/' },
    },
    {
      name: 'ai-react-only-in-thread',
      severity: 'error',
      comment: 'Only the thread feature speaks the chat stream protocol.',
      from: { path: '^apps/web/src/', pathNot: '^apps/web/src/features/thread/' },
      to: { path: 'node_modules/@ai-sdk/react/' },
    },
  ],

  options: {
    doNotFollow: { path: ['node_modules'] },
    // Anchored on purpose: an unanchored 'dist/' would also swallow node_modules/<pkg>/dist/*,
    // and excluded modules silently vanish from every rule.
    exclude: { path: '^(apps|packages)/[^/]+/(dist|coverage|[.]astro)/' },
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      // Resolve what Bun resolves at runtime.
      conditionNames: ['bun', 'import', 'require', 'node', 'default'],
      mainFields: ['module', 'main', 'types', 'typings'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(?:@[^/]+/[^/]+|[^/]+)' },
      text: { highlightFocused: true },
    },
  },
};
