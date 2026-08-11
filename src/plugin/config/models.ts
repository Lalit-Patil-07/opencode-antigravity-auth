import type { ProviderModel } from "../types";

export type ModelThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface ModelThinkingConfig {
  thinkingBudget: number;
}

export interface ModelVariant {
  thinkingLevel?: ModelThinkingLevel;
  thinkingConfig?: ModelThinkingConfig;
}

export interface ModelLimit {
  context: number;
  output: number;
}

export type ModelModality = "text" | "image" | "pdf";

export interface ModelModalities {
  input: ModelModality[];
  output: ModelModality[];
}

export interface OpencodeModelDefinition extends ProviderModel {
  name: string;
  limit: ModelLimit;
  modalities: ModelModalities;
  variants?: Record<string, ModelVariant>;
}

export type OpencodeModelDefinitions = Record<string, OpencodeModelDefinition>;

const DEFAULT_MODALITIES: ModelModalities = {
  input: ["text", "image", "pdf"],
  output: ["text"],
};

const GEMINI_3_PRO_VARIANTS = {
  low: { thinkingLevel: "low" },
  high: { thinkingLevel: "high" },
} as const;

const GEMINI_3_FLASH_GA_VARIANTS = {
  low: { thinkingLevel: "low" },
  medium: { thinkingLevel: "medium" },
  high: { thinkingLevel: "high" },
} as const;

const GEMINI_3_FLASH_LEGACY_VARIANTS = {
  minimal: { thinkingLevel: "minimal" },
  low: { thinkingLevel: "low" },
  medium: { thinkingLevel: "medium" },
  high: { thinkingLevel: "high" },
} as const;

const CLAUDE_THINKING_VARIANTS = {
  low: { thinkingConfig: { thinkingBudget: 8192 } },
  max: { thinkingConfig: { thinkingBudget: 32768 } },
} as const;

export const OPENCODE_MODEL_DEFINITIONS: OpencodeModelDefinitions = {
  // ==========================================================================
  // Antigravity quota (default routing)
  // ==========================================================================

  "antigravity-gemini-3-pro": {
    name: "Gemini 3 Pro (Antigravity, legacy)",
    limit: { context: 1048576, output: 65535 },
    modalities: DEFAULT_MODALITIES,
    variants: GEMINI_3_PRO_VARIANTS,
  },
  "antigravity-gemini-3.1-pro": {
    name: "Gemini 3.1 Pro (Antigravity)",
    limit: { context: 1048576, output: 65535 },
    modalities: DEFAULT_MODALITIES,
    variants: GEMINI_3_PRO_VARIANTS,
  },
  "antigravity-gemini-3-flash": {
    name: "Gemini 3 Flash (Antigravity, legacy)",
    limit: { context: 1048576, output: 65536 },
    modalities: DEFAULT_MODALITIES,
    variants: GEMINI_3_FLASH_LEGACY_VARIANTS,
  },
  "antigravity-gemini-3.5-flash": {
    name: "Gemini 3.5 Flash (Antigravity)",
    limit: { context: 1048576, output: 65536 },
    modalities: DEFAULT_MODALITIES,
    variants: GEMINI_3_FLASH_GA_VARIANTS,
  },
  "antigravity-gemini-3.6-flash": {
    name: "Gemini 3.6 Flash (Antigravity)",
    limit: { context: 1048576, output: 65536 },
    modalities: DEFAULT_MODALITIES,
    variants: GEMINI_3_FLASH_GA_VARIANTS,
  },
  "antigravity-claude-sonnet-4-6": {
    name: "Claude Sonnet 4.6 (Antigravity)",
    limit: { context: 200000, output: 64000 },
    modalities: DEFAULT_MODALITIES,
  },
  "antigravity-claude-sonnet-4-6-thinking": {
    name: "Claude Sonnet 4.6 Thinking (Antigravity)",
    limit: { context: 200000, output: 64000 },
    modalities: DEFAULT_MODALITIES,
    variants: CLAUDE_THINKING_VARIANTS,
  },
  "antigravity-claude-opus-4-6-thinking": {
    name: "Claude Opus 4.6 Thinking (Antigravity)",
    limit: { context: 200000, output: 64000 },
    modalities: DEFAULT_MODALITIES,
    variants: CLAUDE_THINKING_VARIANTS,
  },
  "antigravity-gpt-oss-120b-medium": {
    name: "GPT-OSS 120B Medium (Antigravity)",
    limit: { context: 131072, output: 16384 },
    modalities: DEFAULT_MODALITIES,
  },
  "antigravity-gemini-3.1-flash-image": {
    name: "Gemini 3.1 Flash Image (Antigravity)",
    limit: { context: 131072, output: 32768 },
    modalities: DEFAULT_MODALITIES,
  },

  // ==========================================================================
  // Gemini CLI quota (used when cli_first is true or as fallback)
  // ==========================================================================

  "gemini-2.5-flash": {
    name: "Gemini 2.5 Flash (Gemini CLI)",
    limit: { context: 1048576, output: 65536 },
    modalities: DEFAULT_MODALITIES,
  },
  "gemini-2.5-pro": {
    name: "Gemini 2.5 Pro (Gemini CLI)",
    limit: { context: 1048576, output: 65536 },
    modalities: DEFAULT_MODALITIES,
  },
  "gemini-3-flash-preview": {
    name: "Gemini 3 Flash Preview (Gemini CLI)",
    limit: { context: 1048576, output: 65536 },
    modalities: DEFAULT_MODALITIES,
  },
  "gemini-3.1-pro-preview": {
    name: "Gemini 3.1 Pro Preview (Gemini CLI)",
    limit: { context: 1048576, output: 65535 },
    modalities: DEFAULT_MODALITIES,
  },
  "gemini-3.1-pro-preview-customtools": {
    name: "Gemini 3.1 Pro Preview Custom Tools (Gemini CLI)",
    limit: { context: 1048576, output: 65535 },
    modalities: DEFAULT_MODALITIES,
  },
  "gemini-3.5-flash": {
    name: "Gemini 3.5 Flash (Gemini CLI)",
    limit: { context: 1048576, output: 65536 },
    modalities: DEFAULT_MODALITIES,
  },
  "gemini-3.6-flash": {
    name: "Gemini 3.6 Flash (Gemini CLI)",
    limit: { context: 1048576, output: 65536 },
    modalities: DEFAULT_MODALITIES,
  },
};
