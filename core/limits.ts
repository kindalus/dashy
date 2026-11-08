import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ByteSize, LimitsConfig } from "./types.ts";

const units: Record<string, number> = {
  B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12,
  KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4,
};
/** Parse 512MB, 1GB, 64MiB or a byte count. */
export function parseBytes(value: ByteSize, name = "size"): number {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive number of bytes`);
    return value;
  }
  const match = /^\s*(\d+(?:\.\d+)?)\s*([KMGT]?I?B)\s*$/i.exec(value);
  if (!match || !units[match[2]!.toUpperCase()]) throw new Error(`${name} must look like 512MB, 1GB or 64MiB`);
  return Math.round(Number(match[1]) * units[match[2]!.toUpperCase()]!);
}

export interface ResolvedLimits {
  memoryBytes: number;
  threads: number;
  maxConcurrentQueries: number;
  maxQueuedQueries: number;
  queueTimeoutMs: number;
  queryTimeoutMs: number;
  tempDirectory: string;
}
export function resolveLimits(limits: LimitsConfig = {}): ResolvedLimits {
  const integer = (value: number | undefined, fallback: number, name: string, min = 1) => {
    const result = value ?? fallback;
    if (!Number.isInteger(result) || result < min) throw new Error(`limits.${name} must be an integer of at least ${min}`);
    return result;
  };
  return {
    memoryBytes: parseBytes(limits.memory ?? "1GB", "limits.memory"),
    threads: integer(limits.threads, 2, "threads"),
    maxConcurrentQueries: integer(limits.maxConcurrentQueries, 4, "maxConcurrentQueries"),
    maxQueuedQueries: integer(limits.maxQueuedQueries, 32, "maxQueuedQueries", 0),
    queueTimeoutMs: integer(limits.queueTimeoutMs, 15_000, "queueTimeoutMs"),
    queryTimeoutMs: integer(limits.queryTimeoutMs, 30_000, "queryTimeoutMs"),
    tempDirectory: limits.tempDirectory ?? join(tmpdir(), "dashy-duckdb"),
  };
}

