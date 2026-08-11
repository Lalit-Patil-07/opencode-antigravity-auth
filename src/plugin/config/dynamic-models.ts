import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { getAntigravityHeaders, ANTIGRAVITY_ENDPOINT_PROD } from "../../constants";
import { getConfigDir } from "../storage";
import {
  OPENCODE_MODEL_DEFINITIONS,
  type ModelThinkingLevel,
  type OpencodeModelDefinition,
  type OpencodeModelDefinitions,
} from "./models";

/**
 * Dynamic model discovery from the Antigravity fetchAvailableModels endpoint.
 *
 * The plugin ships a curated static list (models.ts) so it works offline and
 * before first login, but the account the user actually authenticates with may
 * see a different (usually newer) set of models. This module queries the API,
 * merges the results over the static definitions and caches them on disk so a
 * later refresh can fall back gracefully when the network is unavailable.
 */

export interface DynamicModelInfo {
  id: string;
  displayName?: string;
  provider?: string;
  supportsThinking?: boolean;
  supportsImages?: boolean;
  maxTokens?: number;
  maxOutputTokens?: number;
  quotaInfo?: { quotaGroup?: string };
}

export interface FetchAvailableModelsOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

export interface RefreshModelDefinitionsOptions extends FetchAvailableModelsOptions {
  cachePath?: string;
}

export interface RefreshModelDefinitionsResult {
  updated: boolean;
  error?: string;
}

export const MODELS_CACHE_FILE = "antigravity-models.json";

export const DEFAULT_MODEL_LIMIT = { context: 1048576, output: 65536 };

const DEFAULT_MODALITIES: OpencodeModelDefinition["modalities"] = {
  input: ["text", "image", "pdf"],
  output: ["text"],
};

const FLASH_VARIANTS: OpencodeModelDefinition["variants"] = {
  low: { thinkingLevel: "low" },
  medium: { thinkingLevel: "medium" },
  high: { thinkingLevel: "high" },
};

const PRO_VARIANTS: OpencodeModelDefinition["variants"] = {
  low: { thinkingLevel: "low" },
  high: { thinkingLevel: "high" },
};

const EXTRA_LOW_VARIANTS: OpencodeModelDefinition["variants"] = {
  "extra-low": { thinkingLevel: "minimal" },
};

const CLAUDE_THINKING_VARIANTS: OpencodeModelDefinition["variants"] = {
  low: { thinkingConfig: { thinkingBudget: 8192 } },
  max: { thinkingConfig: { thinkingBudget: 32768 } },
};

let effectiveDefinitions: OpencodeModelDefinitions | null = null;

export function getEffectiveModelDefinitions(): OpencodeModelDefinitions {
  return effectiveDefinitions ?? OPENCODE_MODEL_DEFINITIONS;
}

/** Test hook (and emergency reset) that clears any activated dynamic definitions. */
export function resetDynamicModelState(): void {
  effectiveDefinitions = null;
}

export function getModelsCachePath(): string {
  return join(getConfigDir(), MODELS_CACHE_FILE);
}

function extractModelId(entry: Record<string, unknown>): string | undefined {
  const id = entry.id ?? entry.modelId ?? entry.model ?? entry.name;
  if (typeof id !== "string") return undefined;
  const stripped = id.startsWith("models/") ? id.slice("models/".length) : id;
  return stripped.trim() || undefined;
}

function shouldSkipDynamicModel(id: string): boolean {
  // chat_/tab_ prefixed ids are internal placeholder models (no displayName).
  // gemini-2.5-* entries returned by the API are displayName aliases of newer
  // families ("Gemini 3.1 Flash Lite") and would pollute the model list.
  // gemini-pro-agent / gemini-3-flash-agent are CLI agent aliases.
  return (
    /^(chat_|tab_)/.test(id) ||
    /^gemini-2\.5-/.test(id) ||
    /^gemini-pro-latest$/.test(id) ||
    /^gemini-(pro|3-flash)-agent$/.test(id)
  );
}

/**
 * Normalizes an API model id to its config family id.
 * Antigravity exposes tiered names (gemini-3.6-flash-low) that map to a single
 * config family (antigravity-gemini-3.6-flash) with tier variants.
 * gpt-oss-120b-medium and claude-opus-4-6-thinking keep their full names.
 */
function normalizeModelId(id: string): { family: string; tier?: string } {
  const tierMatch = id.match(/^(gemini-3\.(?:5|6)-flash|gemini-3\.1-pro)-(extra-low|low|medium|high)$/);
  if (tierMatch?.[1] && tierMatch[2]) return { family: tierMatch[1], tier: tierMatch[2] };
  return { family: id };
}

