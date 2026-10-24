import type { AnyBenchType } from './bench.js';
import { v1 } from '../types/v1/index.js';

// To add a bench type: create src/types/<version>/ exporting a defineBenchType()
// value and list it here.
const benchTypes = [v1] as unknown as AnyBenchType[];

export const listBenchTypes = () => benchTypes;

export function getBenchType(version: unknown): AnyBenchType {
  const type = benchTypes.find((t) => t.version === version);
  if (!type) {
    const known = benchTypes.map((t) => t.version).join(', ');
    throw new Error(`Unknown bench version ${JSON.stringify(version)}. Known versions: ${known}`);
  }
  return type;
}
