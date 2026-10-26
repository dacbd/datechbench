import { z } from 'zod';

// Fields shared by every bench type. Each type's schema spreads this shape in
// and adds its own `version` literal plus whatever else it needs.
export const baseBenchShape = {
  name: z
    .string()
    .min(1)
    .describe('Bench name. Runs are grouped under it in results/, so keep it stable and filename-safe.'),
  description: z.string().optional().describe('What this bench measures.'),
  models: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Models to run. Bare names (e.g. "gemma4-12b") use the local inference router; "<provider>/<model>" ids use that models.dev provider (e.g. "anthropic/claude-sonnet-4-5", or "vercel/anthropic/claude-sonnet-4.5" through the Vercel AI Gateway).',
    ),
  system: z
    .string()
    .optional()
    .describe('System prompt override. Each type supplies a default.'),
};

const baseBenchSchema = z.object({ version: z.string(), ...baseBenchShape });
export type BaseBench = z.infer<typeof baseBenchSchema>;

// How much of the results end up on stdout, from the CLI's -v flags. Run files
// always hold everything. 0: summary only, 1: per-question id/correct,
// 2: full question results, 3: plus api transcripts.
export type Verbosity = 0 | 1 | 2 | 3;

// One recorded run: a single model through a single bench. `results` is the
// bench type's own shape, and null only if the run died before reporting any.
export type Run<Results> = {
  $schema?: string;
  version: string;
  bench: { name: string; file: string; hash: string };
  provider: string;
  model: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'success' | 'failure';
  failure?: { reason: RunFailureReason; message: string };
  results: Results | null;
};

export const runFailureReasonSchema = z
  .enum(['incomplete', 'interrupted', 'harness_error', 'model_errors'])
  .describe(
    'Why the run is a failure. incomplete: the process died mid-run (this is what the file says until the run finishes). interrupted: stopped by SIGINT/SIGTERM. harness_error: the bench code threw. model_errors: the run finished, but the bench type reported errors such as failed requests or hitting the output limit.',
  );
export type RunFailureReason = z.infer<typeof runFailureReasonSchema>;

export const makeRunSchema = <Results>(version: string, resultSchema: z.ZodType<Results>) =>
  z
    .strictObject({
      $schema: z.string().optional(),
      version: z.literal(version),
      bench: z.strictObject({
        name: z.string(),
        file: z.string().describe('Path of the bench YAML the run was started from.'),
        hash: z
          .string()
          .describe('sha256 of the bench definition minus its model list; changes whenever questions, modes or the system prompt do.'),
      }),
      provider: z.string().describe('"local" for the inference router, otherwise the models.dev provider id.'),
      model: z.string().describe('Model id as written in the bench.'),
      startedAt: z.iso.datetime(),
      finishedAt: z.iso.datetime().nullable().describe('null if the process died mid-run.'),
      status: z.enum(['success', 'failure']),
      failure: z.strictObject({ reason: runFailureReasonSchema, message: z.string() }).optional(),
      results: resultSchema.nullable(),
    })
    .refine((r) => (r.status === 'failure') === (r.failure !== undefined), {
      message: 'failure must be set exactly when status is failure',
      path: ['failure'],
    });

// A bench type owns everything about one `version`: what its YAML looks like,
// what one model's results look like, how to execute it, and how runs roll up
// into results/<version>/summary.json.
export type BenchType<Version extends string, Bench extends BaseBench, Results, Summary> = {
  version: Version;
  description: string;
  benchSchema: z.ZodType<Bench>;
  resultSchema: z.ZodType<Results>;
  summarySchema: z.ZodType<Summary>;
  // Runs one model. Call `progress` with the results so far as often as is
  // useful; whatever was last reported is saved if the run dies.
  run(bench: Bench, model: string, progress: (results: Results) => void): Promise<Results>;
  // Why a run that finished should still count as a failure, if it should.
  failure(results: Results): string | undefined;
  view(results: Results, verbosity: Verbosity): unknown;
  summarize(runs: { file: string; run: Run<Results> }[]): Summary;
};

export const defineBenchType = <
  Version extends string,
  Bench extends BaseBench,
  Results,
  Summary,
>(
  type: BenchType<Version, Bench, Results, Summary>,
) => type;

// Type-erased form used by the registry and CLI.
export type AnyBenchType = {
  version: string;
  description: string;
  benchSchema: z.ZodType<BaseBench>;
  resultSchema: z.ZodType<unknown>;
  summarySchema: z.ZodType<unknown>;
  run(bench: BaseBench, model: string, progress: (results: unknown) => void): Promise<unknown>;
  failure(results: unknown): string | undefined;
  view(results: unknown, verbosity: Verbosity): unknown;
  summarize(runs: { file: string; run: Run<unknown> }[]): unknown;
};
