import { tool } from 'ai';
import { z } from 'zod';
import type { Question } from './schema.js';

export const ANSWER_TOOL = 'answer_question';

export const choiceLetters = (question: Question) =>
  question.choices.map((_, i) => String.fromCharCode(65 + i));

// The scantron: the model's only way to respond is to pick a letter.
export const answerTools = (question: Question) => ({
  [ANSWER_TOOL]: tool({
    description: 'Submit your answer to the multiple choice question.',
    inputSchema: z.strictObject({
      choice: z.enum(choiceLetters(question) as [string, ...string[]]),
    }),
  }),
});