export async function fetchAvailableModels(
  accessToken: string,
  options: FetchAvailableModelsOptions = {},
): Promise<DynamicModelInfo[]> {
  const endpoint = options.endpoint ?? ANTIGRAVITY_ENDPOINT_PROD;
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(`${endpoint}/v1internal:fetchAvailableModels`, {
    method: "POST",
    headers: {
      ...getAntigravityHeaders(),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Antigravity models (${response.status})`);
  }
  const payload = (await response.json()) as {
    models?: Record<string, unknown> | Record<string, unknown>[];
  };
  const rawModels = payload?.models;
  let entries: Array<{ id?: string; entry: Record<string, unknown> }>;
  if (Array.isArray(rawModels)) {
    entries = rawModels.map((entry) => ({ entry }));
  } else if (rawModels && typeof rawModels === "object") {
    // Real API shape: models is a map keyed by model id, entries carry no id.
    entries = Object.entries(rawModels).map(([id, entry]) => ({ id, entry: entry as Record<string, unknown> }));
  } else {
    entries = [];
  }
  // Dedupe by id, last occurrence wins (mirrors pi's getAvailableModels behavior).
  const byId = new Map<string, DynamicModelInfo>();
  for (const { id: keyId, entry } of entries) {
    // Object-map entries carry the real id as the map key; their entry.model
    // is an obfuscated placeholder (MODEL_PLACEHOLDER_M*) and must NOT win.
    const id = keyId ?? extractModelId(entry);
    if (!id || shouldSkipDynamicModel(id)) continue;
    byId.set(id, {
      id,
      displayName: typeof entry.displayName === "string" ? entry.displayName : typeof entry.name === "string" ? entry.name : undefined,
      provider: typeof entry.provider === "string" ? entry.provider : undefined,
      supportsThinking: Boolean(entry.supportsThinking),
      supportsImages: Boolean(entry.supportsImages),
      maxTokens: typeof entry.maxTokens === "number" ? entry.maxTokens : undefined,
      maxOutputTokens: typeof entry.maxOutputTokens === "number" ? entry.maxOutputTokens : undefined,
      quotaInfo: entry.quotaInfo as DynamicModelInfo["quotaInfo"],
    });
  }
  return [...byId.values()];
}

function inferVariants(id: string): OpencodeModelDefinition["variants"] | undefined {
  if (/claude-.*-thinking/.test(id)) {
    return CLAUDE_THINKING_VARIANTS;
  }
  if (/^claude-/.test(id)) {
    return undefined;
  }
  if (/^gemini-3\.(?:5|6)-flash/.test(id)) {
    return { ...FLASH_VARIANTS, ...EXTRA_LOW_VARIANTS };
  }
  if (/^gemini-3\.1-pro/.test(id)) {
    return PRO_VARIANTS;
  }
  if (/gemini-2\.5-(pro|flash)/.test(id)) {
    return /-flash/.test(id) ? FLASH_VARIANTS : PRO_VARIANTS;
  }
  return undefined;
}

export function mergeDynamicModels(
  dynamicModels: DynamicModelInfo[],
  staticDefinitions: OpencodeModelDefinitions = OPENCODE_MODEL_DEFINITIONS,
): OpencodeModelDefinitions {
  const merged: OpencodeModelDefinitions = { ...staticDefinitions };
  for (const model of dynamicModels) {
    const { family, tier } = normalizeModelId(model.id);
    const key = `antigravity-${family}`;
    const existing = merged[key];
    const limit = {
      context: model.maxTokens ?? existing?.limit?.context ?? DEFAULT_MODEL_LIMIT.context,
      output: model.maxOutputTokens ?? existing?.limit?.output ?? DEFAULT_MODEL_LIMIT.output,
    };
    let variants = existing?.variants ?? inferVariants(family);
    if (tier && variants) {
      // API exposes more tiers than the static config (e.g. extra-low) —
      // merge them in while preserving static variants.
      const level: ModelThinkingLevel = tier === "extra-low" ? "minimal" : (tier as ModelThinkingLevel);
      const tierVariant = { [tier]: { thinkingLevel: level } };
      variants = { ...variants, ...tierVariant };
    }
    merged[key] = {
      name: existing?.name ?? model.displayName ?? family,
      limit,
      modalities: existing?.modalities ?? DEFAULT_MODALITIES,
      variants,
    } satisfies OpencodeModelDefinition;
  }
  return merged;
}

export async function refreshModelDefinitionsFromApi(
  accessToken: string,
  options: RefreshModelDefinitionsOptions = {},
): Promise<RefreshModelDefinitionsResult> {
  const cachePath = options.cachePath ?? getModelsCachePath();
  try {
    const models = await fetchAvailableModels(accessToken, options);
    effectiveDefinitions = mergeDynamicModels(models);
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({ version: 1, fetchedAt: Date.now(), models }, null, 2),
      "utf-8",
    );
    return { updated: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const raw = await readFile(cachePath, "utf-8");
      const cached = JSON.parse(raw) as { models?: DynamicModelInfo[] };
      if (!Array.isArray(cached.models) || cached.models.length === 0) {
        throw new Error("cache empty");
      }
      effectiveDefinitions = mergeDynamicModels(cached.models);
      return { updated: false, error: message };
    } catch {
      effectiveDefinitions = null;
      return { updated: false, error: message };
    }
  }
}
