import type { Verbosity } from '../../core/bench.js';
import type { V1Results } from './schema.js';

export const view = ({ questions, ...summary }: V1Results, verbosity: Verbosity) => {
  if (verbosity === 0) return summary;
  if (verbosity === 1) return { ...summary, questions: questions.map(({ id, correct }) => ({ id, correct })) };
  if (verbosity === 2) return { ...summary, questions: questions.map(({ transcript: _, ...q }) => q) };
  return { ...summary, questions };
};
