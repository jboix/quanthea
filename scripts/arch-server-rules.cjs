/**
 * dependency-cruiser rules for the server's modules (apps/server/src). `.dependency-cruiser.cjs`
 * spreads them into its forbidden rules. The architecture doc's module table summarizes them.
 *
 * @type {import('dependency-cruiser').IForbiddenRuleType[]}
 */
module.exports = [
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
    name: 'agent-allow-list',
    severity: 'error',
    comment:
      'agent/ reaches the gate and the domain services it is handed, nothing else: no ' +
      'connections, secrets, notifications, plugins, http or auth. Its tests may use src/test/.',
    from: { path: '^apps/server/src/agent/', pathNot: ['[.]test[.]ts$'] },
    to: {
      path: '^apps/server/src/',
      pathNot:
        '^apps/server/src/(agent|gate|dashboards|threads|settings|alerts|reports|usage|lib)/',
    },
  },
  {
    name: 'agent-takes-domain-types',
    severity: 'error',
    comment:
      'agent/ uses the alerts, reports, usage and the Dashboards service through what the run ' +
      'context hands it, so it imports their types only.',
    from: { path: '^apps/server/src/agent/', pathNot: ['[.]test[.]ts$'] },
    to: {
      path: [
        '^apps/server/src/(alerts|reports|usage)/',
        '^apps/server/src/dashboards/dashboards[.]ts$',
      ],
      dependencyTypesNot: ['type-only'],
    },
  },
  {
    name: 'threads-stay-in-their-lane',
    severity: 'error',
    comment: 'threads/ keeps threads, messages and plans: it imports the database and lib/.',
    from: { path: '^apps/server/src/threads/', pathNot: ['[.]test[.]ts$'] },
    to: { path: '^apps/server/src/', pathNot: '^apps/server/src/(threads|db|lib)/' },
  },
  {
    name: 'settings-stay-in-their-lane',
    severity: 'error',
    comment:
      'settings/ keeps the typed settings: the database, secrets/ for the model key, lib/, the ' +
      "kit's address checks, and the saved query types.",
    from: { path: '^apps/server/src/settings/', pathNot: ['[.]test[.]ts$'] },
    to: {
      path: '^apps/server/src/',
      pathNot: [
        '^apps/server/src/(settings|db|secrets|lib)/',
        '^apps/server/src/connectors/_shared/index[.]ts$',
        '^apps/server/src/dashboards/queries/',
      ],
    },
  },
  {
    name: 'settings-take-query-types',
    severity: 'error',
    comment: 'settings/ reads the saved query types of dashboards/, never its code.',
    from: { path: '^apps/server/src/settings/', pathNot: ['[.]test[.]ts$'] },
    to: { path: '^apps/server/src/dashboards/queries/', dependencyTypesNot: ['type-only'] },
  },
  {
    name: 'auth-below-agent-and-http',
    severity: 'error',
    comment: 'auth/ resolves sessions and users. It never reaches up to the agent or the routes.',
    from: { path: '^apps/server/src/auth/' },
    to: { path: '^apps/server/src/(agent|http)/' },
  },
  {
    name: 'usage-is-a-ledger',
    severity: 'error',
    comment: 'usage/ records and sums token use: it imports the database and lib/, nothing else.',
    from: { path: '^apps/server/src/usage/', pathNot: ['[.]test[.]ts$'] },
    to: { path: '^apps/server/src/', pathNot: '^apps/server/src/(usage|db|lib)/' },
  },
  {
    name: 'jobs-take-services',
    severity: 'error',
    comment:
      'jobs/ schedules work on the services the bootstrap hands it, so it imports their types ' +
      'only, plus lib/.',
    from: { path: '^apps/server/src/jobs/', pathNot: ['[.]test[.]ts$'] },
    to: {
      path: '^apps/server/src/',
      pathNot: '^apps/server/src/(jobs|lib)/',
      dependencyTypesNot: ['type-only'],
    },
  },
  {
    name: 'plugins-stay-keyless',
    severity: 'error',
    comment:
      'The plugin commands run in a Docker build with no database and no keys, so plugins/ ' +
      'imports the config, the connector kit and registry, and lib/: never db/, secrets/ or gate/.',
    from: { path: '^apps/server/src/plugins/', pathNot: ['[.]test[.]ts$', '/test/'] },
    to: {
      path: '^apps/server/src/',
      pathNot: [
        '^apps/server/src/(plugins|config|lib)/',
        '^apps/server/src/connectors/_shared/index[.]ts$',
        '^apps/server/src/connectors/registry[.]ts$',
      ],
    },
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
      "so it imports the database, the dashboards' checks and panel runs, and lib/, nothing else.",
    from: { path: '^apps/server/src/reports/', pathNot: ['[.]test[.]ts$', '/test/'] },
    to: {
      path: '^apps/server/src/',
      pathNot: '^apps/server/src/(reports|dashboards|db|query|lib)/',
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
      'Routes validate, authorize and call services. They never reach into drivers, SQL, the ' +
      'query executor or the keys: a route that ran query/ itself would skip the version and ' +
      'role checks of the services.',
    from: { path: '^apps/server/src/http/' },
    to: { path: '^apps/server/src/(connectors|db|query|secrets)/' },
  },
  {
    name: 'cookies-only-in-auth-routes',
    severity: 'error',
    comment:
      'Only the sign-in routes set or read cookies, so a new route cannot set a weaker session ' +
      'cookie.',
    from: {
      path: '^apps/',
      pathNot: '^apps/server/src/http/routes/(auth|provider)-routes([.]test)?[.]ts$',
    },
    to: { path: 'node_modules/hono/dist/(types/|cjs/)?helper/cookie/' },
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
];
