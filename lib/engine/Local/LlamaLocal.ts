import { Storage } from '@lib/enums/Storage'
import { AppDirectory, readableFileSize } from '@lib/utils/File'
import { CompletionParams, ContextParams, initLlama, LlamaContext } from 'cui-llama.rn'
import { model_data, ModelDataType } from 'db/schema' // Ensure ModelDataType is imported
import { getInfoAsync, writeAsStringAsync } from 'expo-file-system'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { db } from '@db'; // Import your db instance
import { eq } from 'drizzle-orm'; // Import eq for queries

import { checkGGMLDeprecated } from './GGML'
import { KV } from './Model' // KV namespace is here
import { AppSettings } from '../../constants/GlobalValues'
import { Logger } from '../../state/Logger'
import { mmkv, mmkvStorage } from '../../storage/MMKV'

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

// Redefine LlamaState to hold multiple contexts, if still needed for global chat management
export type LlamaState = {
    // We'll keep a 'current' context for the main chat UI interaction
    currentChatContext: LlamaContext | undefined
    currentChatModel: undefined | ModelDataType
    loadProgress: number
    chatCount: number
    promptCache?: string
    // The `load` function will be adjusted to load the current chat model.
    // RAG models will be loaded via dedicated getters.
    loadCurrentChatModel: (model: ModelDataType) => Promise<void>
    setLoadProgress: (progress: number) => void
    unloadCurrentChatModel: () => Promise<void>
    saveKV: (prompt: string | undefined) => Promise<void>
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

export type LlamaConfig = {
    context_length: number
    threads: number
    gpu_layers: number
    batch: number
}

export type EngineDataProps = {
    config: LlamaConfig
    lastModel?: ModelDataType // This can still track the last main chat model
    embeddingModelId?: number | null; // Store ID of selected embedding model
    ragReasoningModelId?: number | null; // Store ID of selected RAG reasoning model
    setConfiguration: (config: LlamaConfig) => void
    setLastModelLoaded: (model: ModelDataType) => void
    setEmbeddingModelId: (id: number | null) => void; // Setter for embedding model ID
    setRagReasoningModelId: (id: number | null) => void; // Setter for RAG reasoning model ID
}

const sessionFile = `${AppDirectory.SessionPath}llama-session.bin`

const defaultConfig = {
    context_length: 4096,
    threads: 4,
    gpu_layers: 0,
    batch: 512,
}

// --- Global LlamaContext instances and their associated data ---
// These will store the *actual* loaded LlamaContext objects
let embeddingLlamaContext: LlamaContext | null = null;
let ragReasoningLlamaContext: LlamaContext | null = null;
let mainChatLlamaContext: LlamaContext | null = null;

// Track the models associated with each context to prevent unnecessary re-initialization
let loadedEmbeddingModel: ModelDataType | null = null;
let loadedRagReasoningModel: ModelDataType | null = null;
let loadedMainChatModel: ModelDataType | null = null;

export namespace Llama {
    export const useEngineData = create<EngineDataProps>()(
        persist(
            (set) => ({
                config: defaultConfig,
                lastModel: undefined,
                embeddingModelId: null, // Initialize new state
                ragReasoningModelId: null, // Initialize new state
                setConfiguration: (config: LlamaConfig) => {
                    set((state) => ({ ...state, config: config }))
                },
                setLastModelLoaded: (model: ModelDataType) => {
                    set((state) => ({ ...state, lastModel: model }))
                },
                setEmbeddingModelId: (id: number | null) => {
                    set((state) => ({ ...state, embeddingModelId: id }));
                },
                setRagReasoningModelId: (id: number | null) => {
                    set((state) => ({ ...state, ragReasoningModelId: id }));
                },
            }),
            {
                name: Storage.EngineData,
                partialize: (state) => ({
                    config: state.config,
                    lastModel: state.lastModel,
                    embeddingModelId: state.embeddingModelId, // Persist new state
                    ragReasoningModelId: state.ragReasoningModelId, // Persist new state
                }),
                storage: createJSONStorage(() => mmkvStorage),
                version: 1,
            }
        )
    )

    // Helper function to load a model by its ID and type
    const loadModelContext = async (
        modelId: number,
        expectedType: ModelDataType['model_type'],
        currentContext: LlamaContext | null,
        loadedModel: ModelDataType | null,
        isEmbeddingModel: boolean = false // New parameter for embedding context
    ): Promise<{ context: LlamaContext | null, model: ModelDataType | null }> => {
        const config = useEngineData.getState().config;

        if (loadedModel?.id === modelId && currentContext) {
            Logger.info(`Model of type '${expectedType}' (ID: ${modelId}) already loaded.`);
            return { context: currentContext, model: loadedModel };
        }

        const model = await db.query.model_data.findFirst({ where: eq(model_data.id, modelId) });

        if (!model) {
            Logger.errorToast(`Model with ID ${modelId} not found in database.`);
            return { context: null, model: null };
        }

        if (model.model_type !== expectedType) {
            Logger.errorToast(`Model ID ${modelId} is type '${model.model_type}', expected '${expectedType}'.`);
            return { context: null, model: null };
        }

        if (checkGGMLDeprecated(parseInt(model.quantization))) {
            Logger.errorToast('Quantization No Longer Supported!');
            return { context: null, model: null };
        }

        if (!(await getInfoAsync(model.file_path)).exists) {
            Logger.errorToast(`Model file not found for ${model.name} at ${model.file_path}!`);
            return { context: null, model: null };
        }

        // Release existing context if a different model needs to be loaded in this slot
        if (currentContext) {
            await currentContext.release().catch(e => Logger.warn(`Failed to release old context for ${expectedType}: ${e.message}`));
        }

        const params: ContextParams = {
            model: model.file_path,
            n_ctx: config.context_length,
            n_threads: config.threads,
            n_batch: config.batch,
            embedding: isEmbeddingModel, // Set embedding flag for embedding models
        };

        Logger.info(
            `\n------ MODEL LOAD (${expectedType})-----\n Model Name: ${model.name}\nStarting with parameters: \nContext Length: ${params.n_ctx}\nThreads: ${params.n_threads}\nBatch Size: ${params.n_batch}\nEmbedding Mode: ${isEmbeddingModel}`
        );

        const llamaContext = await initLlama(params).catch((error) => { // Removed progressCallback from initLlama as it's not relevant for RAG loading in background
            Logger.errorToast(`Could Not Load ${expectedType} Model: ${error.message} `);
            return null;
        });

        if (!llamaContext) return { context: null, model: null };

        Logger.info(`${expectedType} model '${model.name}' loaded successfully.`);
        return { context: llamaContext, model: model };
    };

    // --- Public Getter Functions for LlamaContexts ---

    export const getEmbeddingLlamaContext = async (): Promise<LlamaContext | null> => {
        const embeddingModelId = useEngineData.getState().embeddingModelId;
        if (!embeddingModelId) {
            Logger.warn("No RAG Embedding Model selected in settings.");
            return null;
        }
        if (!embeddingLlamaContext || loadedEmbeddingModel?.id !== embeddingModelId) {
            Logger.info(`Loading RAG Embedding Model (ID: ${embeddingModelId})...`);
            const { context, model } = await loadModelContext(embeddingModelId, 'rag_embedding', embeddingLlamaContext, loadedEmbeddingModel, true);
            embeddingLlamaContext = context;
            loadedEmbeddingModel = model;
        }
        return embeddingLlamaContext;
    };

    export const getRagReasoningLlamaContext = async (): Promise<LlamaContext | null> => {
        const ragReasoningModelId = useEngineData.getState().ragReasoningModelId;
        if (!ragReasoningModelId) {
            Logger.warn("No RAG Reasoning Model selected in settings.");
            return null;
        }
        if (!ragReasoningLlamaContext || loadedRagReasoningModel?.id !== ragReasoningModelId) {
            Logger.info(`Loading RAG Reasoning Model (ID: ${ragReasoningModelId})...`);
            const { context, model } = await loadModelContext(ragReasoningModelId, 'rag_reasoning', ragReasoningLlamaContext, loadedRagReasoningModel);
            ragReasoningLlamaContext = context;
            loadedRagReasoningModel = model;
        }
        return ragReasoningLlamaContext;
    };

    export const getMainChatLlamaContext = async (): Promise<LlamaContext | null> => {
        const lastModel = useEngineData.getState().lastModel;
        if (!lastModel || !lastModel.id) {
            Logger.warn("No Main Chat Model selected in settings.");
            return null;
        }
        // Ensure it's explicitly a 'main_chat' type, though lastModel should generally be.
        if (lastModel.model_type !== 'main_chat') {
             Logger.warn(`Last selected model (ID: ${lastModel.id}, Name: ${lastModel.name}) is not a 'main_chat' type.`);
             return null;
        }

        if (!mainChatLlamaContext || loadedMainChatModel?.id !== lastModel.id) {
            Logger.info(`Loading Main Chat Model (ID: ${lastModel.id})...`);
            // Pass false for isEmbeddingModel as it's a main chat model
            const { context, model } = await loadModelContext(lastModel.id, 'main_chat', mainChatLlamaContext, loadedMainChatModel, false);
            mainChatLlamaContext = context;
            loadedMainChatModel = model;
        }
        return mainChatLlamaContext;
    };

    // --- LlamaState (for the main chat UI, adapted) ---
    export const useLlama = create<LlamaState>()((set, get) => ({
        currentChatContext: undefined,
        loadProgress: 0,
        chatCount: 0,
        currentChatModel: undefined,
        promptCache: undefined,

        // Renamed and adapted to load the 'current' main chat model
        loadCurrentChatModel: async (model: ModelDataType) => {
            const config = useEngineData.getState().config;

            if (get()?.currentChatModel?.id === model.id && get().currentChatContext) {
                Logger.info('Main Chat Model Already Loaded!');
                return;
            }

            if (model.model_type !== 'main_chat') {
                 Logger.errorToast(`Attempted to load non-main_chat model as current chat model: ${model.name} (${model.model_type})`);
                 return;
            }

            // Utilize the centralized loading logic
            const { context, model: loadedModel } = await loadModelContext(model.id, 'main_chat', get().currentChatContext, get().currentChatModel, false);

            if (!context) return;

            set((state) => ({
                ...state,
                currentChatContext: context,
                currentChatModel: loadedModel!, // Assert as non-null if context is not null
                chatCount: 1,
                loadProgress: 100, // Assuming loadModelContext handles progress internally or we set it to 100 on success
            }));

            // updated EngineData for the last loaded main chat model
            useEngineData.getState().setLastModelLoaded(loadedModel!);
            KV.useKVState.getState().setKvCacheLoaded(false);
        },

        setLoadProgress: (progress: number) => {
            set((state) => ({ ...state, loadProgress: progress }));
        },

        // Unload specifically the current chat model
        unloadCurrentChatModel: async () => {
            await get().currentChatContext?.release();
            set((state) => ({
                ...state,
                currentChatContext: undefined,
                currentChatModel: undefined,
                loadProgress: 0,
                chatCount: 0,
            }));
            // Also nullify the global mainChatLlamaContext if this was the same instance
            if (mainChatLlamaContext === get().currentChatContext) {
                mainChatLlamaContext = null;
                loadedMainChatModel = null;
            }
        },

        completion: async (
            params: CompletionParams,
            callback = (text: string) => {},
            completed = (text: string, timings: CompletionTimings) => {} // Corrected type here
        ) => {
            const llamaContext = get().currentChatContext; // Use currentChatContext
            if (llamaContext === undefined) {
                Logger.errorToast('No Main Chat Model Loaded');
                return;
            }

            return llamaContext
                .completion(params, (data: any) => {
                    callback(data.token);
                })
                .then(async ({ text, timings }: CompletionOutput) => {
                    completed(text, timings);
                    Logger.info(
                        `\n---- Start Chat ${get().chatCount} ----\n${textTimings(timings)}\n---- End Chat ${get().chatCount} ----\n`
                    );
                    set((state) => ({ ...state, chatCount: get().chatCount + 1 }));
                    if (mmkv.getBoolean(AppSettings.SaveLocalKV)) {
                        await get().saveKV(params.prompt);
                    }
                });
        },
        stopCompletion: async () => {
            await get().currentChatContext?.stopCompletion(); // Use currentChatContext
        },
        saveKV: async (prompt: string | undefined) => {
            const llamaContext = get().currentChatContext; // Use currentChatContext
            if (!llamaContext) {
                Logger.errorToast('No Main Chat Model Loaded');
                return;
            }

            if (prompt) {
                const tokens = get().tokenize(prompt)?.tokens;
                KV.useKVState.getState().setKvCacheTokens(tokens ?? []);
            }

            if (!(await getInfoAsync(sessionFile)).exists) {
                await writeAsStringAsync(sessionFile, '', { encoding: 'base64' });
            }

            const now = performance.now();
            // Pass the model ID to saveSession, or infer from currentChatModel
            const data = await llamaContext.saveSession(sessionFile.replace('file://', ''));
            Logger.info(
                data === -1
                    ? 'Failed to save KV cache'
                    : `Saved KV in ${Math.floor(performance.now() - now)}ms with ${data} tokens`
            );
            Logger.info(`Current KV Size is: ${readableFileSize(await KV.getKVSize())}`);
        },
        loadKV: async () => {
            let result = false;
            const llamaContext = get().currentChatContext; // Use currentChatContext
            if (!llamaContext) {
                Logger.errorToast('No Main Chat Model Loaded');
                return false;
            }
            const data = await getInfoAsync(sessionFile);
            if (!data.exists) {
                Logger.warn('No KV Cache found');
                return false;
            }
            await llamaContext
                .loadSession(sessionFile.replace('file://', ''))
                .then(() => {
                    Logger.info('Session loaded from KV cache');
                    result = true;
                })
                .catch((e) => {
                    Logger.error(`Session could not load from KV cache: ${e.message}`); // Log error message
                });
            return result;
        },
        tokenLength: (text: string) => {
            return get().currentChatContext?.tokenizeSync(text)?.tokens?.length ?? 0; // Use currentChatContext
        },
        tokenize: (text: string) => {
            return get().currentChatContext?.tokenizeSync(text); // Use currentChatContext
        },
    }));

    const textTimings = (timings: CompletionTimings) => {
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
    };

    // Presets and Downloaders (kept as is)
}




    // Presets

    // Downloaders - Old Placeholder
    /*
    export const downloadModel = async (
        url: string,
        callback?: () => void,
        cancel?: (cancel: () => void) => void
    ) => {
        // check if this model already exists
        const result = await fetch(url, { method: 'HEAD' })
        const contentDisposition = result.headers.get('Content-Disposition')
        let filename = undefined
        if (contentDisposition && contentDisposition.includes('filename=')) {
            filename = contentDisposition.split('filename=')[1].split(';')[0].replace(/['"]/g, '')
        }
        if (!filename) {
            Logger.log('Invalid URL', true)
            return
        }
        const fileInfo = await getInfoAsync(`${AppDirectory.ModelPath}${filename}`)
        if (fileInfo.exists) {
            Logger.log('Model already exists!', true)
            // return
        }
        let current = 0
        const downloadTask = createDownloadResumable(
            url,
            `${cacheDirectory}${filename}`,
            {},
            (progress) => {
                const percentage = progress.totalBytesWritten / progress.totalBytesExpectedToWrite
                if (percentage <= current) return
                current = percentage
            }
        )
        await downloadTask
            .downloadAsync()
            .then(async (result) => {
                if (!result?.uri) {
                    Logger.log('Download failed')
                    return
                }
                await moveAsync({
                    from: result.uri,
                    to: `${AppDirectory.ModelPath}${filename}`,
                }).then(() => {
                    Logger.log(`${filename} downloaded sucessfully!`)
                })
            })
            .catch((err) => Logger.log(`Failed to download: ${err}`))
    }*/
}
