import { defineBenchType } from '../../core/bench.js';
import { run } from './run.js';
import { benchSchema, resultSchema } from './schema.js';

export const v1 = defineBenchType({
  version: 'v1',
  description: 'Multiple choice: the model answers each question by calling a single answer tool.',
  benchSchema,
  resultSchema,
  run,
});
