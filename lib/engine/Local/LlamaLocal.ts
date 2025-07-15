// lib/engine/Local/LlamaLocal.ts

import { db } from '@db'
import { Storage } from '@lib/enums/Storage'
import { AppDirectory, readableFileSize } from '@lib/utils/File'
import { ContextParams, LlamaContext, initLlama, CompletionParams } from 'cui-llama.rn'
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

// Global LlamaContext and loaded model tracking
let embeddingLlamaContext: LlamaContext | null = null
let ragReasoningLlamaContext: LlamaContext | null = null
let mainChatLlamaContext: LlamaContext | null = null

let loadedEmbeddingModel: ModelDataType | null = null
let loadedEmbeddingLoRAPath: string | null = null

let loadedRagReasoningModel: ModelDataType | null = null
let loadedRagReasoningLoRAPath: string | null = null

let loadedMainChatModel: ModelDataType | null = null

const sessionFile = `${AppDirectory.SessionPath}llama-session.bin`

const defaultConfig: ContextParams = {
    context_length: 4096,
    threads: 4,
    gpu_layers: 0,
    batch: 512,
}

// Removed: MMKV keys for persistent LoRA URIs - Zustand's partialize handles this now.
// const SELECTED_EMBEDDING_LORA_URI_KEY = 'selectedEmbeddingLoRAUri';
// const SELECTED_REASONING_LORA_URI_KEY = 'selectedReasoningLoRAUri';

export type EngineDataProps = {
    config: ContextParams
    lastModel?: ModelDataType
    embeddingModelId?: number | null
    ragReasoningModelId?: number | null

    selectedEmbeddingLoRAUri: string | null
    selectedReasoningLoRAUri: string | null

    setConfiguration: (config: ContextParams) => void
    setLastModelLoaded: (model: ModelDataType) => void
    setEmbeddingModelId: (id: number | null) => void
    setRagReasoningModelId: (id: number | null) => void

    setSelectedEmbeddingLoRAUri: (uri: string | null) => void
    setSelectedReasoningLoRAUri: (uri: string | null) => void
}

export const useEngineData = create<EngineDataProps>()(
    persist(
        (set) => ({
            config: defaultConfig,
            lastModel: undefined,
            embeddingModelId: null,
            ragReasoningModelId: null,
            selectedEmbeddingLoRAUri: null,
            selectedReasoningLoRAUri: null,

            setConfiguration: (config) => set(() => ({ config })),
            setLastModelLoaded: (model) => set(() => ({ lastModel: model })),
            setEmbeddingModelId: (id) => set(() => ({ embeddingModelId: id })),
            setRagReasoningModelId: (id) => set(() => ({ ragReasoningModelId: id })),

            // Removed mmkv.set calls - Zustand's persist middleware handles this automatically
            setSelectedEmbeddingLoRAUri: (uri) => {
                set({ selectedEmbeddingLoRAUri: uri })
            },
            setSelectedReasoningLoRAUri: (uri) => {
                set({ selectedReasoningLoRAUri: uri })
            },
        }),
        {
            name: Storage.EngineData,
            partialize: (state) => ({
                config: state.config,
                lastModel: state.lastModel,
                embeddingModelId: state.embeddingModelId,
                ragReasoningModelId: state.ragReasoningModelId,
                // These are included here, so Zustand's persist middleware will save/load them
                selectedEmbeddingLoRAUri: state.selectedEmbeddingLoRAUri,
                selectedReasoningLoRAUri: state.selectedReasoningLoRAUri,
            }),
            storage: createJSONStorage(() => mmkvStorage),
            version: 3, // Increment version as persistence logic for LoRA URIs has changed again
            // Removed onRehydrateStorage for LoRA URIs - partialize and createJSONStorage handle it now.
            // The previous onRehydrateStorage manually loaded from MMKV. Now, Zustand handles it.
        }
    )
)

