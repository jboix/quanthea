/** The MySQL connector kind. */
import { mysqlIcon } from './icons.ts';
import { defineMysqlKind } from './mysql-kind.ts';

/** The MySQL connector kind. */
export const mysqlConnector = defineMysqlKind({ kind: 'mysql', name: 'MySQL', icon: mysqlIcon });
