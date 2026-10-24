# datechbench
A tech knowledge area LLM benchmark.

## Usage

Everything is driven through [`just`](https://github.com/casey/just); run `just` to list recipes.

```sh
just install               # install dependencies
just test                  # smoke test: run benches/example.yaml
just run example           # run a bench, saving each model's run (add -v/-vv/-vvv for more on stdout)
just all                   # run every bench in benches/, then rebuild the summary
just build-summary         # rebuild results/v1/summary.json from the saved runs
just check                 # typecheck
just pull                  # download benches from s3:datechbench/benches
just push                  # upload local benches to s3:datechbench/benches
just pull-runs             # download run files from s3:datechbench/results
just push-runs             # upload local run files to s3:datechbench/results
```

Only `benches/example.yaml` is tracked in git; the real benches and the run
files live in the `datechbench` bucket on the tailnet RustFS and move through
the `s3` rclone remote. All four sync recipes copy without deleting, and never
overwrite a newer file on the other side. Extra flags pass through to rclone
(`just push --dry-run`). Run `just pull-runs` before `just build-summary` to
summarize runs from every machine. If a run was pushed mid-way, its leftover
`failure` file is ignored once the finished copy is present.

A bench is a name from `benches/` (`example`) or a path to a YAML file. Progress
is logged to stderr, so stdout is only the JSON report. The recipes run the CLI
from source with `tsx`; `just build` compiles to `dist/` (the `datechbench` bin).

## Results

```
results/v1/
  summary.json          # checked in: per bench, per model and mode set, built by `just build-summary`
  summary.schema.json   # JSON Schemas for both file kinds, regenerated alongside
  run.schema.json
  runs/<bench>/         # not checked in: one file per model run, full results and transcripts
    2026-10-24_1612.success.local.deepseek-v4-flash-0731.json
    2026-10-24_1640.failure.anthropic.claude-sonnet-4.5.json
```

Each model is its own run, named for its start time (UTC), outcome, provider
(`local` for the inference router) and model. The file is rewritten after every
question under the `failure` name and renamed to `success` only when the run
finishes cleanly, so a crash, kill or Ctrl-C still leaves everything up to that
point. `failure.reason` says why: `incomplete` (the process died), `interrupted`,
`harness_error`, or `model_errors` (it finished, but some questions hit a request
error or the output token limit). The summary's scores count successful runs only.

## Available benches

| Bench | Coverage |
| --- | --- |
| [example](benches/example.yaml) | 10-question smoke test |
| [argocd](benches/argocd.yaml) | 200 questions on Argo CD v3.4.12, progressing through eight difficulty bands from foundations to controller-source reasoning |

Run `just run argocd`. Update its `models` list to compare
your models. The [Argo CD answer key](docs/argocd.md) includes explanations,
commit-pinned official sources for every answer, and guidance for interpreting
scores. This bench uses shuffled choices and independent question sessions.

## Models

Bare model names (`deepseek-v4-flash-0731`) go to the local inference router
from `../infra` (`https://inference.int.dacbd.dev/v1`, OpenAI-compatible).
Override with `DATECHBENCH_BASE_URL` / `DATECHBENCH_API_KEY`. Names with a
provider prefix (`anthropic/claude-sonnet-4.5`) go through the Vercel AI Gateway
and need `AI_GATEWAY_API_KEY`.

## Bench types

Every bench YAML starts with a `version:` that selects its type. Schemas are
strict zod objects (unknown keys are rejected) and double as the documentation:

```sh
just types         # available types
just schema v1     # JSON Schema for a type's YAML
```

| Version | Type |
| --- | --- |
| `v1` | Multiple choice, answered through a single `answer_question` tool |

## Layout

- `benches/` – YAML bench definitions
- `results/` – run files and summaries, see [Results](#results)
- `src/core/` – base schema, `defineBenchType`, registry, YAML loader, model resolution, run recording (`runs.ts`) and summaries (`summary.ts`)
- `src/types/<version>/` – one folder per bench type: `schema.ts` (bench, result and summary zod schemas), `tool.ts`, `run.ts`, `view.ts`, `summary.ts`, `index.ts`

To add a type, create `src/types/<version>/` exporting a `defineBenchType({...})`
and list it in `src/core/registry.ts`. Run files are checked against the type's
result schema when saved, and `build-summary` skips (and reports) any that no longer match.
