// lib/engine/Local/LlamaLocal.ts

import { db } from '@db'
import { Storage } from '@lib/enums/Storage'
import { AppDirectory as FileAppDirectory, readableFileSize } from '@lib/utils/File'
import { ContextParams, LlamaContext, initLlama, CompletionParams } from 'cui-llama.rn'
import { model_data, ModelDataType, CompletionTimings } from 'db/schema'
import { eq } from 'drizzle-orm'
import * as FileSystem from 'expo-file-system'
import { getInfoAsync } from 'expo-file-system'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import { checkGGMLDeprecated } from './GGML'
import { KV } from './Model'
import { AppSettings } from '../../constants/GlobalValues'
import { useEngineData } from '../../state/EngineData'
import { Logger } from '../../state/Logger'
import { mmkv, mmkvStorage } from '../../storage/MMKV'
import { reportModelError } from '../utils/LoggerUtils'
import {
    fetchModelById,
    validateLoRAFile,
    createLlamaContext,
    LoadContextOptions,
} from '../utils/ModelContextUtils'

// Import CompletionTimings from db/schema, assuming it's correctly defined there

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

// Extend ContextParams to include lora_path if it's supported by the native library
interface ExtendedContextParams extends ContextParams {
    lora_path?: string // Add lora_path here
}

// These are now internal to the module, managed by the functions
let embeddingLlamaContextInstance: LlamaContext | null = null
let ragReasoningLlamaContextInstance: LlamaContext | null = null
let mainChatLlamaContext: LlamaContext | null = null // Kept for main chat context management

// Removed these as their state will be managed by useLlama Zustand store
// let loadedEmbeddingModel: ModelDataType | null = null
// let loadedEmbeddingLoRAPath: string | null = null
// let loadedRagReasoningModel: ModelDataType | null = null
// let loadedRagReasoningLoRAPath: string | null = null
// let loadedMainChatModel: ModelDataType | null = null // This is also handled by useLlama state

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

