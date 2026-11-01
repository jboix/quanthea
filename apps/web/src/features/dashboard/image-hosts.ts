/**
 * The hosts an admin allowed, for the images a dashboard's tables show. A screen that draws a
 * canvas provides them; without them, an image cell shows its address as text.
 */
import type { ExternalHosts } from '@quanthea/shared';
import { createContext } from 'react';

/** The hosts an admin allowed, or `undefined` while they are not known. */
export const ImageHostsContext = createContext<ExternalHosts | undefined>(undefined);
