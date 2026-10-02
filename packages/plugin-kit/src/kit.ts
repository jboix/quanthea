/**
 * The kit quanthea hands a plugin when it loads it, and the shape of a plugin and what it adds. The kit is the live
 * one: its Zod, its error class and its helpers are the server's own, so a plugin's schemas and
 * errors are the ones the core checks.
 */
import type { z } from 'zod';
import type { ConnectorKind, defineConnector } from './connector-kind.ts';
import type { ConnectorError } from './errors.ts';
import type { createFrameBuilder } from './frame-builder.ts';
import type { createHttpClient } from './http.ts';
import type { seriesFrames } from './series-frames.ts';

/** The version of the kit this package describes. A plugin exports the version it was built for. */
export const kitVersion = 0;

/** What a plugin receives. */
export interface ConnectorKit {
  /** The kit version, {@link kitVersion}. */
  readonly version: typeof kitVersion;
  /** The server's Zod: build the configuration and credential schemas with it. */
  readonly z: typeof z;
  /** Declares a connector kind, with the same checks as the built-in kinds. */
  readonly defineConnector: typeof defineConnector;
  /** The error a connector throws, with a code and a message safe to show. */
  readonly ConnectorError: typeof ConnectorError;
  /** Builds a frame row by row, with the row limit and truncation. */
  readonly createFrameBuilder: typeof createFrameBuilder;
  /** An HTTP client held to one origin, with a timeout and a size cap. */
  readonly createHttpClient: typeof createHttpClient;
  /** Turns results in the Prometheus API format into frames. */
  readonly seriesFrames: typeof seriesFrames;
}

/**
 * What a plugin adds to quanthea, by kind of contribution. Connector kinds are the one kind today;
 * others will be added beside them, so a plugin written now keeps loading.
 */
export interface PluginContributions {
  /** The connector kinds the plugin adds. */
  readonly connectors: readonly ConnectorKind[];
}

/**
 * A plugin's default export: given the kit, what the plugin adds.
 *
 * @param kit - The kit.
 * @returns The contributions.
 */
export type Plugin = (kit: ConnectorKit) => PluginContributions;