async function loadModelContext(
    modelId: number,
    expectedType: ModelDataType['model_type'],
    currentContext: LlamaContext | null,
    loadedModel: ModelDataType | null,
    isEmbeddingModel = false,
    loraPath: string | null = null
): Promise<{ context: LlamaContext | null; model: ModelDataType | null }> {
    const config = useEngineData.getState().config

    if (loadedModel?.id === modelId && currentContext) {
        Logger.info(`Model of type '${expectedType}' (ID: ${modelId}) already loaded.`)
        return { context: currentContext, model: loadedModel }
    }

    const model = await db.query.model_data.findFirst({ where: eq(model_data.id, modelId) })

    if (!model) {
        Logger.errorToast(`Model with ID ${modelId} not found in database.`)
        return { context: null, model: null }
    }

    if (model.model_type !== expectedType) {
        Logger.errorToast(
            `Model ID ${modelId} is type '${model.model_type}', expected '${expectedType}'.`
        )
        return { context: null, model: null }
    }

    if (checkGGMLDeprecated(parseInt(model.quantization))) {
        Logger.errorToast('Quantization No Longer Supported!')
        return { context: null, model: null }
    }

    if (!(await getInfoAsync(model.file_path)).exists) {
        Logger.errorToast(`Model file not found for ${model.name} at ${model.file_path}!`)
        return { context: null, model: null }
    }

    if (currentContext) {
        await currentContext
            .release()
            .catch((e) =>
                Logger.warn(`Failed to release old context for ${expectedType}: ${e.message}`)
            )
    }

    const params: ContextParams = {
        model: model.file_path,
        n_ctx: config.context_length,
        n_threads: config.threads,
        n_batch: config.batch,
        embedding: isEmbeddingModel,
        lora: loraPath ?? undefined,
        use_mlock: true,
        n_gpu_layers: 99,
        ctx_shift: false,
    }

    Logger.info(
        `\n------ MODEL LOAD (${expectedType}) -----\nModel Name: ${model.name}\nParameters:\nContext Length: ${params.n_ctx}\nThreads: ${params.n_threads}\nBatch Size: ${params.n_batch}\nEmbedding Mode: ${isEmbeddingModel}\nLoRA: ${loraPath || 'None'}`
    )

    const llamaContext = await initLlama(params).catch((error) => {
        Logger.errorToast(`Could Not Load ${expectedType} Model: ${error.message}`)
        return null
    })

    if (!llamaContext) return { context: null, model: null }

    Logger.info(`${expectedType} model '${model.name}' loaded successfully.`)
    return { context: llamaContext, model }
}

export async function getEmbeddingLlamaContext(
    loraPath: string | null = null
): Promise<LlamaContext | null> {
    const embeddingModelId = useEngineData.getState().embeddingModelId
    if (!embeddingModelId) {
        Logger.warn('No RAG Embedding Model selected in settings.')
        return null
    }
    if (
        !embeddingLlamaContext ??
        loadedEmbeddingModel?.id !== embeddingModelId ??
        loadedEmbeddingLoRAPath !== loraPath
    ) {
        Logger.info(`Loading RAG Embedding Model (ID: ${embeddingModelId})...`)
        const { context, model } = await loadModelContext(
            embeddingModelId,
            'rag_embedding',
            embeddingLlamaContext,
            loadedEmbeddingModel,
            true,
            loraPath
        )
        embeddingLlamaContext = context
        loadedEmbeddingModel = model
        loadedEmbeddingLoRAPath = loraPath
        useEngineData.getState().setSelectedEmbeddingLoRAUri(loraPath) // Update Zustand state on successful load
    }
    return embeddingLlamaContext
}

export async function getRagReasoningLlamaContext(
    loraPath: string | null = null
): Promise<LlamaContext | null> {
    const ragReasoningModelId = useEngineData.getState().ragReasoningModelId
    if (!ragReasoningModelId) {
        Logger.warn('No RAG Reasoning Model selected in settings.')
        return null
    }
    if (
        !ragReasoningLlamaContext ??
        loadedRagReasoningModel?.id !== ragReasoningModelId ??
        loadedRagReasoningLoRAPath !== loraPath
    ) {
        Logger.info(`Loading RAG Reasoning Model (ID: ${ragReasoningModelId})...`)
        const { context, model } = await loadModelContext(
            ragReasoningModelId,
            'rag_reasoning',
            ragReasoningLlamaContext,
            loadedRagReasoningModel,
            false,
            loraPath
        )
        ragReasoningLlamaContext = context
        loadedRagReasoningModel = model
        loadedRagReasoningLoRAPath = loraPath
        useEngineData.getState().setSelectedReasoningLoRAUri(loraPath) // Update Zustand state on successful load
    }
    return ragReasoningLlamaContext
}

export async function getMainChatLlamaContext(): Promise<LlamaContext | null> {
    const lastModel = useEngineData.getState().lastModel
    if (!lastModel?.id) {
        Logger.warn('No Main Chat Model selected in settings.')
        return null
    }

    if (lastModel.model_type !== 'main_chat') {
        Logger.warn(
            `Last selected model (ID: ${lastModel.id}, Name: ${lastModel.name}) is not a 'main_chat' type.`
        )
        return null
    }

    if (!mainChatLlamaContext ?? loadedMainChatModel?.id !== lastModel.id) {
        Logger.info(`Loading Main Chat Model (ID: ${lastModel.id})...`)
        const { context, model } = await loadModelContext(
            lastModel.id,
            'main_chat',
            mainChatLlamaContext,
            loadedMainChatModel,
            false
        )
        mainChatLlamaContext = context
        loadedMainChatModel = model
    }
    return mainChatLlamaContext
}

