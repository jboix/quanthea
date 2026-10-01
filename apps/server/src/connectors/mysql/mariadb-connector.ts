/** The MariaDB connector kind. */
import { mariadbIcon } from './icons.ts';
import { defineMysqlKind } from './mysql-kind.ts';

/** The MariaDB connector kind. */
export const mariadbConnector = defineMysqlKind({
  kind: 'mariadb',
  name: 'MariaDB',
  icon: mariadbIcon,
});
