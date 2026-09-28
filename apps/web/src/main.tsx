/** Entry point: fonts, theme, and the router. */
import './lib/zod-without-eval.ts';
import '@fontsource-variable/ibm-plex-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './ui/theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { createAppRouter } from './app/router.tsx';
import { createSessionLoader } from './app/session.ts';
import { createApiClient } from './lib/api-client.ts';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('index.html has no #root element.');

const router = createAppRouter(createSessionLoader(createApiClient()));

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
