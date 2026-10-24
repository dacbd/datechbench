# Bench YAML lives in the datechbench bucket on the tailnet RustFS, not in git.
# "s3" is the local rclone remote (~/.config/rclone/rclone.conf). Override with
# `just remote=other:bucket/benches push`.
remote := "s3:datechbench/benches"

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

# Run a bench, printing results to stdout. Pass -v/-vv/-vvv for more detail. Accepts a name in benches/ or a path.
run bench *flags:
    @npm run --silent start -- --bench {{ if bench =~ '\.ya?ml$' { bench } else { "benches/" + bench + ".yaml" } }} {{flags}}

# Run a bench and save results to results/<name>-<timestamp>.json
save bench *flags:
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p results
    file="{{bench}}"
    [[ "$file" == *.yaml || "$file" == *.yml ]] || file="benches/$file.yaml"
    out="results/$(basename "${file%.*}")-$(date +%Y%m%dT%H%M%S).json"
    npm run --silent start -- --bench "$file" --output "$out" {{flags}}

# Smoke test: run benches/example.yaml
test:
    @just run example

# Run every bench in benches/, saving each to results/
all:
    #!/usr/bin/env bash
    set -euo pipefail
    for f in benches/*.yaml; do just save "$f"; done

# Upload local benches to the bucket. Never deletes; keeps remote files that are newer.
push *flags:
    rclone copy benches {{remote}} --update --filter '- example.yaml' --filter '+ *.{yaml,yml}' --filter '- *' {{flags}}

# Download benches from the bucket. Never deletes; keeps local files that are newer.
pull *flags:
    rclone copy {{remote}} benches --update --filter '+ *.{yaml,yml}' --filter '- *' {{flags}}