export async function unloadEmbeddingLlamaContext() {
    if (embeddingLlamaContext) {
        await embeddingLlamaContext.release()
        embeddingLlamaContext = null
        loadedEmbeddingModel = null
        loadedEmbeddingLoRAPath = null
        useEngineData.getState().setEmbeddingModelId(null) // Clear base model ID
        useEngineData.getState().setSelectedEmbeddingLoRAUri(null) // Clear LoRA URI
        Logger.info('Embedding Llama context unloaded.')
    }
}

export async function unloadRagReasoningLlamaContext() {
    if (ragReasoningLlamaContext) {
        await ragReasoningLlamaContext.release()
        ragReasoningLlamaContext = null
        loadedRagReasoningModel = null
        loadedRagReasoningLoRAPath = null
        useEngineData.getState().setRagReasoningModelId(null) // Clear base model ID
        useEngineData.getState().setSelectedReasoningLoRAUri(null) // Clear LoRA URI
        Logger.info('RAG Reasoning Llama context unloaded.')
    }
}

export async function unloadMainChatLlamaContext() {
    if (mainChatLlamaContext) {
        await mainChatLlamaContext.release()
        mainChatLlamaContext = null
        loadedMainChatModel = null
        useEngineData.getState().setLastModelLoaded(undefined) // Clear last loaded main chat model
        Logger.info('Main Chat Llama context unloaded.')
    }
}

// Main chat UI Zustand store and helpers omitted for brevity; implement as needed.

// Main chat UI Zustand store

export type CompletionTimings = {
    predicted_per_token_ms: number
    predicted_per_second: number | null
    predicted_ms: number
    predicted_n: number

    prompt_per_token_ms: number
    prompt_per_second: number | null
    prompt_ms: number
    prompt_n: number
}

export type CompletionOutput = {
    text: string
    timings: CompletionTimings
}

// lib/engine/Local/LlamaLocal.ts (excerpt of LlamaState and loadCurrentChatModel)

export type LlamaState = {
    currentChatContext: LlamaContext | undefined
    currentChatModel: ModelDataType | undefined
    loadProgress: number
    chatCount: number
    promptCache?: string
    loadCurrentChatModel: (model: ModelDataType) => Promise<boolean> // Changed return type to Promise<boolean>
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

    loadCurrentChatModel: async (model: ModelDataType): Promise<boolean> => {
        // Explicitly define return type
        if (get().currentChatModel?.id === model.id && get().currentChatContext) {
            Logger.info('Main Chat Model Already Loaded!')
            return true // Indicate success if already loaded
        }

        if (model.model_type !== 'main_chat') {
            Logger.errorToast(
                `Attempted to load non-main_chat model as current chat model: ${model.name} (${model.model_type})`
            )
            return false // Indicate failure
        }

        // Set modelLoading true (if you have this state in LlamaLocal or pass it via context/Zustand)
        // For now, ModelManager handles this, but if LlamaLocal should also manage a "loading" state
        // for the main chat model internally, you'd add it here.
        // Llama.useLlama.setState({ isModelLoading: true }); // Example

        const { context, model: loadedModel } = await loadModelContext(
            model.id,
            'main_chat',
            get().currentChatContext ?? null,
            get().currentChatModel ?? null,
            false
        )

        if (!context) {
            // Llama.useLlama.setState({ isModelLoading: false }); // Example
            return false // Indicate failure if context not obtained
        }

        set({
            currentChatContext: context,
            currentChatModel: loadedModel!,
            chatCount: 1,
            loadProgress: 100, // Assuming 100% on successful load
        })

        useEngineData.getState().setLastModelLoaded(loadedModel!)
        KV.useKVState.getState().setKvCacheLoaded(false)
        // Llama.useLlama.setState({ isModelLoading: false }); // Example
        return true // Indicate success
    },

    setLoadProgress: (progress: number) => {
        set((state) => ({ ...state, loadProgress: progress }))
    },

    unloadCurrentChatModel: async () => {
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

    completion: async (params, callback = () => {}, completed = () => {}) => {
        const llamaContext = get().currentChatContext
        if (!llamaContext) {
            Logger.errorToast('No Main Chat Model Loaded')
            return
        }

        return llamaContext
            .completion(params, (data: any) => {
                callback(data.token)
            })
            .then(async ({ text, timings }: CompletionOutput) => {
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

    stopCompletion: async () => {
        await get().currentChatContext?.stopCompletion()
    },

    saveKV: async (prompt) => {
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

    loadKV: async () => {
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
            Logger.error(`Session could not load from KV cache: ${e.message}`)
            return false
        }
    },

    tokenLength: (text: string) => {
        return get().currentChatContext?.tokenizeSync(text)?.tokens?.length ?? 0
    },

    tokenize: (text: string) => {
        return get().currentChatContext?.tokenizeSync(text)
    },
}))

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

// lib/engine/Local/LlamaLocal.ts

// (All your existing code here ...)

// Add this at the very end of the file:

// Export a Llama namespace wrapping the useLlama Zustand hook
export namespace Llama {
  export const useLlama = useLlama;
}
