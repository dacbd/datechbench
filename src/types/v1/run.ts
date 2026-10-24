import { generateText, type ModelMessage } from 'ai';
import { formatDuration, log } from '../../core/log.js';
import { resolveModel } from '../../core/models.js';
import type { Question, QuestionResult, Stats, V1Bench, V1Results } from './schema.js';
import { ANSWER_TOOL, answerTools } from './tool.js';

const DEFAULT_SYSTEM = 'Answer each multiple choice question by calling the answer_question tool.';

const formatPrompt = (q: Question) =>
  [q.question, '', ...q.choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`)].join('\n');

// Fisher-Yates over indices, so duplicate choice texts are still tracked correctly.
function shuffleQuestion(q: Question): Question {
  const order = q.choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const answerIndex = q.answer.charCodeAt(0) - 65;
  return {
    ...q,
    choices: order.map((i) => q.choices[i]!),
    answer: String.fromCharCode(65 + order.indexOf(answerIndex)),
  };
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Each ask presents the choices in a fresh random order. Letters in the result
// (expected/chosen) refer to that presented order, which is recorded in `choices`.
// `session` is the conversation so far; it is extended in place after each successful request.
async function askQuestion(
  model: string,
  system: string,
  original: Question,
  id: string,
  session: ModelMessage[],
  shuffle: boolean,
): Promise<QuestionResult> {
  const q = shuffle ? shuffleQuestion(original) : original;
  const started = performance.now();
  let tokens = { input: 0, output: 0, reasoning: 0, total: 0 };
  const base = () => ({
    id,
    choices: q.choices,
    expected: q.answer,
    durationMs: Math.round(performance.now() - started),
    tokens,
  });
  try {
    const result = await generateText({
      model: resolveModel(model),
      system,
      messages: [...session, { role: 'user', content: formatPrompt(q) }],
      tools: answerTools(q),
      toolChoice: 'required',
    });
    const u = result.usage;
    tokens = {
      input: u.inputTokens ?? 0,
      output: u.outputTokens ?? 0,
      reasoning: u.outputTokenDetails.reasoningTokens ?? 0,
      total: u.totalTokens ?? 0,
    };
    session.push({ role: 'user', content: formatPrompt(q) }, ...result.response.messages);
    // The answer tool has no executor, so close every call with a result to keep
    // the transcript valid for the next question.
    if (result.toolCalls.length > 0) {
      session.push({
        role: 'tool',
        content: result.toolCalls.map((c) => ({
          type: 'tool-result' as const,
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          output: {
            type: 'text' as const,
            value: c.toolName === ANSWER_TOOL && !c.invalid ? 'Answer recorded.' : 'Invalid tool call.',
          },
        })),
      });
    }
    const call = result.toolCalls[0];
    if (!call) return { ...base(), chosen: null, correct: false, failureReason: 'no_tool_call' };
    if (call.toolName !== ANSWER_TOOL) {
      return { ...base(), chosen: null, correct: false, failureReason: 'wrong_tool', error: `called ${call.toolName}` };
    }
    if (call.invalid) {
      return {
        ...base(),
        chosen: null,
        correct: false,
        failureReason: 'invalid_tool_input',
        error: errorMessage(call.error),
      };
    }
    const chosen = (call.input as { choice: string }).choice;
    const correct = chosen === q.answer;
    return { ...base(), chosen, correct, ...(correct ? {} : { failureReason: 'wrong_answer' as const }) };
  } catch (err) {
    return { ...base(), chosen: null, correct: false, failureReason: 'request_error', error: errorMessage(err) };
  }
}

const computeStats = (questions: QuestionResult[], wallTimeMs: number): Stats => {
  const apiTimeMs = questions.reduce((sum, q) => sum + q.durationMs, 0);
  const sumTokens = (key: 'output' | 'total') => questions.reduce((sum, q) => sum + q.tokens[key], 0);
  return {
    wallTimeMs: Math.round(wallTimeMs),
    apiTimeMs,
    totalTokens: sumTokens('total'),
    avgTokensPerSecond: apiTimeMs > 0 ? Math.round((sumTokens('output') / (apiTimeMs / 1000)) * 10) / 10 : 0,
  };
};

export async function run(bench: V1Bench): Promise<V1Results> {
  const system = bench.system ?? DEFAULT_SYSTEM;
  const shuffle = bench.modes.includes('shuffle');
  const isolated = bench.modes.includes('isolated');
  log(
    `start bench="${bench.name}" version=${bench.version} models=[${bench.models.join(', ')}] ` +
      `modes=[${bench.modes.join(', ')}] questions=${bench.questions.length}`,
  );
  const results: V1Results = [];
  for (const model of bench.models) {
    const modelStarted = performance.now();
    const questions: QuestionResult[] = [];
    // Default: one session per model, so each question sees all earlier ones.
    // Isolated: a fresh, empty session for every question.
    const shared: ModelMessage[] = [];
    for (const [i, q] of bench.questions.entries()) {
      const session = isolated ? [] : shared;
      const id = q.id ?? String(i + 1);
      const label = `[${model}] ${i + 1}/${bench.questions.length} ${id}`;
      log(`ask ${label}`);
      const result = await askQuestion(model, system, q, id, session, shuffle);
      log(
        `done ${label} ${result.correct ? 'correct' : `incorrect (${result.failureReason})`} ` +
          `in ${formatDuration(result.durationMs)}, ${result.tokens.output} tokens (${result.tokens.reasoning} thinking)`,
      );
      questions.push(result);
    }
    const correct = questions.filter((q) => q.correct).length;
    const stats = computeStats(questions, performance.now() - modelStarted);
    log(
      `finish [${model}] ${correct}/${questions.length} wall=${formatDuration(stats.wallTimeMs)} ` +
        `api=${formatDuration(stats.apiTimeMs)} tokens=${stats.totalTokens} avg=${stats.avgTokensPerSecond.toFixed(1)} tok/s`,
    );
    results.push({ model, correct, total: questions.length, score: correct / questions.length, questions, stats });
  }
  return results;
}
