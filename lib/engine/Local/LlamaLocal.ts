// lib/engine/Local/LlamaLocal.ts

import { db } from '@db'
import { Storage } from '@lib/enums/Storage'
// NOTE: If AppDirectory and readableFileSize are truly defined in @lib/utils/File,
// then these imports are correct and should NOT be redefined/exported here unless for re-export.
// However, your provided LlamaLocal.ts defines AppDirectory locally.
// If AppDirectory is also in @lib/utils/File, decide which is the canonical source.
// Assuming for now the AppDirectory below is the one you intend to use and export from LlamaLocal.
import { AppDirectory as FileAppDirectory, readableFileSize } from '@lib/utils/File' // Rename to avoid conflict if AppDirectory is defined locally

import { ContextParams, LlamaContext, initLlama, CompletionParams, CompletionTimings } from 'cui-llama.rn'
import { model_data, ModelDataType } from 'db/schema'
import { eq } from 'drizzle-orm'
import * as FileSystem from 'expo-file-system'
import { getInfoAsync } from 'expo-file-system'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import { checkGGMLDeprecated } from './GGML'
import { KV } from './Model'
import { AppSettings } from '../../constants/GlobalValues'
import { Logger } from '../../state/Logger'
import { mmkv, mmkvStorage } from '../../storage/MMKV'

// IMPORTANT: If AppDirectory is *only* defined here, make sure it's exported.
// If it's also in '@lib/utils/File', you should either import it from there and use that,
// or define it here and explicitly export it, being consistent across your app.
// For the sake of resolving the ModelSettings.tsx errors, I'll assume this local AppDirectory
// definition is the one you want exposed via LlamaModule.
export const AppDirectory = { // EXPORTED
  ModelPath: `${FileSystem.documentDirectory}models/`,
  SessionPath: `${FileSystem.documentDirectory}sessions/`,
  CharacterPath: `${FileSystem.documentDirectory}characters/`,
  Assets: `${FileSystem.documentDirectory}assets/`,
  LoRAPath: `${FileSystem.documentDirectory}loras/`, // Added LoRA path here
}

// Global contexts (these do not need to be exported if only used internally or via specific getter functions)
let embeddingLlamaContext: LlamaContext | null = null
let ragReasoningLlamaContext: LlamaContext | null = null
let mainChatLlamaContext: LlamaContext | null = null

let loadedEmbeddingModel: ModelDataType | null = null
let loadedEmbeddingLoRAPath: string | null = null

let loadedRagReasoningModel: ModelDataType | null = null
let loadedRagReasoningLoRAPath: string | null = null

let loadedMainChatModel: ModelDataType | null = null

const sessionFile = `${AppDirectory.SessionPath}llama-session.bin`

type DefaultContextConfig = Omit<ContextParams, 'model'>

const defaultConfig: DefaultContextConfig = {
  n_ctx: 4096,
  n_threads: 4,
  n_gpu_layers: 0,
  n_batch: 512,
}

// Export LlamaState type if other modules need to reference it directly
export type LlamaState = { // EXPORTED
  currentChatContext: LlamaContext | undefined
  currentChatModel: ModelDataType | undefined
  loadProgress: number
  chatCount: number
  promptCache?: string

  loadedEmbeddingModelInContext: ModelDataType | null
  loadedRagReasoningModelInContext: ModelDataType | null
  loadedEmbeddingLoRAPathInContext: string | null
  loadedRagReasoningLoRAPathInContext: string | null

  setLoadedEmbeddingModelInContext: (model: ModelDataType | null, loraPath?: string | null) => void
  setLoadedRagReasoningModelInContext: (model: ModelDataType | null, loraPath?: string | null) => void

  loadCurrentChatModel: (model: ModelDataType) => Promise<boolean>
  setLoadProgress: (progress: number) => void
  unloadCurrentChatModel: () => Promise<void>
  saveKV: (prompt?: string) => Promise<void>
  loadKV: () => Promise<boolean>
  completion: (
    params: CompletionParams,
    callback: (text: string) => void,
    completed: (text: string, timings: CompletionTimings) => void
  ) => Promise<void>
  stopCompletion: () => Promise<void>
  tokenLength: (text: string) => number
  tokenize: (text: string) => { tokens: number[] } | undefined
}

