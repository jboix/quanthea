/** The definitions of business terms, wired to the database, the dashboards and the gate. */
import type { Connections } from './connections/connections.ts';
import type { Dashboards } from './dashboards/dashboards.ts';
import { createDefinitions, type Definitions } from './dashboards/definitions.ts';
import type { AuditRepository } from './db/audit-repository.ts';
import { createDefinitionRepository } from './db/definition-repository.ts';
import { hiddenResultNames, isHiddenResultName } from './gate/subject.ts';

/**
 * The definitions of business terms, which see each connector's hidden names through the gate.
 *
 * @param database - The database the versions are stored in.
 * @param services - The dashboards, the connectors, the audit log and the clock.
 * @returns The definitions service, and the definitions as the model may read them.
 */
export function definitionsOf(
  database: Parameters<typeof createDefinitionRepository>[0],
  services: {
    dashboards: Dashboards;
    connections: Pick<Connections, 'subjects'>;
    audit: Pick<AuditRepository, 'append'>;
    now: (() => number) | undefined;
  },
): { definitions: Definitions; modelDefinitions: Definitions['forModel'] } {
  const { dashboards, connections, audit, now } = services;
  const repository = createDefinitionRepository(database);
  const connectors = () =>
    connections.subjects().map(({ subject, language }) => {
      const hidden = hiddenResultNames(subject);
      return {
        name: subject.name,
        language,
        isHidden: (name: string) => isHiddenResultName(name, hidden),
      };
    });
  const definitions = createDefinitions({
    repository,
    audit,
    dashboards,
    connectors,
    ...(now ? { now } : {}),
  });
  return { definitions, modelDefinitions: definitions.forModel };
}
