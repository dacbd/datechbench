import { z } from 'zod';
import { baseBenchShape } from '../../core/bench.js';

export const questionSchema = z
  .strictObject({
    id: z.string().optional().describe('Stable identifier used in results. Defaults to the 1-based position.'),
    question: z.string().min(1).describe('The question text.'),
    choices: z
      .array(z.string().min(1))
      .min(2)
      .max(26)
      .describe('Answer options. They are lettered A, B, C... in order.'),
    answer: z
      .string()
      .regex(/^[A-Z]$/)
      .describe('Letter of the correct choice, e.g. "B".'),
    reference: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Where the answer can be verified, e.g. a documentation URL, a source file link, or a command such as "kubectl logs --help" or "man 1 tar". Never shown to the model.',
      ),
  })
  .refine((q) => q.answer.charCodeAt(0) - 65 < q.choices.length, {
    message: 'answer must be the letter of one of the choices',
    path: ['answer'],
  });
export type Question = z.infer<typeof questionSchema>;

export const testModeSchema = z.enum(['shuffle', 'isolated']);
export type TestMode = z.infer<typeof testModeSchema>;

const benchDateSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

export const benchSchema = z.strictObject({
  version: z.literal('v1').describe('Bench type: multiple choice.'),
  ...baseBenchShape,
  created_at: benchDateSchema
    .optional()
    .describe('When the bench was first written, as an ISO 8601 date (2026-10-24) or datetime.'),
  last_updated_at: benchDateSchema
    .optional()
    .describe('When the questions were last changed, as an ISO 8601 date (2026-10-24) or datetime.'),
  modes: z
    .array(testModeSchema)
    .refine((m) => new Set(m).size === m.length, { message: 'modes must not repeat' })
    .default([])
    .describe(
      'Test modes, all off by default. shuffle: present each question\'s choices in a fresh random order every time it is asked. isolated: send every question in its own independent session, as if the model took one single-question test per question; without it, all questions go through one continuous conversation per model, so each question sees the earlier ones and the model\'s answers.',
    ),
  questions: z.array(questionSchema).min(1).describe('Multiple choice questions, asked one at a time.'),
});
export type V1Bench = z.infer<typeof benchSchema>;

export const failureReasonSchema = z
  .enum(['wrong_answer', 'no_tool_call', 'wrong_tool', 'invalid_tool_input', 'request_error'])
  .describe(
    'Why a question was not answered correctly. wrong_answer: valid choice, but not the right one. no_tool_call: the model replied without calling the answer tool. wrong_tool: it called a tool that is not the answer tool. invalid_tool_input: it called the answer tool with input that failed validation (e.g. a letter that is not a choice). request_error: the request itself failed (network, auth, server).',
  );
export type FailureReason = z.infer<typeof failureReasonSchema>;

export const tokenUsageSchema = z.strictObject({
  input: z.number().int().nonnegative().describe('Prompt tokens, including earlier turns of the session.'),
  output: z.number().int().nonnegative().describe('Tokens generated, including reasoning tokens.'),
  reasoning: z.number().int().nonnegative().describe('Thinking tokens, a subset of output. 0 if the provider does not report them.'),
  total: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const statsSchema = z.strictObject({
  wallTimeMs: z.number().nonnegative().describe('Elapsed real time for the whole run.'),
  apiTimeMs: z.number().nonnegative().describe('Time spent waiting on model requests, summed over questions.'),
  inputTokens: z.number().int().nonnegative().describe('Prompt tokens across all questions, including earlier turns of each session.'),
  outputTokens: z.number().int().nonnegative().describe('Generated tokens across all questions, including reasoning tokens.'),
  totalTokens: z.number().int().nonnegative().describe('Input plus output tokens across all questions.'),
  avgTokensPerSecond: z
    .number()
    .nonnegative()
    .describe('Generated (output) tokens divided by api time; 0 if there was no api time.'),
});
export type Stats = z.infer<typeof statsSchema>;

export const questionResultSchema = z
  .strictObject({
    id: z.string(),
    choices: z.array(z.string()).describe('The choices in the random order they were presented; letters below index into this.'),
    expected: z.string().describe('Letter of the correct choice in the presented order.'),
    chosen: z.string().nullable().describe('Letter the model submitted (presented order), or null if it never answered.'),
    correct: z.boolean(),
    failureReason: failureReasonSchema.optional().describe('Present if and only if correct is false.'),
    error: z.string().optional().describe('Detail for tool/request failures.'),
    durationMs: z.number().nonnegative().describe('Time the model request took.'),
    tokens: tokenUsageSchema,
    transcript: z
      .array(z.unknown())
      .describe(
        'Messages exchanged for this question: the prompt, the model response, and the tool result. Without isolated mode, earlier questions\' transcripts precede it in the conversation.',
      ),
  })
  .refine((r) => r.correct === (r.failureReason === undefined), {
    message: 'failureReason must be set exactly when correct is false',
    path: ['failureReason'],
  });
export type QuestionResult = z.infer<typeof questionResultSchema>;

export const modelResultSchema = z.strictObject({
  model: z.string(),
  correct: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  score: z.number().min(0).max(1),
  questions: z.array(questionResultSchema),
  stats: statsSchema,
});

export const resultSchema = z.array(modelResultSchema);
export type V1Results = z.infer<typeof resultSchema>;
