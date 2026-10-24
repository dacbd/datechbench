#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import type { Report, Verbosity } from './core/bench.js';
import { loadBench } from './core/load.js';
import { getBenchType, listBenchTypes } from './core/registry.js';

const usage = `Usage:
  datechbench --bench <file.yaml> [--output <file.json>] [-v | -vv | -vvv]
  datechbench --schema <version>    print the JSON Schema for a bench type's YAML
  datechbench --list                list bench types

Verbosity (report contents):
  (none)  per-model summary only
  -v      plus each question's id and correct
  -vv     plus full question results
  -vvv    plus the api transcript for each question`;

async function main() {
  const { values } = parseArgs({
    options: {
      bench: { type: 'string', short: 'b' },
      output: { type: 'string', short: 'o' },
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
  if (values.help || !values.bench) {
    console.log(usage);
    process.exit(values.help ? 0 : 1);
  }

  const { type, bench } = await loadBench(values.bench);
  const results = type.resultSchema.parse(await type.run(bench));
  const report: Report = {
    version: type.version,
    bench: bench.name,
    ranAt: new Date().toISOString(),
    results: type.view(results, verbosity),
  };
  const json = JSON.stringify(report, null, 2);
  if (values.output) {
    await writeFile(values.output, json + '\n');
    console.error(`Results written to ${values.output}`);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
