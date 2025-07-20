// lib/engine/Local/LlamaLocal.ts

import { db } from '@db'; // Still needed for some direct DB interaction, e.g. migrations
import { Storage } from '@lib/enums/Storage';
import { AppDirectory as FileAppDirectory, readableFileSize } from '@lib/utils/File';

import { ContextParams, LlamaContext, initLlama, CompletionParams, CompletionTimings } from 'cui-llama.rn';
import { model_data, ModelDataType } from 'db/schema';
import { eq } from 'drizzle-orm';
import * as FileSystem from 'expo-file-system';
import { getInfoAsync } from 'expo-file-system';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { checkGGMLDeprecated } from './GGML'; // Still needed here for context outside ModelContextUtils direct use
import { KV } from './Model';
import { AppSettings } from '../../constants/GlobalValues';
import { Logger } from '../../state/Logger';
import { mmkv, mmkvStorage } from '../../storage/MMKV';

// === NEW IMPORTS FROM UTILITY MODULES ===
import { useEngineData } from '../../state/EngineData';
import { fetchModelById, validateLoRAFile, createLlamaContext, LoadContextOptions } from '../utils/ModelContextUtils';
import { useCurrentEngineConfig } from '../hooks/useCurrentEngineConfig';
import { reportModelError } from '../utils/LoggerUtils';
// =======================================

export const AppDirectory = {
  ModelPath: `${FileSystem.documentDirectory}models/`,
  SessionPath: `${FileSystem.documentDirectory}sessions/`,
  CharacterPath: `${FileSystem.documentDirectory}characters/`,
  Assets: `${FileSystem.documentDirectory}assets/`,
  LoRAPath: `${FileSystem.documentDirectory}loras/`,
}

// Keep these global references to manage contexts across the app lifecycle
let embeddingLlamaContext: LlamaContext | null = null;
let ragReasoningLlamaContext: LlamaContext | null = null;
let mainChatLlamaContext: LlamaContext | null = null;

let loadedEmbeddingModel: ModelDataType | null = null;
let loadedEmbeddingLoRAPath: string | null = null;

let loadedRagReasoningModel: ModelDataType | null = null;
let loadedRagReasoningLoRAPath: string | null = null;

let loadedMainChatModel: ModelDataType | null = null;

const sessionFile = `${AppDirectory.SessionPath}llama-session.bin`;

type DefaultContextConfig = Omit<ContextParams, 'model'>;

const defaultConfig: DefaultContextConfig = {
  n_ctx: 4096,
  n_threads: 4,
  n_gpu_layers: 0,
  n_batch: 512,
};

export type LlamaState = {
  currentChatContext: LlamaContext | undefined;
  currentChatModel: ModelDataType | undefined;
  loadProgress: number;
  chatCount: number;
  promptCache?: string;

  loadedEmbeddingModelInContext: ModelDataType | null;
  loadedRagReasoningModelInContext: ModelDataType | null;
  loadedEmbeddingLoRAPathInContext: string | null;
  loadedRagReasoningLoRAPathInContext: string | null;

  setLoadedEmbeddingModelInContext: (model: ModelDataType | null, loraPath?: string | null) => void;
  setLoadedRagReasoningModelInContext: (model: ModelDataType | null, loraPath?: string | null) => void;

  loadCurrentChatModel: (model: ModelDataType) => Promise<boolean>;
  setLoadProgress: (progress: number) => void;
  unloadCurrentChatModel: () => Promise<void>;
  saveKV: (prompt?: string) => Promise<void>;
  loadKV: () => Promise<boolean>;
  completion: (
    params: CompletionParams,
    callback: (text: string) => void,
    completed: (text: string, timings: CompletionTimings) => void
  ) => Promise<void>;
  stopCompletion: () => Promise<void>;
  tokenLength: (text: string) => number;
  tokenize: (text: string) => { tokens: number[] } | undefined;
}