export const useLlama = create<LlamaState>()((set, get) => ({ // EXPORTED
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
      Logger.info('Main Chat Model Already Loaded!')
      return true
    }

    if (model.model_type !== 'main_chat') {
      Logger.errorToast(
        `Tried to load non-main_chat model as chat model: ${model.name} (${model.model_type})`
      )
      return false
    }

    const { context, model: loadedModel } = await loadModelContext(
      model.id,
      'main_chat',
      get().currentChatContext ?? null,
      get().currentChatModel ?? null,
      false
    )

    if (!context) return false

    set({
      currentChatContext: context,
      currentChatModel: loadedModel!,
      chatCount: 1,
      loadProgress: 100,
    })

    // This import needs to be resolved externally or re-exported from here
    // Assuming useEngineData is from '@state/EngineData'
    // For now, let's assume it's imported correctly in files that use LlamaLocal
    // and that LlamaLocal itself just calls it.
    // If you want LlamaModule.useEngineData, then useEngineData needs to be exported from here.
    // export { useEngineData } from '../../state/EngineData'; // <--- ADD THIS IF YOU WANT TO RE-EXPORT
    // Also, if EngineDataProps is used here, ensure it's imported or defined.

    // This line uses useEngineData, which is *not* exported from LlamaLocal.ts currently.
    // If ModelSettings.tsx accesses it as LlamaModule.useEngineData, it needs to be exported.
    // For now, I'm assuming useEngineData is imported *directly* into ModelSettings.tsx
    // as per the previous solution. If not, this needs re-export from LlamaLocal.
    useEngineData.getState().setLastModelLoaded(loadedModel!)
    KV.useKVState.getState().setKvCacheLoaded(false)

    return true
  },

  setLoadProgress(progress) {
    set({ loadProgress: progress })
  },

  async unloadCurrentChatModel() {
    await get().currentChatContext?.release()
    set({
      currentChatContext: undefined,
      currentChatModel: undefined,
      loadProgress: 0,
      chatCount: 0,
    })
    
    if (mainChatLlamaContext === get().currentChatContext) {
      mainChatLlamaContext = null
      loadedMainChatModel = null
    }
  },

  async completion(params, callback = () => {}, completed = () => {}) {
    const llamaContext = get().currentChatContext
    if (!llamaContext) {
      Logger.errorToast('No Main Chat Model Loaded')
      return
    }
    return llamaContext
      .completion(params, (data: any) => callback(data.token))
      .then(async ({ text, timings }) => {
        completed(text, timings)
        Logger.info(
          `\n---- Start Chat ${get().chatCount} ----\n${textTimings(timings)}\n---- End Chat ${get().chatCount} ----\n`
        )
        set({ chatCount: get().chatCount + 1 })
        if (mmkv.getBoolean(AppSettings.SaveLocalKV)) {
          await get().saveKV(params.prompt)
        }
      })
  },

  async stopCompletion() {
    await get().currentChatContext?.stopCompletion()
  },

  async saveKV(prompt?) {
    const llamaContext = get().currentChatContext
    if (!llamaContext) {
      Logger.errorToast('No Main Chat Model Loaded')
      return
    }

    if (prompt) {
      const tokens = get().tokenize(prompt)?.tokens
      KV.useKVState.getState().setKvCacheTokens(tokens ?? [])
    }

    if (!(await getInfoAsync(sessionFile)).exists) {
      await FileSystem.writeAsStringAsync(sessionFile, '', { encoding: 'base64' })
    }

    const now = performance.now()
    const data = await llamaContext.saveSession(sessionFile.replace('file://', ''))
    Logger.info(
      data === -1
        ? 'Failed to save KV cache'
        : `Saved KV in ${Math.floor(performance.now() - now)}ms with ${data} tokens`
    )
    Logger.info(`Current KV Size is: ${readableFileSize(await KV.getKVSize())}`)
  },

  async loadKV() {
    const llamaContext = get().currentChatContext
    if (!llamaContext) {
      Logger.errorToast('No Main Chat Model Loaded')
      return false
    }

    const data = await getInfoAsync(sessionFile)
    if (!data.exists) {
      Logger.warn('No KV Cache found')
      return false
    }

    try {
      await llamaContext.loadSession(sessionFile.replace('file://', ''))
      Logger.info('Session loaded from KV cache')
      return true
    } catch (e: any) {
      Logger.error(`Could not load session from KV cache: ${e.message}`)
      return false
    }
  },

  tokenLength(text) {
    return get().currentChatContext?.tokenizeSync(text)?.tokens?.length ?? 0
  },

  tokenize(text) {
    return get().currentChatContext?.tokenizeSync(text)
  },
}))

