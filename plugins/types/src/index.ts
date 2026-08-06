// Shared types and plugin interfaces for the C2PA Soft Binding Resolution API
// server. Storage plugins (data store / object store) and auth plugins
// implement the interfaces below and are loaded dynamically by the server
// based on configuration (see DATASTORE_PLUGIN / OBJECTSTORE_PLUGIN /
// AUTH_PLUGIN).

import type { RequestHandler } from 'express';
import type { Store as RateLimitStore } from 'express-rate-limit';

export interface Receipt {
  '@context': { c2pa: string; receipt: string };
  '@type': string;
  repository: { uri: string; manifestId: string };
  anchor: {
    uri: string;
    proof: { alg: string; value: string };
    parameters?: Record<string, unknown>;
  };
  verified?: boolean;
  error?: string;
}

export interface Match {
  manifestId: string;
  similarityScore: number;
}

export interface ManifestEntry {
  data: Buffer;
  contentType: string;
  receipt: Receipt | null;
}

/**
 * A DataStorePlugin persists C2PA Manifest Stores, soft binding associations,
 * and receipts. Implementations are free to use any backing database.
 */
export interface DataStorePlugin {
  addManifest(data: Buffer, contentType: string): Promise<string>;
  getManifest(manifestId: string): Promise<ManifestEntry | null>;
  manifestExists(manifestId: string): Promise<boolean>;
  deleteManifest(manifestId: string): Promise<boolean>;
  createBinding(bindingValue: string, manifestId: string): Promise<boolean>;
  updateBinding(bindingValue: string, manifestId: string): Promise<boolean>;
  findByBinding(bindingValue: string, maxResults?: number): Promise<Match[]>;
  setReceipt(manifestId: string, receipt: Receipt): Promise<boolean>;
  getReceipt(manifestId: string): Promise<Receipt | null>;
}

export interface LoadedData {
  buffer: Buffer;
  contentType?: string;
}

/**
 * An ObjectStorePlugin stores arbitrary binary blobs in a "data" bucket and a
 * "public" bucket. Implementations are free to use any blob storage service.
 */
export interface ObjectStorePlugin {
  saveData(key: string, data: Buffer, contentType?: string): Promise<boolean>;
  loadData(key: string): Promise<LoadedData | null>;
  createDataLink(key: string, expires?: Date): Promise<string | null>;
  deleteData(key: string): Promise<boolean>;
  deleteDataOlderThan(maxAgeMs?: number): Promise<{ deletedCount: number; deletedKeys: string[] }>;
  savePublicData(key: string, data: Buffer, contentType?: string): Promise<boolean>;
  loadPublicData(key: string): Promise<LoadedData | null>;
  getPublicUrl(key: string): Promise<string | null>;
  deletePublicData(key: string): Promise<boolean>;
}

/**
 * An AuthPlugin builds an Express middleware that authenticates `/v1`
 * requests, given an identity-provider-specific config value (e.g. a GCP
 * project ID). Implementations are free to verify tokens against any
 * identity provider.
 */
export type AuthPlugin<TConfig = unknown> = (config: TConfig) => RequestHandler;

/**
 * A structured logger used for request logging and error reporting.
 * `meta` is merged into the structured (e.g. JSON) output alongside `msg`.
 */
export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  /** Returns a child logger that merges `bindings` into every log entry's metadata. */
  child(bindings: Record<string, unknown>): Logger;
}

/**
 * A LoggerPlugin builds a Logger, given an implementation-specific config
 * value (e.g. a minimum log level). Implementations are free to write logs
 * to any destination in any format.
 */
export type LoggerPlugin<TConfig = unknown> = (config: TConfig) => Logger;

/**
 * A RateLimitStorePlugin builds an express-rate-limit `Store`, given an
 * implementation-specific config value (e.g. a Redis connection string).
 * Used to share rate limit counters across multiple server instances; if
 * not configured, express-rate-limit's default in-memory store is used.
 */
export type RateLimitStorePlugin<TConfig = unknown> = (config: TConfig) => RateLimitStore;

/**
 * A region of interest within an asset, as per the C2PA Regions of Interest
 * specification. Discriminated by `type`; mirrors the five variants defined
 * by the C2PA Soft Binding Resolution API spec (SpatialRange, TemporalRange,
 * FrameRange, TextualRange, IdentifiedRange).
 */
export type RegionOfInterest =
  SpatialRegion | TemporalRegion | FrameRegion | TextualRegion | IdentifiedRegion;

export interface SpatialRegion {
  type: 'spatial';
  shape: {
    kind: 'rectangle' | 'circle' | 'polygon';
    unit: 'pixel' | 'percent';
    origin: { x: number; y: number };
  };
}

export interface TemporalRegion {
  type: 'temporal';
  time: {
    type: 'ntp' | 'wall-clock';
    start: string;
    end: string;
  };
}

export interface FrameRegion {
  type: 'frame';
  frame: {
    start: number;
    end: number;
  };
}

export interface TextualRegion {
  type: 'textual';
  text: {
    selector: {
      fragment: string;
      start?: number;
      end?: number;
    };
  };
}

export interface IdentifiedRegion {
  type: 'identified';
  identified: {
    identifier: string;
    value: string;
  };
}

/**
 * An Extractor recovers a soft binding value (a watermark or content
 * fingerprint) from an asset, returning the binding value or `null` if none
 * is found. Registered with `createServer({ extractors })`, keyed by an
 * algorithm name from the C2PA soft binding algorithm list:
 * https://github.com/c2pa-org/softbinding-algorithm-list
 *
 * `region`, when supplied by the caller (e.g. via POST /matches/byReference),
 * restricts the search to a specific region of interest within the asset.
 * Extractors are not required to honor it.
 */
export type Extractor = (
  buffer: Buffer,
  mimeType: string,
  region?: RegionOfInterest[],
) => Promise<string | null>;
