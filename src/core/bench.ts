import { z } from 'zod';

// Fields shared by every bench type. Each type's schema spreads this shape in
// and adds its own `version` literal plus whatever else it needs.
export const baseBenchShape = {
  name: z.string().min(1).describe('Human readable bench name.'),
  description: z.string().optional().describe('What this bench measures.'),
  models: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Models to run. Bare names (e.g. "gemma4-12b") use the local inference router; ids with a provider prefix (e.g. "anthropic/claude-sonnet-4.5") use the Vercel AI Gateway.',
    ),
  system: z
    .string()
    .optional()
    .describe('System prompt override. Each type supplies a default.'),
};

const baseBenchSchema = z.object({ version: z.string(), ...baseBenchShape });
export type BaseBench = z.infer<typeof baseBenchSchema>;

// A bench type owns everything about one `version`: what its YAML looks like,
// what its results look like, and how to execute it.
export type BenchType<Version extends string, Bench extends BaseBench, Results> = {
  version: Version;
  description: string;
  benchSchema: z.ZodType<Bench>;
  resultSchema: z.ZodType<Results>;
  run(bench: Bench): Promise<Results>;
};

export const defineBenchType = <
  Version extends string,
  Bench extends BaseBench,
  Results,
>(
  type: BenchType<Version, Bench, Results>,
) => type;

// Type-erased form used by the registry and CLI.
export type AnyBenchType = {
  version: string;
  description: string;
  benchSchema: z.ZodType<BaseBench>;
  resultSchema: z.ZodType<unknown>;
  run(bench: BaseBench): Promise<unknown>;
};

export const reportSchema = z.strictObject({
  version: z.string(),
  bench: z.string(),
  ranAt: z.iso.datetime(),
  results: z.unknown(),
});
export type Report = z.infer<typeof reportSchema>;
