import { defineBenchType } from '../../core/bench.js';
import { failure, run } from './run.js';
import { benchSchema, resultSchema, summarySchema } from './schema.js';
import { summarize } from './summary.js';
import { view } from './view.js';

export const v1 = defineBenchType({
  version: 'v1',
  description: 'Multiple choice: the model answers each question by calling a single answer tool.',
  benchSchema,
  resultSchema,
  summarySchema,
  run,
  failure,
  view,
  summarize,
});
