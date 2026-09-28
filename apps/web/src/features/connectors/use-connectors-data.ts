/** Reads the connectors layout's data from any route below it. */
import { useRouteLoaderData } from 'react-router';
import type { ConnectorsData } from './data.ts';

/** The route id of the connectors layout. */
export const connectorsRouteId = 'connectors';

/**
 * The connectors and kinds the layout loaded.
 *
 * @returns The layout's data.
 * @throws {Error} When called outside the connectors layout.
 */
export function useConnectorsData(): ConnectorsData {
  const loaded = useRouteLoaderData(connectorsRouteId) as ConnectorsData | undefined;
  if (!loaded) throw new Error('useConnectorsData is used outside the connectors layout.');
  return loaded;
}
