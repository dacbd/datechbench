# datechbench
A tech knowledge area LLM benchmark.

## Usage

Everything is driven through [`just`](https://github.com/casey/just); run `just` to list recipes.

```sh
just install               # install dependencies
just test                  # smoke test: run benches/example.yaml
just run example           # run a bench, printing results to stdout
just save example          # run a bench, saving to results/<name>-<timestamp>.json
just all                   # run every bench in benches/, saving each to results/
just check                 # typecheck
```

A bench is a name from `benches/` (`example`) or a path to a YAML file. Progress
is logged to stderr, so stdout is only the JSON report. The recipes run the CLI
from source with `tsx`; `just build` compiles to `dist/` (the `datechbench` bin).

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
- `src/core/` – base schema, `defineBenchType`, registry, YAML loader, model resolution
- `src/types/<version>/` – one folder per bench type: `schema.ts` (bench + result zod schemas), `tool.ts`, `run.ts`, `index.ts`

To add a type, create `src/types/<version>/` exporting a `defineBenchType({...})`
and list it in `src/core/registry.ts`. Results are validated against the type's
result schema before being printed or saved.
