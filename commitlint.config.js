/**
 * Conventional Commits, as commitlint's conventional config states them. Dependabot's commits are
 * skipped: Dependabot writes their body, a list of the updates that can pass 100 characters a
 * line, and no setting changes it. Their header is a Conventional `build(deps): …` already.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  ignores: [(message) => message.includes('Signed-off-by: dependabot[bot]')],
};
