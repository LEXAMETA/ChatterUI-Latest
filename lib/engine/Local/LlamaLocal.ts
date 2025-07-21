// lib/engine/Local/LlamaLocal.ts

import { db } from '@db'
import { Storage } from '@lib/enums/Storage'
import { AppDirectory as FileAppDirectory, readableFileSize } from '@lib/utils/File'

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

import { useEngineData } from '../../state/EngineData'
import { fetchModelById, validateLoRAFile, createLlamaContext, LoadContextOptions } from '../utils/ModelContextUtils'
import { reportModelError } from '../utils/LoggerUtils'

export const AppDirectory = {
  ModelPath: `${FileSystem.documentDirectory}models/`,
  SessionPath: `${FileSystem.documentDirectory}sessions/`,
  CharacterPath: `${FileSystem.documentDirectory}characters/`,
  Assets: `${FileSystem.documentDirectory}assets/`,
  LoRAPath: `${FileSystem.documentDirectory}loras/`,
}

const defaultConfig: Partial<ContextParams> = {
  n_ctx: 4096,
  n_threads: 4,
  n_gpu_layers: 0,
  n_batch: 512,
}

let embeddingLlamaContext: LlamaContext | null = null
let ragReasoningLlamaContext: LlamaContext | null = null
let mainChatLlamaContext: LlamaContext | null = null

let loadedEmbeddingModel: ModelDataType | null = null
let loadedEmbeddingLoRAPath: string | null = null

let loadedRagReasoningModel: ModelDataType | null = null
let loadedRagReasoningLoRAPath: string | null = null

let loadedMainChatModel: ModelDataType | null = null

const sessionFile = `${AppDirectory.SessionPath}llama-session.bin`

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
  )
}

export type LlamaState = {
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
      Logger.info('Main Chat Model Already Loaded!')
      return true
    }

    if (model.model_type !== 'main_chat') {
      reportModelError('Main Chat Model', `Tried to load non-main_chat model as chat model: ${model.name} (${model.model_type})`)
      return false
    }

    const config = useEngineData.getState().config

    const options: LoadContextOptions = {
      modelId: model.id,
      expectedType: 'main_chat',
      currentContext: get().currentChatContext ?? null,
      loadedModel: get().currentChatModel ?? null,
      loraPath: null,
      config: {
        model: model.file_path,
        ...defaultConfig,
        ...config,
      },
    }

    const context = await getLlamaContextForPurpose(options)

    if (!context) return false

    set({
      currentChatContext: context,
      currentChatModel: model,
      chatCount: 1,
      loadProgress: 100,
    })

    useEngineData.getState().setLastModelLoaded(model)
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
      reportModelError('Main Chat Completion', 'No Main Chat Model Loaded')
      return
    }
    return llamaContext
      .completion(params, (data: { token: string }) => callback(data.token))
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
      reportModelError('KV Cache Save', 'No Main Chat Model Loaded')
      return
    }

    if (prompt) {
      const tokens = get().tokenize(prompt)?.tokens ?? []
      KV.useKVState.getState().setKvCacheTokens(tokens)
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
      reportModelError('KV Cache Load', 'No Main Chat Model Loaded')
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
      reportModelError('KV Cache Load', `Could not load session from KV cache: ${e.message}`)
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

export type { LlamaContext, CompletionTimings }

async function getLlamaContextForPurpose(
  options: LoadContextOptions
): Promise<LlamaContext | null> {
  const { modelId, expectedType, currentContext, loadedModel, isEmbeddingModel, loraPath, config } = options

  const dbModel = await fetchModelById(modelId)
  if (!dbModel) {
    reportModelError(expectedType, `Model with ID ${modelId} not found in database.`)
    return null
  }

  if (dbModel.model_type !== expectedType) {
    reportModelError(
      expectedType,
      `Model "${dbModel.name}" has incorrect type: ${dbModel.model_type}. Expected: ${expectedType}.`
    )
    return null
  }

  const needsReload =
    !currentContext ||
    loadedModel?.id !== dbModel.id ||
    loraPath !== (isEmbeddingModel ? loadedEmbeddingLoRAPath : loadedRagReasoningLoRAPath)

  if (!needsReload) {
    Logger.info(`${expectedType} Model already loaded correctly.`)
    return currentContext
  }

  if (currentContext) {
    await currentContext.release()
  }

  let params: ContextParams = {
    model: dbModel.file_path,
    ...defaultConfig,
    ...config,
  } as ContextParams

  if (loraPath && (await validateLoRAFile(loraPath))) {
    params.lora_path = loraPath
  }

  return await createLlamaContext(params)
}

