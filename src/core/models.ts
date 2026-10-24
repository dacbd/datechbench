import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

// Local inference (see ../infra/apps/inference/model-router): a LiteLLM router
// that serves OpenAI-compatible endpoints and picks the backend by model name.
export const DEFAULT_BASE_URL = 'https://inference.int.dacbd.dev/v1';

// "anthropic/claude-sonnet-4.5" -> anthropic + claude-sonnet-4.5; "gemma4-12b" -> local + gemma4-12b.
export const splitModelId = (id: string) => {
  const slash = id.indexOf('/');
  return slash === -1
    ? { provider: 'local', name: id }
    : { provider: id.slice(0, slash), name: id.slice(slash + 1) };
};

// Bare names ("gemma4-12b") go to the local router. Ids with a provider prefix
// ("anthropic/claude-sonnet-4.5") go through the Vercel AI Gateway instead.
export function resolveModel(id: string): LanguageModel {
  if (id.includes('/')) return id;
  const local = createOpenAICompatible({
    name: 'local',
    baseURL: process.env.DATECHBENCH_BASE_URL ?? DEFAULT_BASE_URL,
    apiKey: process.env.DATECHBENCH_API_KEY ?? 'unused',
  });
  return local(id);
}
