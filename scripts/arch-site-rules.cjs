/**
 * dependency-cruiser rules for the website (apps/site). `.dependency-cruiser.cjs` spreads them
 * into its forbidden rules. The rules see the site's TypeScript modules only: dependency-cruiser
 * does not parse .astro files.
 *
 * @type {import('dependency-cruiser').IForbiddenRuleType[]}
 */
module.exports = [
  {
    name: 'site-reads-tokens-shared-and-docs',
    severity: 'error',
    comment:
      'The website imports the design tokens, the shared package, the docs, the READMEs and the ' +
      "root package.json, never the apps or the other packages' code. Its tests may import the server's " +
      'registries, to check the facts the site states against the code.',
    from: { path: '^apps/site/', pathNot: ['[.]test[.]ts$'] },
    to: {
      dependencyTypesNot: ['core'],
      pathNot: [
        '^apps/site/',
        '^packages/(tokens|shared)/',
        // A ?raw import of the tokens stays unresolved, under its package name.
        '^@quanthea/tokens/',
        '^docs/',
        // The READMEs, read as text for the commands they give.
        '^README[.]md$',
        '^packages/[^/]+/README[.]md$',
        '^package[.]json$',
        '(^|/)node_modules/',
        // Astro's own modules, such as astro:content.
        '^astro:',
      ],
    },
  },
];
