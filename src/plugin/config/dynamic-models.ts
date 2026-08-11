import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { getAntigravityHeaders } from "../../constants";
import { getConfigDir } from "../storage";
import {
  OPENCODE_MODEL_DEFINITIONS,
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

export async function fetchAvailableModels(
  accessToken: string,
  options: FetchAvailableModelsOptions = {},
): Promise<DynamicModelInfo[]> {
  const endpoint = options.endpoint ?? "https://clients5.google.com/ai";
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(`${endpoint}/v1internal:fetchAvailableModels`, {
    method: "POST",
    headers: {
      ...getAntigravityHeaders(),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      metadata: { ideType: "ANTIGRAVITY", platform: "GEMINI_CLI", pluginType: "GEMINI" },
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Antigravity models (${response.status})`);
  }
  const payload = (await response.json()) as {
    models?: Record<string, unknown>[];
  };
  const entries = Array.isArray(payload?.models) ? payload.models : [];
  // Dedupe by id, last occurrence wins (mirrors pi's getAvailableModels behavior).
  const byId = new Map<string, DynamicModelInfo>();
  for (const entry of entries) {
    const id = extractModelId(entry);
    if (!id) continue;
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
  if (/gemini-3.*-(pro|flash)/.test(id)) {
    return /-flash/.test(id) ? FLASH_VARIANTS : PRO_VARIANTS;
  }
  if (/gemini-2\.5-(pro|flash)/.test(id)) {
    return /-flash/.test(id) ? FLASH_VARIANTS : PRO_VARIANTS;
  }
  return FLASH_VARIANTS;
}

export function mergeDynamicModels(
  dynamicModels: DynamicModelInfo[],
  staticDefinitions: OpencodeModelDefinitions = OPENCODE_MODEL_DEFINITIONS,
): OpencodeModelDefinitions {
  const merged: OpencodeModelDefinitions = { ...staticDefinitions };
  for (const model of dynamicModels) {
    const key = `antigravity-${model.id}`;
    const existing = merged[key];
    const limit = {
      context: model.maxTokens ?? existing?.limit?.context ?? DEFAULT_MODEL_LIMIT.context,
      output: model.maxOutputTokens ?? existing?.limit?.output ?? DEFAULT_MODEL_LIMIT.output,
    };
    merged[key] = {
      name: existing?.name ?? model.displayName ?? model.id,
      limit,
      modalities: existing?.modalities ?? DEFAULT_MODALITIES,
      variants: existing?.variants ?? inferVariants(model.id),
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
