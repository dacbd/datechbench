# Bench YAML and run files live in the datechbench bucket on the tailnet RustFS, not in git.
# "s3" is the local rclone remote (~/.config/rclone/rclone.conf). Override with
# `just remote=other:bucket/benches push` or `just runs_remote=other:bucket/results push-runs`.
remote := "s3:datechbench/benches"
runs_remote := "s3:datechbench/results"

# Run `just` to list recipes.
default:
    @just --list

# Install dependencies
install:
    npm install

# Compile to dist/
build:
    npm run build

# Typecheck without emitting
check:
    npm run typecheck

# List bench types
types:
    @npm run --silent start -- --list

# Print the JSON Schema for a bench type's YAML
schema version="v1":
    @npm run --silent start -- --schema {{version}}

# Run a bench, saving each model's run to results/v1/runs/<bench>/ and printing a report to stdout.
# Pass -v/-vv/-vvv for more detail on stdout. Accepts a name in benches/ or a path.
run bench *flags:
    @npm run --silent start -- --bench {{ if bench =~ '\.ya?ml$' { bench } else { "benches/" + bench + ".yaml" } }} {{flags}}

# Rebuild results/<version>/summary.json (checked in) from every saved run
build-summary:
    @npm run --silent start -- --build-summary

# Smoke test: run benches/example.yaml
test:
    @just run example

# Run every bench in benches/, keep going past failed runs, then rebuild the summary
all:
    #!/usr/bin/env bash
    set -uo pipefail
    status=0
    for f in benches/*.yaml; do just run "$f" > /dev/null || status=1; done
    just build-summary
    exit $status

# Upload local benches to the bucket. Never deletes; keeps remote files that are newer.
push *flags:
    rclone copy benches {{remote}} --update --filter '- example.yaml' --filter '+ *.{yaml,yml}' --filter '- *' {{flags}}

# Download benches from the bucket. Never deletes; keeps local files that are newer.
pull *flags:
    rclone copy {{remote}} benches --update --filter '+ *.{yaml,yml}' --filter '- *' {{flags}}

# Upload local run files (results/<version>/runs/) to the bucket. Never deletes; keeps remote files that are newer.
push-runs *flags:
    rclone copy results {{runs_remote}} --update --filter '- *.tmp' --filter '+ */runs/**.json' --filter '- *' {{flags}}

# Download run files from the bucket into results/<version>/runs/. Never deletes; keeps local files that are newer.
pull-runs *flags:
    rclone copy {{runs_remote}} results --update --filter '+ */runs/**.json' --filter '- *' {{flags}}
