import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { type AnyBenchType, makeRunSchema, type Run } from './bench.js';
import { log } from './log.js';
import { SUMMARY_FILE, SUMMARY_SCHEMA_FILE, typeDir, writeJson, writeSchemas } from './runs.js';

// Rebuilds <results>/<version>/summary.json from every saved run of that type.
// The output has no timestamp, so it only changes when the runs do.
export async function buildSummary(resultsDir: string, type: AnyBenchType) {
  const dir = typeDir(resultsDir, type);
  const runsDir = join(dir, 'runs');
  const runSchema = makeRunSchema(type.version, type.resultSchema);
  const files = existsSync(runsDir)
    ? (await readdir(runsDir, { recursive: true })).filter((f) => f.endsWith('.json')).sort()
    : [];

  const runs: { file: string; run: Run<unknown> }[] = [];
  for (const f of files) {
    const file = join('runs', f);
    const parsed = runSchema.safeParse(JSON.parse(await readFile(join(dir, file), 'utf8')));
    if (parsed.success) runs.push({ file, run: parsed.data as Run<unknown> });
    else log(`skipping ${join(dir, file)}, it does not match the run schema:\n${z.prettifyError(parsed.error)}`);
  }

  // A run synced mid-way can leave its in-progress failure file next to the
  // finished one. Count each run once: success first, then whichever got further.
  const rank = ({ run }: (typeof runs)[number]) => [run.status === 'success' ? 1 : 0, run.finishedAt ?? ''] as const;
  const unique = new Map<string, (typeof runs)[number]>();
  for (const entry of runs) {
    const key = `${entry.run.bench.name}\0${entry.run.model}\0${entry.run.startedAt}`;
    const seen = unique.get(key);
    if (!seen) {
      unique.set(key, entry);
      continue;
    }
    const [a, b] = [rank(entry), rank(seen)];
    const keep = a[0] !== b[0] ? (a[0] > b[0] ? entry : seen) : a[1] > b[1] ? entry : seen;
    log(`ignoring ${join(dir, keep === entry ? seen.file : entry.file)}, superseded by ${keep.file}`);
    unique.set(key, keep);
  }

  const summary = type.summarySchema.parse(type.summarize([...unique.values()]));
  writeSchemas(resultsDir, type);
  const path = join(dir, SUMMARY_FILE);
  writeJson(path, { $schema: `./${SUMMARY_SCHEMA_FILE}`, ...(summary as object) });
  return { path, runs: unique.size, skipped: files.length - unique.size };
}