// Export the LlamaContext type itself if it's used directly elsewhere as LlamaModule.LlamaContext
export type { LlamaContext, CompletionTimings }; // EXPORTED

// These need to be exported if other files call them as LlamaModule.getEmbeddingLlamaContext etc.
export async function getEmbeddingLlamaContext(loraPath: string | null = null): Promise<LlamaContext | null> { // EXPORTED
  if (embeddingLlamaContext && loadedEmbeddingLoRAPath === loraPath && loadedEmbeddingModel) {
    Logger.info('Embedding model and LoRA already loaded, returning existing context.')
    return embeddingLlamaContext
  }
  const modelId = useEngineData.getState().embeddingModelId // Assuming this is where embeddingModelId is stored
  if (!modelId) {
    Logger.errorToast('No embedding model selected.')
    return null
  }
  const { context, model } = await loadModelContext(modelId, 'rag_embedding', embeddingLlamaContext, loadedEmbeddingModel, true, loraPath)
  if (context) {
    embeddingLlamaContext = context
    loadedEmbeddingModel = model
    loadedEmbeddingLoRAPath = loraPath
    useLlama.getState().setLoadedEmbeddingModelInContext(model, loraPath)
  }
  return embeddingLlamaContext
}

export async function getRagReasoningLlamaContext(loraPath: string | null = null): Promise<LlamaContext | null> { // EXPORTED
  if (ragReasoningLlamaContext && loadedRagReasoningLoRAPath === loraPath && loadedRagReasoningModel) {
    Logger.info('RAG Reasoning model and LoRA already loaded, returning existing context.')
    return ragReasoningLlamaContext
  }
  const modelId = useEngineData.getState().ragReasoningModelId // Assuming this is where ragReasoningModelId is stored
  if (!modelId) {
    Logger.errorToast('No RAG Reasoning model selected.')
    return null
  }
  const { context, model } = await loadModelContext(modelId, 'rag_reasoning', ragReasoningLlamaContext, loadedRagReasoningModel, false, loraPath)
  if (context) {
    ragReasoningLlamaContext = context
    loadedRagReasoningModel = model
    loadedRagReasoningLoRAPath = loraPath
    useLlama.getState().setLoadedRagReasoningModelInContext(model, loraPath)
  }
  return ragReasoningLlamaContext
}

export async function unloadEmbeddingLlamaContext(): Promise<void> { // EXPORTED
  if (embeddingLlamaContext) {
    await embeddingLlamaContext.release()
    embeddingLlamaContext = null
    loadedEmbeddingModel = null
    loadedEmbeddingLoRAPath = null
    useLlama.getState().setLoadedEmbeddingModelInContext(null, null)
    Logger.info('Embedding Llama context unloaded.')
  }
}

export async function unloadRagReasoningLlamaContext(): Promise<void> { // EXPORTED
  if (ragReasoningLlamaContext) {
    await ragReasoningLlamaContext.release()
    ragReasoningLlamaContext = null
    loadedRagReasoningModel = null
    loadedRagReasoningLoRAPath = null
    useLlama.getState().setLoadedRagReasoningModelInContext(null, null)
    Logger.info('RAG Reasoning Llama context unloaded.')
  }
}

// Assuming useEngineData comes from here:
import { useEngineData } from '../../state/EngineData'; // Assuming this path, adjust if needed
export { useEngineData }; // Re-export useEngineData if other files want to access it via LlamaModule.

async function loadModelContext(
  modelId: number,
  expectedType: ModelDataType['model_type'],
  currentContext: LlamaContext | null,
  loadedModel: ModelDataType | null,
  isEmbeddingModel = false,
  loraPath: string | null = null
): Promise<{ context: LlamaContext | null; model: ModelDataType | null }> {
  // ... (rest of loadModelContext function, no changes needed)
  const config = useEngineData.getState().config // This uses useEngineData internally
  // ...
  const llamaContext = await initLlama(params).catch((error: any) => { // Type 'error' as any
    Logger.errorToast(`Could Not Load ${expectedType} Model: ${error.message}`)
    return null
  })
  // ...
}

function textTimings(timings: CompletionTimings): string {
  // ... (no changes needed)
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
  )
}
