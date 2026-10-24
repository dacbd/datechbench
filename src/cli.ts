#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { z } from 'zod';
import type { Verbosity } from './core/bench.js';
import { loadBench } from './core/load.js';
import { getBenchType, listBenchTypes } from './core/registry.js';
import { recordRun } from './core/runs.js';
import { buildSummary } from './core/summary.js';

const usage = `Usage:
  datechbench --bench <file.yaml> [--results <dir>] [-v | -vv | -vvv]
  datechbench --build-summary [--results <dir>]   rebuild <dir>/<version>/summary.json from saved runs
  datechbench --schema <version>                  print the JSON Schema for a bench type's YAML
  datechbench --list                              list bench types

Each model's run is saved as it goes to
  <dir>/<version>/runs/<bench>/<yyyy-mm-dd_HHMM>.<success|failure>.<provider>.<model>.json
(<dir> defaults to results). The exit code is 1 if any run failed.

Verbosity (stdout only; run files always hold everything):
  (none)  per-model summary only
  -v      plus each question's id and correct
  -vv     plus full question results
  -vvv    plus the api transcript for each question`;

async function main() {
  const { values } = parseArgs({
    options: {
      bench: { type: 'string', short: 'b' },
      results: { type: 'string', default: 'results' },
      'build-summary': { type: 'boolean' },
      schema: { type: 'string' },
      list: { type: 'boolean' },
      verbose: { type: 'boolean', short: 'v', multiple: true },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const verbosity = Math.min(values.verbose?.length ?? 0, 3) as Verbosity;

  if (values.list) {
    for (const t of listBenchTypes()) console.log(`${t.version}\t${t.description}`);
    return;
  }
  if (values.schema) {
    console.log(JSON.stringify(z.toJSONSchema(getBenchType(values.schema).benchSchema, { io: 'input' }), null, 2));
    return;
  }
  if (values['build-summary']) {
    for (const type of listBenchTypes()) {
      const { path, runs, skipped } = await buildSummary(values.results, type);
      console.error(`${path}: ${runs} runs${skipped ? `, ${skipped} skipped` : ''}`);
    }
    return;
  }
  if (values.help || !values.bench) {
    console.log(usage);
    process.exit(values.help ? 0 : 1);
  }

  const { type, bench } = await loadBench(values.bench);
  const runs = [];
  for (const model of bench.models) {
    runs.push(await recordRun({ type, bench, benchFile: values.bench, model, resultsDir: values.results }));
  }
  const report = runs.map(({ path, run: { $schema: _, results, ...run } }) => ({
    file: path,
    ...run,
    results: results === null ? null : type.view(results, verbosity),
  }));
  console.log(JSON.stringify(report, null, 2));
  if (runs.some(({ run }) => run.status === 'failure')) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
