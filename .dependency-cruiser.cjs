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
        ],
      },
      to: {},
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment:
        'Bun built-ins (bun, bun:sqlite, bun:test) are provided by the runtime, not node_modules.',
      from: {},
      to: { couldNotResolve: true, pathNot: ['^bun$', '^bun:'] },
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

    // Where the plugin kit, its contract entry, the examples and the generator may reach.
    ...require('./scripts/arch-plugin-rules.cjs'),

    // ------------------------------------------------------------ server layers
    {
      name: 'agent-only-through-gate',
      severity: 'error',
      comment:
        'Privacy invariant: the model only sees what gate/ lets through. The agent may not ' +
        'import connectors, the query executor or the database directly.',
      from: { path: '^apps/server/src/agent/' },
      to: { path: '^apps/server/src/(connectors|query|db)/' },
    },
    {
      name: 'connectors-are-leaves',
      severity: 'error',
      comment: 'Connectors know nothing about the app: only lib/ and shared.',
      from: { path: '^apps/server/src/connectors/' },
      to: {
        path: '^apps/server/src/',
        pathNot: '^apps/server/src/(connectors|lib)/',
      },
    },
    {
      name: 'no-cross-connector',
      severity: 'error',
      comment:
        'connectors/<kind> never imports another kind. Common code goes in connectors/_shared.',
      from: { path: '^apps/server/src/connectors/([^/_][^/]*)/' },
      to: {
        path: '^apps/server/src/connectors/[^/]+/',
        pathNot: ['^apps/server/src/connectors/$1/', '^apps/server/src/connectors/_shared/'],
      },
    },
    {
      name: 'connector-kinds-use-the-kit',
      severity: 'error',
      comment:
        'A connector kind imports connectors/_shared/index.ts and nothing else from _shared, so the ' +
        'kit can change inside without breaking kinds. Tests may use connectors/_shared/test.',
      from: {
        path: '^apps/server/src/connectors/[^_/][^/]*/',
        pathNot: ['[.]test[.]ts$', '/test/'],
      },
      to: {
        path: '^apps/server/src/connectors/_shared/',
        pathNot: '^apps/server/src/connectors/_shared/index[.]ts$',
      },
    },
    {
      name: 'query-stays-below',
      severity: 'error',
      comment:
        'query/ binds and runs queries against a connector the caller resolved. It knows the ' +
        'connectors, lib and shared, nothing above them: no db, gate, agent or http.',
      from: { path: '^apps/server/src/query/' },
      to: { path: '^apps/server/src/', pathNot: '^apps/server/src/(query|connectors|lib)/' },
    },
    {
      name: 'gate-stays-narrow',
      severity: 'error',
      comment:
        'gate/ turns schemas and results into what the model may see. It reads through query/ and ' +
        'the connector kit, never a connector kind, the database or the layers above it.',
      from: { path: '^apps/server/src/gate/', pathNot: ['[.]test[.]ts$'] },
      to: {
        path: '^apps/server/src/',
        pathNot: '^apps/server/src/(gate|query|connectors/_shared|settings|lib)/',
      },
    },
    {
      name: 'dashboards-stay-in-their-lane',
      severity: 'error',
      comment:
        'dashboards/ validates, stores and runs specs. It reaches connectors only through the ' +
        'functions the bootstrap hands it, so it imports the database, query/ and lib/, nothing else.',
      from: { path: '^apps/server/src/dashboards/', pathNot: ['[.]test[.]ts$'] },
      to: {
        path: '^apps/server/src/',
        pathNot: '^apps/server/src/(dashboards|db|query|lib)/',
      },
    },
    {
      name: 'alerts-stay-in-their-lane',
      severity: 'error',
      comment:
        'alerts/ validates, stores, evaluates and replays alert specs, with no model. It reaches ' +
        'connectors and notification channels only through the functions the bootstrap hands it, ' +
        "so it imports the database, query/, the dashboards' spec checks and lib/, nothing else.",
      from: { path: '^apps/server/src/alerts/', pathNot: ['[.]test[.]ts$'] },
      to: {
        path: '^apps/server/src/',
        pathNot: '^apps/server/src/(alerts|dashboards|db|query|lib)/',
      },
    },
    {
      name: 'reports-stay-in-their-lane',
      severity: 'error',
      comment:
        'reports/ validates, stores and runs report specs on a schedule, with no model. It reaches ' +
        'connectors and notification channels only through the functions the bootstrap hands it, ' +
        "so it imports the database, the dashboards' checks and panel runs, the alerts' limiter " +
        'and lib/, nothing else.',
      from: { path: '^apps/server/src/reports/', pathNot: ['[.]test[.]ts$', '/test/'] },
      to: {
        path: '^apps/server/src/',
        pathNot: [
          '^apps/server/src/(reports|dashboards|db|query|lib)/',
          '^apps/server/src/alerts/limiter[.]ts$',
        ],
      },
    },
    {
      name: 'connections-below-http',
      severity: 'error',
      comment:
        'connections/ stores and opens configured connectors. It sits under http/ and never reaches ' +
        'up to it, to auth/ or to the agent.',
      from: { path: '^apps/server/src/connections/' },
      to: { path: '^apps/server/src/(http|auth|agent)/' },
    },
    {
      name: 'provisioning-below-http',
      severity: 'error',
      comment:
        'provisioning/ applies the configuration file through the services. It sits under http/ ' +
        'and never reaches up to it or to the agent.',
      from: { path: '^apps/server/src/provisioning/' },
      to: { path: '^apps/server/src/(http|agent)/' },
    },
    {
      name: 'notifications-stay-in-their-lane',
      severity: 'error',
      comment:
        'notifications/ keeps the channels and sends to them. It stores through db/, seals through ' +
        'secrets/ and checks addresses with the connector kit, nothing above them. Its tests may ' +
        'use the shared test helpers in src/test/.',
      from: { path: '^apps/server/src/notifications/', pathNot: ['[.]test[.]ts$'] },
      to: {
        path: '^apps/server/src/',
        pathNot: [
          '^apps/server/src/(notifications|db|secrets|lib)/',
          '^apps/server/src/connectors/_shared/index[.]ts$',
        ],
      },
    },
    {
      name: 'secrets-is-a-leaf',
      severity: 'error',
      comment:
        'secrets/ encrypts and decrypts. It imports lib/ only, so key handling stays auditable. ' +
        'Its tests may use the shared test helpers in src/test/.',
      from: { path: '^apps/server/src/secrets/' },
      to: { path: '^apps/server/src/', pathNot: '^apps/server/src/(secrets|lib|test)/' },
    },
    {
      name: 'http-is-thin',
      severity: 'error',
      comment:
        'Routes validate, authorize and call services. They never reach into drivers or SQL.',
      from: { path: '^apps/server/src/http/' },
      to: { path: '^apps/server/src/(connectors|db)/' },
    },
    {
      name: 'sqlite-only-in-db',
      severity: 'error',
      comment: 'Only db/ talks to bun:sqlite. Everyone else uses repositories.',
      from: { path: '^apps/server/src/', pathNot: '^apps/server/src/db/' },
      to: { path: '^bun:sqlite$' },
    },
    {
      name: 'ai-sdk-only-in-agent',
      severity: 'error',
      comment: 'The model SDK is an implementation detail of agent/.',
      from: { path: '^apps/server/src/', pathNot: '^apps/server/src/agent/' },
      to: { path: 'node_modules/(ai|@ai-sdk/[^/]+)/' },
    },
    {
      name: 'opensearch-driver-only-in-its-connector',
      severity: 'error',
      from: { path: '^apps/server/src/', pathNot: '^apps/server/src/connectors/opensearch/' },
      to: { path: 'node_modules/@opensearch-project/' },
    },
    {
      name: 'lib-is-a-leaf',
      severity: 'error',
      comment: 'lib/ holds tiny utilities (errors, logger, ids). It imports nothing from the app.',
      from: { path: '^apps/server/src/lib/' },
      to: { path: '^apps/server/src/', pathNot: '^apps/server/src/lib/' },
    },

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
    exclude: { path: '^(apps|packages)/[^/]+/(dist|coverage)/' },
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