// --- ZUSTAND STORE DEFINITION (moved up for clarity and use in functions) ---

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

    // Adjusted setters to reflect LoRA path
    setLoadedEmbeddingModelInContext: (
        model: ModelDataType | null,
        loraPath?: string | null
    ) => void
    setLoadedRagReasoningModelInContext: (
        model: ModelDataType | null,
        loraPath?: string | null
    ) => void

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

    setLoadedEmbeddingModelInContext: (model, loraPath = null) => {
        set({ loadedEmbeddingModelInContext: model, loadedEmbeddingLoRAPathInContext: loraPath })
        if (model === null) {
            embeddingLlamaContextInstance = null
        }
    },

    setLoadedRagReasoningModelInContext: (model, loraPath = null) => {
        set({
            loadedRagReasoningModelInContext: model,
            loadedRagReasoningLoRAPathInContext: loraPath,
        })
        if (model === null) {
            ragReasoningLlamaContextInstance = null
        }
    },

    async loadCurrentChatModel(model) {
        if (get().currentChatModel?.id === model.id && get().currentChatContext) {
            Logger.info('Main Chat Model Already Loaded!')
            return true
        }

        if (model.model_type !== 'main_chat') {
            reportModelError(
                'Main Chat Model',
                `Tried to load non-main_chat model as chat model: ${model.name} (${model.model_type})`
            )
            return false
        }

        const config = useEngineData.getState().config

        if (mainChatLlamaContext) {
            await mainChatLlamaContext.release()
            mainChatLlamaContext = null
        }

        const options: LoadContextOptions = {
            modelId: model.id,
            expectedType: 'main_chat',
            currentContext: null,
            loadedModel: null,
            loraPath: null,
            config: {
                model: model.file_path,
                ...defaultConfig,
                ...config,
            },
        }

        const context = await getLlamaContextForPurpose(options)

        if (!context) {
            set({ loadProgress: 0 })
            return false
        }

        mainChatLlamaContext = context
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
        if (mainChatLlamaContext) {
            await mainChatLlamaContext.release()
            mainChatLlamaContext = null
        }
        set({
            currentChatContext: undefined,
            currentChatModel: undefined,
            loadProgress: 0,
            chatCount: 0,
        })
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

// --- New/Modified get and unload functions for Embedding and RAG Reasoning ---

export async function getEmbeddingLlamaContext(
    loraPath: string | null = null
): Promise<LlamaContext | null> {
    const engineDataState = useEngineData.getState()
    const embeddingModelId = engineDataState.embeddingModelId

    if (!embeddingModelId) {
        Logger.warn(
            'No embedding model ID configured in EngineData. Cannot load embedding context.'
        )
        return null
    }

    const model = await fetchModelById(embeddingModelId)
    if (!model) {
        reportModelError(
            'Embedding Model',
            `Configured embedding model with ID ${embeddingModelId} not found.`
        )
        return null
    }

    const llamaState = useLlama.getState()
    const currentLoadedModel = llamaState.loadedEmbeddingModelInContext
    const currentLoadedLoRAPath = llamaState.loadedEmbeddingLoRAPathInContext

    if (
        embeddingLlamaContextInstance &&
        currentLoadedModel?.id === model.id &&
        currentLoadedLoRAPath === loraPath
    ) {
        Logger.info('Embedding Llama Context already loaded matching criteria.')
        return embeddingLlamaContextInstance
    }

    if (embeddingLlamaContextInstance) {
        await embeddingLlamaContextInstance.release()
        embeddingLlamaContextInstance = null
        llamaState.setLoadedEmbeddingModelInContext(null)
    }

    const config: ExtendedContextParams = {
        model: model.file_path,
        ...defaultConfig,
        embedding: true,
    }

    if (loraPath && (await validateLoRAFile(loraPath))) {
        config.lora_path = loraPath
    }

    const newContext = await createLlamaContext(config)

    if (newContext) {
        embeddingLlamaContextInstance = newContext
        llamaState.setLoadedEmbeddingModelInContext(model, loraPath)
        Logger.info(
            `Loaded Embedding Model: ${model.name}${loraPath ? ` with LoRA: ${loraPath.split('/').pop()}` : ''}`
        )
    } else {
        reportModelError(
            'Embedding Model',
            `Failed to create Llama Context for embedding model: ${model.name}`
        )
    }

    return newContext
}

export async function getRagReasoningLlamaContext(
    loraPath: string | null = null
): Promise<LlamaContext | null> {
    const engineDataState = useEngineData.getState()
    const ragModelId = engineDataState.ragReasoningModelId

    if (!ragModelId) {
        Logger.warn(
            'No RAG reasoning model ID configured in EngineData. Cannot load RAG reasoning context.'
        )
        return null
    }

    const model = await fetchModelById(ragModelId)
    if (!model) {
        reportModelError(
            'RAG Reasoning Model',
            `Configured RAG reasoning model with ID ${ragModelId} not found.`
        )
        return null
    }

    const llamaState = useLlama.getState()
    const currentLoadedModel = llamaState.loadedRagReasoningModelInContext
    const currentLoadedLoRAPath = llamaState.loadedRagReasoningLoRAPathInContext

    if (
        ragReasoningLlamaContextInstance &&
        currentLoadedModel?.id === model.id &&
        currentLoadedLoRAPath === loraPath
    ) {
        Logger.info('RAG Reasoning Llama Context already loaded matching criteria.')
        return ragReasoningLlamaContextInstance
    }

    if (ragReasoningLlamaContextInstance) {
        await ragReasoningLlamaContextInstance.release()
        ragReasoningLlamaContextInstance = null
        llamaState.setLoadedRagReasoningModelInContext(null)
    }

    const config: ExtendedContextParams = {
        model: model.file_path,
        ...defaultConfig,
    }

    if (loraPath && (await validateLoRAFile(loraPath))) {
        config.lora_path = loraPath
    }

    const newContext = await createLlamaContext(config)

    if (newContext) {
        ragReasoningLlamaContextInstance = newContext
        llamaState.setLoadedRagReasoningModelInContext(model, loraPath)
        Logger.info(
            `Loaded RAG Reasoning Model: ${model.name}${loraPath ? ` with LoRA: ${loraPath.split('/').pop()}` : ''}`
        )
    } else {
        reportModelError(
            'RAG Reasoning Model',
            `Failed to create Llama Context for RAG reasoning model: ${model.name}`
        )
    }

    return newContext
}

// --- NEW UNLOAD FUNCTIONS ---
export async function unloadEmbeddingLlamaContext(): Promise<void> {
    if (embeddingLlamaContextInstance) {
        try {
            await embeddingLlamaContextInstance.release()
            Logger.info('Embedding Llama context released.')
        } catch (e: any) {
            Logger.error(`Error releasing embedding context: ${e.message}`)
        } finally {
            embeddingLlamaContextInstance = null
            useLlama.getState().setLoadedEmbeddingModelInContext(null)
        }
    } else {
        Logger.info('No embedding Llama context to unload.')
    }
}

export async function unloadRagReasoningLlamaContext(): Promise<void> {
    if (ragReasoningLlamaContextInstance) {
        try {
            await ragReasoningLlamaContextInstance.release()
            Logger.info('RAG Reasoning Llama context released.')
        } catch (e: any) {
            Logger.error(`Error releasing RAG reasoning context: ${e.message}`)
        } finally {
            ragReasoningLlamaContextInstance = null
            useLlama.getState().setLoadedRagReasoningModelInContext(null)
        }
    } else {
        Logger.info('No RAG Reasoning Llama context to unload.')
    }
}

// Make sure CompletionTimings is exported if other files need to import it from here.
export type { LlamaContext }

// This function is still needed for main chat context loading, but now it uses
// the module-level mainChatLlamaContext and useLlama state.
export async function getLlamaContextForPurpose(
    options: LoadContextOptions
): Promise<LlamaContext | null> {
    const { modelId, expectedType, currentContext, loadedModel, loraPath, config } = options

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
        (expectedType === 'rag_embedding' &&
            loraPath !== useLlama.getState().loadedEmbeddingLoRAPathInContext) ||
        (expectedType === 'rag_reasoning' &&
            loraPath !== useLlama.getState().loadedRagReasoningLoRAPathInContext) ||
        (expectedType === 'main_chat' &&
            (loadedModel?.id !== dbModel.id || currentContext !== mainChatLlamaContext))

    if (!needsReload) {
        Logger.info(`${expectedType} Model already loaded correctly.`)
        return currentContext
    }

    if (currentContext) {
        await currentContext.release()
    }

    const params: ExtendedContextParams = {
        model: dbModel.file_path,
        ...defaultConfig,
        ...config,
        embedding: expectedType === 'rag_embedding',
    } as ExtendedContextParams

    if (loraPath && (await validateLoRAFile(loraPath))) {
        params.lora_path = loraPath
    }

    const newContext = await createLlamaContext(params)

    if (newContext) {
        if (expectedType === 'rag_embedding') {
            embeddingLlamaContextInstance = newContext
            useLlama.getState().setLoadedEmbeddingModelInContext(dbModel, loraPath)
        } else if (expectedType === 'rag_reasoning') {
            ragReasoningLlamaContextInstance = newContext
            useLlama.getState().setLoadedRagReasoningModelInContext(dbModel, loraPath)
        }
    }

    return newContext
}
