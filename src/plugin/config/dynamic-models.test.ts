import { describe, expect, it, vi, afterAll, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ANTIGRAVITY_ENDPOINT_PROD } from "../../constants";
import { OPENCODE_MODEL_DEFINITIONS } from "./models";
import {
  fetchAvailableModels,
  getEffectiveModelDefinitions,
  mergeDynamicModels,
  refreshModelDefinitionsFromApi,
  resetDynamicModelState,
} from "./dynamic-models";

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

describe("fetchAvailableModels", () => {
  it("parses model ids from id/modelId/model/name fields and dedupes", async () => {
    const fetchMock = vi.fn<FetchMock>(async () =>
      okResponse({
        models: [
          { id: "models/gemini-3.6-flash", displayName: "Gemini 3.6 Flash", supportsThinking: true, supportsImages: true, maxTokens: 1000000, maxOutputTokens: 65536 },
          { modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", supportsThinking: true },
          { model: "gpt-oss-120b-medium", provider: "openai" },
          { id: "models/gemini-3.6-flash", displayName: "Gemini 3.6 Flash Duplicate", supportsImages: true, maxTokens: 999 },
        ],
      }),
    );

    const models = await fetchAvailableModels("test-token", { fetchImpl: fetchMock });

    expect(models.map((m) => m.id)).toEqual(["gemini-3.6-flash", "claude-sonnet-4-6", "gpt-oss-120b-medium"]);
    expect(models[0]?.displayName).toBe("Gemini 3.6 Flash Duplicate");
    expect(models[0]?.supportsImages).toBe(true);
    expect(models[1]?.provider).toBe("anthropic");

    const call = fetchMock.mock.calls[0]?.[0] as string;
    expect(call).toBe(`${ANTIGRAVITY_ENDPOINT_PROD}/v1internal:fetchAvailableModels`);
    const init = fetchMock.mock.calls[0]?.[1] ?? {};
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
  });

  it("parses the real object-map response shape (models keyed by id)", async () => {
    const fetchMock = vi.fn<FetchMock>(async () =>
      okResponse({
        models: {
          "gemini-3.6-flash-low": { displayName: "Gemini 3.6 Flash (Low)", supportsThinking: true, maxTokens: 1048576, maxOutputTokens: 65536 },
          "claude-sonnet-4-6": { displayName: "Claude Sonnet 4.6 (Thinking)", supportsThinking: true, maxTokens: 250000, maxOutputTokens: 64000 },
        },
      }),
    );

    const models = await fetchAvailableModels("test-token", { fetchImpl: fetchMock });

    expect(models.map((m) => m.id).sort()).toEqual(["claude-sonnet-4-6", "gemini-3.6-flash-low"]);
    expect(models.find((m) => m.id === "claude-sonnet-4-6")?.maxTokens).toBe(250000);
  });

  it("uses the map key over the obfuscated entry.model placeholder", async () => {
    const fetchMock = vi.fn<FetchMock>(async () =>
      okResponse({
        models: {
          "gemini-3.6-flash-low": { displayName: "Gemini 3.6 Flash (Low)", model: "MODEL_PLACEHOLDER_M16", maxTokens: 1048576 },
          "claude-sonnet-4-6": { displayName: "Claude Sonnet 4.6 (Thinking)", model: "MODEL_PLACEHOLDER_M35", maxTokens: 250000 },
        },
      }),
    );

    const models = await fetchAvailableModels("test-token", { fetchImpl: fetchMock });

    expect(models.map((m) => m.id).sort()).toEqual(["claude-sonnet-4-6", "gemini-3.6-flash-low"]);
    expect(models.every((m) => !m.id.startsWith("MODEL_PLACEHOLDER"))).toBe(true);
  });

  it("skips internal placeholder and alias models", async () => {
    const fetchMock = vi.fn<FetchMock>(async () =>
      okResponse({
        models: {
          "chat_23310": { maxTokens: 32768 },
          "tab_flash_lite_preview": { maxTokens: 16384 },
          "gemini-2.5-flash": { displayName: "Gemini 3.1 Flash Lite" },
          "gemini-pro-agent": { displayName: "Gemini 3.1 Pro (High)" },
          "gemini-3-flash-agent": { displayName: "Gemini 3 Flash Agent" },
          "gemini-3.6-flash-low": { displayName: "Gemini 3.6 Flash (Low)" },
        },
      }),
    );

    const models = await fetchAvailableModels("test-token", { fetchImpl: fetchMock });

    expect(models.map((m) => m.id)).toEqual(["gemini-3.6-flash-low"]);
  });

  it("throws a clear error when the endpoint fails", async () => {
    const fetchMock = vi.fn(async () => new Response("denied", { status: 403 }));
    await expect(fetchAvailableModels("tok", { fetchImpl: fetchMock })).rejects.toThrow(
      "Failed to fetch Antigravity models (403)",
    );
  });
});

describe("mergeDynamicModels", () => {
  it("adds new antigravity-* models, overrides limits, keeps CLI and legacy defs untouched", () => {
    const merged = mergeDynamicModels(
      [
        { id: "gemini-3.6-flash", displayName: "Gemini 3.6 Flash", supportsThinking: true, maxTokens: 2000000, maxOutputTokens: 128000 },
        { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", supportsThinking: true },
        { id: "brand-new-model", displayName: "Brand New Model" },
      ],
      OPENCODE_MODEL_DEFINITIONS,
    );

    // API-provided limits override static definition
    expect(merged["antigravity-gemini-3.6-flash"]?.limit).toEqual({ context: 2000000, output: 128000 });
    // Existing antigravity model keeps its curated name and variants
    expect(merged["antigravity-claude-sonnet-4-6"]?.name).toBe("Claude Sonnet 4.6 (Antigravity)");
    expect(merged["antigravity-claude-sonnet-4-6"]?.variants).toBeUndefined();
    // Brand new model gets default limits and NO variants (unknown family)
    expect(merged["antigravity-brand-new-model"]?.name).toBe("Brand New Model");
    expect(merged["antigravity-brand-new-model"]?.limit).toEqual({ context: 1048576, output: 65536 });
    expect(merged["antigravity-brand-new-model"]?.variants).toBeUndefined();
    // CLI-quota definitions survive
    expect(merged["gemini-2.5-flash"]).toBeDefined();
    expect(merged["gemini-2.5-flash"]?.limit).toEqual(OPENCODE_MODEL_DEFINITIONS["gemini-2.5-flash"]?.limit);
    // Shut-down model is not resurrected
    expect(merged["gemini-3-pro-preview"]).toBeUndefined();
  });

  it("normalizes tiered API ids to family keys and merges extra-low variants", () => {
    const merged = mergeDynamicModels(
      [
        { id: "gemini-3.6-flash-extra-low", displayName: "Gemini 3.6 Flash (Extra Low)" },
        { id: "gemini-3.6-flash-low", displayName: "Gemini 3.6 Flash (Low)" },
        { id: "gemini-3.6-flash-medium", displayName: "Gemini 3.6 Flash (Medium)" },
        { id: "gemini-3.6-flash-high", displayName: "Gemini 3.6 Flash (High)" },
        { id: "gemini-3.1-pro-high", displayName: "Gemini 3.1 Pro (High)" },
        { id: "gpt-oss-120b-medium", displayName: "GPT-OSS 120B (Medium)" },
        { id: "gemini-3.6-flash-preview", displayName: "Gemini 3.6 Flash Preview" },
      ],
      OPENCODE_MODEL_DEFINITIONS,
    );

    const flash = merged["antigravity-gemini-3.6-flash"];
    expect(flash).toBeDefined();
    expect(flash?.variants?.["extra-low"]).toEqual({ thinkingLevel: "minimal" });
    expect(flash?.variants?.["low"]).toEqual({ thinkingLevel: "low" });
    // gpt-oss keeps full name as its own key, no variants inferred
    const gpt = merged["antigravity-gpt-oss-120b-medium"];
    expect(gpt?.name).toBe(OPENCODE_MODEL_DEFINITIONS["antigravity-gpt-oss-120b-medium"]?.name);
    expect(gpt?.variants).toBeUndefined();
    // preview id is a distinct model, not folded into the tiered family
    expect(merged["antigravity-gemini-3.6-flash-preview"]?.name).toBe("Gemini 3.6 Flash Preview");
    // no junk antigravity-gemini-3.6-flash-low key
    expect(merged["antigravity-gemini-3.6-flash-low"]).toBeUndefined();
  });

  it("gives tiered gemini families flash variants with extra-low for new families", () => {
    const merged = mergeDynamicModels(
      [{ id: "gemini-3.5-flash-extra-low", displayName: "Gemini 3.5 Flash (Extra Low)" }],
      OPENCODE_MODEL_DEFINITIONS,
    );
    const flash = merged["antigravity-gemini-3.5-flash"];
    expect(flash?.variants?.["extra-low"]).toEqual({ thinkingLevel: "minimal" });
    expect(flash?.variants?.["low"]).toBeDefined();
  });

  it("adds thinking variants for Claude models reported as thinking-capable", () => {
    const merged = mergeDynamicModels([{ id: "claude-opus-4-7-thinking", displayName: "Claude Opus 4.7", supportsThinking: true }], OPENCODE_MODEL_DEFINITIONS);
    expect(merged["antigravity-claude-opus-4-7-thinking"]?.variants).toEqual({
      low: { thinkingConfig: { thinkingBudget: 8192 } },
      max: { thinkingConfig: { thinkingBudget: 32768 } },
    });
  });
});

describe("refreshModelDefinitionsFromApi", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "antigravity-models-test-"));
  const cachePath = join(tmpDir, "antigravity-models.json");

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    resetDynamicModelState();
  });

  it("fetches, merges, caches and activates dynamic definitions", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ models: [{ id: "gemini-3.6-flash", displayName: "Gemini 3.6 Flash", maxTokens: 1500000, maxOutputTokens: 70000 }] }),
    );

    const result = await refreshModelDefinitionsFromApi("tok", { cachePath, fetchImpl: fetchMock });

    expect(result.updated).toBe(true);
    expect(result.error).toBeUndefined();
    expect(getEffectiveModelDefinitions()["antigravity-gemini-3.6-flash"]?.limit).toEqual({ context: 1500000, output: 70000 });

    const cache = JSON.parse(readFileSync(cachePath, "utf-8"));
    expect(cache.models[0].id).toBe("gemini-3.6-flash");
  });

  it("falls back to cached models when the fetch fails", async () => {
    const fetchMock = vi.fn(async () => new Response("down", { status: 500 }));

    const result = await refreshModelDefinitionsFromApi("tok", { cachePath, fetchImpl: fetchMock });

    expect(result.updated).toBe(false);
    expect(result.error).toContain("Failed to fetch");
    expect(getEffectiveModelDefinitions()["antigravity-gemini-3.6-flash"]?.limit).toEqual({ context: 1500000, output: 70000 });
  });

  it("falls back to static definitions when fetch fails and no cache exists", async () => {
    const emptyCachePath = join(tmpDir, "missing-cache.json");
    const fetchMock = vi.fn(async () => new Response("down", { status: 500 }));

    const result = await refreshModelDefinitionsFromApi("tok", { cachePath: emptyCachePath, fetchImpl: fetchMock });

    expect(result.updated).toBe(false);
    expect(result.error).toContain("Failed to fetch");
    expect(getEffectiveModelDefinitions()).toBe(OPENCODE_MODEL_DEFINITIONS);
  });
});

describe("getEffectiveModelDefinitions", () => {
  it("returns the static definitions by default", () => {
    resetDynamicModelState();
    expect(getEffectiveModelDefinitions()).toBe(OPENCODE_MODEL_DEFINITIONS);
  });
});