export const useLlama = create<LlamaState>()((set, get) => ({
  currentChatContext: undefined,
  currentChatModel: undefined,
  loadProgress: 0,
  chatCount: 0,

  loadedEmbeddingModelInContext: null,
  loadedRagReasoningModelInContext: null,
  loadedEmbeddingLoRAPathInContext: null,
  loadedRagReasoningLoRAPathInContext: null,

  setLoadedEmbeddingModelInContext: (model, loraPath = null) =>
    set({ loadedEmbeddingModelInContext: model, loadedEmbeddingLoRAPathInContext: loraPath }),

  setLoadedRagReasoningModelInContext: (model, loraPath = null) =>
    set({ loadedRagReasoningModelInContext: model, loadedRagReasoningLoRAPathInContext: loraPath }),

  async loadCurrentChatModel(model) {
    if (get().currentChatModel?.id === model.id && get().currentChatContext) {
      Logger.info('Main Chat Model Already Loaded!');
      return true;
    }

    if (model.model_type !== 'main_chat') {
      reportModelError('Main Chat Model', `Tried to load non-main_chat model as chat model: ${model.name} (${model.model_type})`);
      return false;
    }

    // Get config from EngineData
    const config = useEngineData.getState().config; // Or use useCurrentEngineConfig() if this were a React component context

    const options: LoadContextOptions = {
      modelId: model.id,
      expectedType: 'main_chat',
      currentContext: get().currentChatContext ?? null,
      loadedModel: get().currentChatModel ?? null,
      loraPath: null, // Main chat model typically doesn't use LoRA this way, but included for consistency
      config: { // Combine defaultConfig with current engine config, ensure model path is set
        ...defaultConfig,
        ...config,
        model: model.file_path, // Explicitly set model path here
      }
    };

    const context = await getLlamaContextForPurpose(options);

    if (!context) return false;

    set({
      currentChatContext: context,
      currentChatModel: model, // Use the passed model, not `loadedModel` from context utils
      chatCount: 1,
      loadProgress: 100,
    });

    useEngineData.getState().setLastModelLoaded(model);
    KV.useKVState.getState().setKvCacheLoaded(false);

    return true;
  },

  setLoadProgress(progress) {
    set({ loadProgress: progress });
  },

  async unloadCurrentChatModel() {
    await get().currentChatContext?.release();
    set({
      currentChatContext: undefined,
      currentChatModel: undefined,
      loadProgress: 0,
      chatCount: 0,
    });

    if (mainChatLlamaContext === get().currentChatContext) {
      mainChatLlamaContext = null;
      loadedMainChatModel = null;
    }
  },

  async completion(params, callback = () => {}, completed = () => {}) {
    const llamaContext = get().currentChatContext;
    if (!llamaContext) {
      reportModelError('Main Chat Completion', 'No Main Chat Model Loaded');
      return;
    }
    return llamaContext
      .completion(params, (data: any) => callback(data.token))
      .then(async ({ text, timings }: { text: string; timings: CompletionTimings }) => {
        completed(text, timings);
        Logger.info(
          `\n---- Start Chat ${get().chatCount} ----\n${textTimings(timings)}\n---- End Chat ${get().chatCount} ----\n`
        );
        set({ chatCount: get().chatCount + 1 });
        if (mmkv.getBoolean(AppSettings.SaveLocalKV)) {
          await get().saveKV(params.prompt);
        }
      });
  },

  async stopCompletion() {
    await get().currentChatContext?.stopCompletion();
  },

  async saveKV(prompt?) {
    const llamaContext = get().currentChatContext;
    if (!llamaContext) {
      reportModelError('KV Cache Save', 'No Main Chat Model Loaded');
      return;
    }

    if (prompt) {
      const tokens = get().tokenize(prompt)?.tokens;
      KV.useKVState.getState().setKvCacheTokens(tokens ?? []);
    }

    if (!(await getInfoAsync(sessionFile)).exists) {
      await FileSystem.writeAsStringAsync(sessionFile, '', { encoding: 'base64' });
    }

    const now = performance.now();
    const data = await llamaContext.saveSession(sessionFile.replace('file://', ''));
    Logger.info(
      data === -1
        ? 'Failed to save KV cache'
        : `Saved KV in ${Math.floor(performance.now() - now)}ms with ${data} tokens`
    );
    Logger.info(`Current KV Size is: ${readableFileSize(await KV.getKVSize())}`);
  },

  async loadKV() {
    const llamaContext = get().currentChatContext;
    if (!llamaContext) {
      reportModelError('KV Cache Load', 'No Main Chat Model Loaded');
      return false;
    }

    const data = await getInfoAsync(sessionFile);
    if (!data.exists) {
      Logger.warn('No KV Cache found');
      return false;
    }

    try {
      await llamaContext.loadSession(sessionFile.replace('file://', ''));
      Logger.info('Session loaded from KV cache');
      return true;
    } catch (e: any) {
      reportModelError('KV Cache Load', `Could not load session from KV cache: ${e.message}`);
      return false;
    }
  },

  tokenLength(text) {
    return get().currentChatContext?.tokenizeSync(text)?.tokens?.length ?? 0;
  },

  tokenize(text) {
    return get().currentChatContext?.tokenizeSync(text);
  },
}));

export type { LlamaContext, CompletionTimings };

// Centralized model loading logic
// This function will be the single entry point for loading any Llama context.
async function getLlamaContextForPurpose(
  options: LoadContextOptions
): Promise<LlamaContext | null> {
  const { modelId, expectedType, currentContext, loadedModel, isEmbeddingModel, loraPath, config } = options;

  const dbModel = await fetchModelById(modelId);
  if (!dbModel) {
    reportModelError(expectedType, `Model with ID ${modelId} not found in database.`);
    return null;
  }

  if (dbModel.model_type !== expectedType) {
    reportModelError(expectedType, `Model "${dbModel.name}" has incorrect type: ${dbModel.model_type}. Expected: ${expectedType}.`);
    return null;
  }

  // Determine if a reload is necessary
  const needsReload =
    !currentContext ||
    loadedModel?.id !== dbModel.id ||
    loraPath !== (isEmbeddingModel ? loadedEmbeddingLoRAPath : loadedRagReasoningLoRAPath);

  if (!needsReload) {
    Logger.info(`${expectedType} Model already loaded with correct LoRA. Returning existing context.`);
    return currentContext;
  }

  if (currentContext) {
    Logger.info(`Releasing old ${expectedType} context.`);
    await currentContext.release();
  }

  let params: ContextParams = {
    model: dbModel.file_path, // The model file path is crucial
    ...defaultConfig, // Start with default config
    ...config, // Override with specific config from EngineData
  };

  if (loraPath && (await validateLoRAFile(loraPath))) {
    params.lora_path = loraPath;
  }

  Logger.info(`Attempting to initialize ${expectedType} Llama context for model: ${dbModel.name}`);
  return await createLlamaContext(params);
}


