// Progress logging goes to stderr so stdout stays clean for the JSON report.
export const log = (message: string) =>
  console.error(`${new Date().toISOString().slice(11, 19)} ${message}`);

export const formatDuration = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
