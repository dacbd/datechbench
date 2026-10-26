import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { log } from './log.js';

// Local inference (see ../infra/apps/inference/model-router): a LiteLLM router
// that serves OpenAI-compatible endpoints and picks the backend by model name.
export const DEFAULT_BASE_URL = 'https://inference.int.dacbd.dev/v1';

// Every other provider comes from the models.dev catalog: its id, the env vars
// holding its key, the AI SDK package that speaks its API, and its base URL.
const CATALOG_URL = 'https://models.dev/api.json';
const CATALOG_CACHE = '.cache/models.dev.json';
const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type CatalogProvider = {
  id: string;
  name: string;
  env: string[];
  npm: string;
  api?: string;
  models: Record<string, { tool_call?: boolean }>;
};
type Catalog = Record<string, CatalogProvider>;

// "openrouter/anthropic/claude-sonnet-4.5" -> openrouter + anthropic/claude-sonnet-4.5; "gemma4-12b" -> local + gemma4-12b.
export const splitModelId = (id: string) => {
  const slash = id.indexOf('/');
  return slash === -1
    ? { provider: 'local', name: id }
    : { provider: id.slice(0, slash), name: id.slice(slash + 1) };
};

// Cached on disk for a day. If a refresh fails, a stale copy is better than nothing.
let catalog: Promise<Catalog> | undefined;
const loadCatalog = () =>
  (catalog ??= (async () => {
    const age = existsSync(CATALOG_CACHE) ? Date.now() - statSync(CATALOG_CACHE).mtimeMs : Infinity;
    if (age < CATALOG_MAX_AGE_MS) return JSON.parse(readFileSync(CATALOG_CACHE, 'utf8')) as Catalog;
    try {
      const res = await fetch(CATALOG_URL);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const fresh = (await res.json()) as Catalog;
      mkdirSync(dirname(CATALOG_CACHE), { recursive: true });
      writeFileSync(`${CATALOG_CACHE}.tmp`, JSON.stringify(fresh));
      renameSync(`${CATALOG_CACHE}.tmp`, CATALOG_CACHE);
      log(`fetched ${CATALOG_URL}`);
      return fresh;
    } catch (err) {
      if (age === Infinity) throw new Error(`Could not fetch ${CATALOG_URL}: ${err instanceof Error ? err.message : err}`);
      log(`warning: could not refresh ${CATALOG_URL}, using the cached copy`);
      return JSON.parse(readFileSync(CATALOG_CACHE, 'utf8')) as Catalog;
    }
  })());

const local = () =>
  createOpenAICompatible({
    name: 'local',
    baseURL: process.env.DATECHBENCH_BASE_URL ?? DEFAULT_BASE_URL,
    apiKey: process.env.DATECHBENCH_API_KEY ?? 'unused',
  });

async function catalogModel(providerId: string, name: string): Promise<LanguageModel> {
  const provider = (await loadCatalog())[providerId];
  if (!provider) throw new Error(`Unknown provider "${providerId}"; see https://models.dev for provider ids.`);
  const entry = provider.models[name];
  if (!entry) log(`warning: ${providerId}/${name} is not in the models.dev catalog, trying it anyway`);
  else if (entry.tool_call === false) log(`warning: models.dev says ${providerId}/${name} does not support tool calls`);

  const keyVar = provider.env.find((v) => process.env[v]);
  if (!keyVar) throw new Error(`${provider.name} needs one of these env vars: ${provider.env.join(', ')}`);

  let sdk: Record<string, unknown>;
  try {
    sdk = await import(provider.npm);
  } catch {
    throw new Error(`${provider.name} uses ${provider.npm}, which is not installed: npm install ${provider.npm}`);
  }
  // Every AI SDK provider package exports a single create* factory (createAnthropic, createOpenRouter, ...).
  const create = Object.entries(sdk).find(([k, v]) => k.startsWith('create') && typeof v === 'function')?.[1] as
    | ((opts: object) => { languageModel: (id: string) => LanguageModel })
    | undefined;
  if (!create) throw new Error(`${provider.npm} has no create* provider factory`);
  return create({ name: provider.id, apiKey: process.env[keyVar], ...(provider.api && { baseURL: provider.api }) })
    .languageModel(name);
}

// Bare names ("gemma4-12b") go to the local router. "<provider>/<model>" ids use
// that models.dev provider, e.g. "anthropic/claude-sonnet-4-5" or, through the
// Vercel AI Gateway, "vercel/anthropic/claude-sonnet-4.5". Memoized per id.
const resolved = new Map<string, Promise<LanguageModel>>();
export function resolveModel(id: string): Promise<LanguageModel> {
  let model = resolved.get(id);
  if (!model) {
    const { provider, name } = splitModelId(id);
    model = id.includes('/') ? catalogModel(provider, name) : Promise.resolve(local()(name));
    resolved.set(id, model);
  }
  return model;
}
