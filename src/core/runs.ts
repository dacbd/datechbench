import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { type AnyBenchType, type BaseBench, makeRunSchema, type Run, type RunFailureReason } from './bench.js';
import { log } from './log.js';
import { splitModelId } from './models.js';

export const RUN_SCHEMA_FILE = 'run.schema.json';
export const SUMMARY_FILE = 'summary.json';
export const SUMMARY_SCHEMA_FILE = 'summary.schema.json';

export const typeDir = (resultsDir: string, type: AnyBenchType) => join(resultsDir, type.version);

export const writeJson = (path: string, value: unknown) => {
  // Write then rename, so a crash mid-write never leaves a truncated file.
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n');
  renameSync(`${path}.tmp`, path);
};

export function writeSchemas(resultsDir: string, type: AnyBenchType) {
  const dir = typeDir(resultsDir, type);
  mkdirSync(dir, { recursive: true });
  const toJson = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'output' });
  writeJson(join(dir, RUN_SCHEMA_FILE), toJson(makeRunSchema(type.version, type.resultSchema)));
  writeJson(join(dir, SUMMARY_SCHEMA_FILE), toJson(type.summarySchema));
}

const filenameSafe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-');

// Run start in UTC, matching the log timestamps: 2026-10-24_1612.
const fileStamp = (d: Date) => d.toISOString().slice(0, 16).replace('T', '_').replace(':', '');

// Identifies the test itself; the model list is left out since each run covers one model.
const benchHash = (bench: BaseBench) =>
  createHash('sha256').update(JSON.stringify({ ...bench, models: undefined })).digest('hex');

const errorDetail = (err: unknown) => (err instanceof Error ? (err.stack ?? err.message) : String(err));

// Runs one model through the bench, saving to
// <results>/<version>/runs/<bench>/<yyyy-mm-dd_HHMM>.<success|failure>.<provider>.<model>.json.
// The file is rewritten after every progress report under the failure name, so
// anything that kills the process leaves a failure file with everything up to
// that point. It is renamed to success only once the run finishes cleanly.
export async function recordRun(opts: {
  type: AnyBenchType;
  bench: BaseBench;
  benchFile: string;
  model: string;
  resultsDir: string;
}): Promise<{ path: string; run: Run<unknown> }> {
  const { type, bench, model, resultsDir } = opts;
  const started = new Date();
  const dir = join(typeDir(resultsDir, type), 'runs', filenameSafe(bench.name));
  mkdirSync(dir, { recursive: true });
  writeSchemas(resultsDir, type);

  const { provider, name } = splitModelId(model);
  const fileFor = (stamp: string, status: Run<unknown>['status']) =>
    join(dir, `${stamp}.${status}.${filenameSafe(provider)}.${filenameSafe(name)}.json`);
  // Same bench and model started within the same minute: suffix the stamp rather than overwrite.
  let stamp = fileStamp(started);
  for (let n = 2; existsSync(fileFor(stamp, 'success')) || existsSync(fileFor(stamp, 'failure')); n++) {
    stamp = `${fileStamp(started)}-${n}`;
  }
  const pathFor = (status: Run<unknown>['status']) => fileFor(stamp, status);

  const run: Run<unknown> = {
    $schema: relative(dir, join(typeDir(resultsDir, type), RUN_SCHEMA_FILE)),
    version: type.version,
    bench: { name: bench.name, file: opts.benchFile, hash: benchHash(bench) },
    provider,
    model,
    startedAt: started.toISOString(),
    finishedAt: null,
    status: 'failure',
    failure: { reason: 'incomplete', message: 'The run did not finish; the process exited mid-run.' },
    results: null,
  };
  const save = () => writeJson(pathFor(run.status), run);
  const finish = (failure?: { reason: RunFailureReason; message: string }) => {
    run.finishedAt = new Date().toISOString();
    if (failure) {
      run.failure = failure;
    } else {
      run.status = 'success';
      delete run.failure;
    }
    save();
    if (run.status === 'success') rmSync(pathFor('failure'), { force: true });
  };

  const onSignal = (signal: NodeJS.Signals) => {
    finish({ reason: 'interrupted', message: `Received ${signal}.` });
    log(`interrupted [${model}], saved ${pathFor(run.status)}`);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  save();
  try {
    run.results = await type.run(bench, model, (results) => {
      run.results = results;
      save();
    });
    const message = type.failure(run.results);
    finish(message ? { reason: 'model_errors', message } : undefined);
  } catch (err) {
    log(`error [${model}] ${err instanceof Error ? err.message : String(err)}`);
    finish({ reason: 'harness_error', message: errorDetail(err) });
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }

  const checked = makeRunSchema(type.version, type.resultSchema).safeParse(run);
  if (!checked.success) log(`warning: run does not match its schema:\n${z.prettifyError(checked.error)}`);
  log(`${run.status} [${model}] saved ${pathFor(run.status)}`);
  return { path: pathFor(run.status), run };
}