export async function getEmbeddingLlamaContext(loraPath: string | null = null): Promise<LlamaContext | null> {
  const modelId = useEngineData.getState().embeddingModelId;
  if (!modelId) {
    reportModelError('Embedding Model', 'No embedding model selected.');
    return null;
  }

  const config = useEngineData.getState().config; // Get current engine config

  const options: LoadContextOptions = {
    modelId: modelId,
    expectedType: 'rag_embedding',
    currentContext: embeddingLlamaContext,
    loadedModel: loadedEmbeddingModel,
    isEmbeddingModel: true,
    loraPath: loraPath,
    config: config,
  };

  const context = await getLlamaContextForPurpose(options);
  if (context) {
    embeddingLlamaContext = context;
    loadedEmbeddingModel = options.loadedModel ?? (await fetchModelById(modelId)); // Re-fetch or use if available
    loadedEmbeddingLoRAPath = loraPath;
    useLlama.getState().setLoadedEmbeddingModelInContext(loadedEmbeddingModel, loraPath);
  }
  return embeddingLlamaContext;
}

export async function getRagReasoningLlamaContext(loraPath: string | null = null): Promise<LlamaContext | null> {
  const modelId = useEngineData.getState().ragReasoningModelId;
  if (!modelId) {
    reportModelError('RAG Reasoning Model', 'No RAG Reasoning model selected.');
    return null;
  }

  const config = useEngineData.getState().config; // Get current engine config

  const options: LoadContextOptions = {
    modelId: modelId,
    expectedType: 'rag_reasoning',
    currentContext: ragReasoningLlamaContext,
    loadedModel: loadedRagReasoningModel,
    isEmbeddingModel: false,
    loraPath: loraPath,
    config: config,
  };

  const context = await getLlamaContextForPurpose(options);
  if (context) {
    ragReasoningLlamaContext = context;
    loadedRagReasoningModel = options.loadedModel ?? (await fetchModelById(modelId)); // Re-fetch or use if available
    loadedRagReasoningLoRAPath = loraPath;
    useLlama.getState().setLoadedRagReasoningModelInContext(loadedRagReasoningModel, loraPath);
  }
  return ragReasoningLlamaContext;
}

export async function unloadEmbeddingLlamaContext(): Promise<void> {
  if (embeddingLlamaContext) {
    await embeddingLlamaContext.release();
    embeddingLlamaContext = null;
    loadedEmbeddingModel = null;
    loadedEmbeddingLoRAPath = null;
    useLlama.getState().setLoadedEmbeddingModelInContext(null, null);
    Logger.info('Embedding Llama context unloaded.');
  }
}

export async function unloadRagReasoningLlamaContext(): Promise<void> {
  if (ragReasoningLlamaContext) {
    await ragReasoningLlamaContext.release();
    ragReasoningLlamaContext = null;
    loadedRagReasoningModel = null;
    loadedRagReasoningLoRAPath = null;
    useLlama.getState().setLoadedRagReasoningModelInContext(null, null);
    Logger.info('RAG Reasoning Llama context unloaded.');
  }
}

// Helper function (no changes needed)
function textTimings(timings: CompletionTimings): string {
  return (
    `\n[Prompt Timings]` +
    (timings.prompt_n > 0
      ? `\nPrompt Per Token: ${timings.prompt_per_token_ms} ms/token` +
        `\nPrompt Per Second: ${timings.prompt_per_second?.toFixed(2) ?? 0} tokens/s` +
        `\nPrompt Time: ${(timings.prompt_ms / 1000).toFixed(2)}s` +
        `\nPrompt Tokens: ${timings.prompt_n} tokens`
      : '\nNo Tokens Processed') +
    `\n\n[Predicted Timings]` +
    (timings.predicted_n > 0
      ? `\nPredicted Per Token: ${timings.predicted_per_token_ms} ms/token` +
        `\nPredicted Per Second: ${timings.predicted_per_second?.toFixed(2) ?? 0} tokens/s` +
        `\nPrediction Time: ${(timings.predicted_ms / 1000).toFixed(2)}s` +
        `\nPredicted Tokens: ${timings.predicted_n} tokens\n`
      : '\nNo Tokens Generated')
  );
}
