import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import type { AnyBenchType, BaseBench } from './bench.js';
import { getBenchType } from './registry.js';

// Reads the bench file, picks the bench type from its `version`, and validates
// the whole document against that type's strict schema.
export async function loadBench(path: string): Promise<{ type: AnyBenchType; bench: BaseBench }> {
  const raw = parse(await readFile(path, 'utf8')) as unknown;
  const { version } = z.looseObject({ version: z.string() }).parse(raw);
  const type = getBenchType(version);
  const parsed = type.benchSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid ${version} bench ${path}:\n${z.prettifyError(parsed.error)}`);
  }
  return { type, bench: parsed.data };
}
