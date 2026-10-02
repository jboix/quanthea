/**
 * dependency-cruiser rules for the plugin side: the kit, its workspace-only contract entry, the
 * example plugins and the plugin generator. `.dependency-cruiser.cjs` spreads them into its
 * forbidden rules.
 *
 * @type {import('dependency-cruiser').IForbiddenRuleType[]}
 */
module.exports = [
  {
    name: 'plugin-kit-is-a-leaf',
    severity: 'error',
    comment:
      'packages/plugin-kit is what plugins are written against, and it is published: it imports ' +
      'zod only, never an app or shared.',
    from: { path: '^packages/plugin-kit/' },
    to: { path: ['^apps/', '^packages/shared/'] },
  },
  {
    name: 'shared-uses-the-kit-contract-only',
    severity: 'error',
    comment:
      'The kit owns the frames and the query languages (its contract entry). shared re-exports ' +
      'them and never reaches the live kit, the test kit or the kit internals.',
    from: { path: '^packages/shared/' },
    to: { path: '^packages/plugin-kit/', pathNot: '^packages/plugin-kit/src/contract[.]ts$' },
  },
  {
    name: 'plugin-kit-stays-small',
    severity: 'error',
    comment:
      'The kit runs inside plugins as well as the server: its only runtime dependency is zod. ' +
      'The testing entry and tests may use bun:test.',
    from: { path: '^packages/plugin-kit/src/', pathNot: ['[.]test[.]ts$', '/testing[.]ts$'] },
    to: {
      pathNot: ['^packages/plugin-kit/src/', '(^|/)node_modules/zod/'],
      dependencyTypesNot: ['type-only', 'core'],
    },
  },
  {
    name: 'create-plugin-stands-alone',
    severity: 'error',
    comment: 'The published generator imports no app, no shared, and only the kit contract.',
    from: { path: '^packages/create-plugin/' },
    to: {
      path: ['^apps/', '^packages/(shared|plugin-kit)/'],
      pathNot: '^packages/plugin-kit/src/contract[.]ts$',
    },
  },
  {
    name: 'examples-use-the-public-kit',
    severity: 'error',
    comment:
      'An example plugin is written as an outside author writes one: against @quanthea/plugin-kit ' +
      '(types, and the testing entry in tests), never the server, shared, the live kit or the ' +
      'workspace-only contract entry.',
    from: { path: '^examples/' },
    to: {
      path: [
        '^apps/',
        '^packages/shared/',
        '^packages/plugin-kit/src/host[.]ts$',
        '^packages/plugin-kit/src/contract[.]ts$',
      ],
    },
  },
  {
    name: 'only-the-server-kit-uses-the-host',
    severity: 'error',
    comment:
      'The live kit (plugin-kit/host) reaches the server through connectors/_shared/index.ts only, ' +
      'so built-in kinds and plugins see the same functions.',
    from: {
      path: '^apps/',
      pathNot: ['^apps/server/src/connectors/_shared/index[.]ts$', '[.]test[.]ts$'],
    },
    to: { path: '^packages/plugin-kit/src/host[.]ts$' },
  },
];
