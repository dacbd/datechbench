import type { Run } from '../../core/bench.js';
import type { Stats, V1Results, V1Summary } from './schema.js';

type Row = V1Summary['benches'][number]['models'][number];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;

const meanStats = (all: Stats[]): Stats => {
  const m = (key: keyof Stats) => mean(all.map((s) => s[key]));
  return {
    wallTimeMs: Math.round(m('wallTimeMs')),
    apiTimeMs: Math.round(m('apiTimeMs')),
    inputTokens: Math.round(m('inputTokens')),
    outputTokens: Math.round(m('outputTokens')),
    totalTokens: Math.round(m('totalTokens')),
    avgTokensPerSecond: round(m('avgTokensPerSecond'), 1),
  };
};

// One row per bench, model and mode set. Scores and stats only count successful
// runs, since a failed run's numbers cover a partial or broken attempt.
function summarizeGroup(runs: { file: string; run: Run<V1Results> }[]): Row {
  const sorted = [...runs].sort((a, b) => a.run.startedAt.localeCompare(b.run.startedAt));
  const ok = sorted.flatMap(({ run }) => (run.status === 'success' && run.results ? [run.results] : []));
  const scores = ok.map((r) => r.score);
  const { file, run: last } = sorted.at(-1)!;
  return {
    provider: last.provider,
    model: last.model,
    modes: last.results?.modes ?? [],
    runs: sorted.length,
    successes: ok.length,
    failures: sorted.length - ok.length,
    score: scores.length
      ? { mean: round(mean(scores), 4), min: round(Math.min(...scores), 4), max: round(Math.max(...scores), 4) }
      : null,
    meanStats: ok.length ? meanStats(ok.map((r) => r.stats)) : null,
    latest: {
      file,
      startedAt: last.startedAt,
      status: last.status,
      failure: last.failure?.reason ?? null,
      score: last.status === 'success' && last.results ? round(last.results.score, 4) : null,
    },
  };
}

export function summarize(runs: { file: string; run: Run<V1Results> }[]): V1Summary {
  const byBench = new Map<string, Map<string, typeof runs>>();
  for (const entry of runs) {
    const { bench, model, results } = entry.run;
    const key = `${model}\0${[...(results?.modes ?? [])].sort().join(',')}`;
    const groups = byBench.get(bench.name) ?? new Map<string, typeof runs>();
    groups.set(key, [...(groups.get(key) ?? []), entry]);
    byBench.set(bench.name, groups);
  }
  const benches = [...byBench.entries()].map(([name, groups]) => {
    const all = [...groups.values()].flat().sort((a, b) => a.run.startedAt.localeCompare(b.run.startedAt));
    const models = [...groups.values()].map(summarizeGroup).sort(
      (a, b) =>
        (b.score?.mean ?? -1) - (a.score?.mean ?? -1) ||
        a.model.localeCompare(b.model) ||
        a.modes.join(',').localeCompare(b.modes.join(',')),
    );
    const latestResults = all.map((e) => e.run.results).filter((r) => r !== null).at(-1);
    return { name, questions: latestResults?.total ?? 0, models };
  });
  return { version: 'v1', benches: benches.sort((a, b) => a.name.localeCompare(b.name)) };
}
