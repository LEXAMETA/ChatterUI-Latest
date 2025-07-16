// lib/state/EngineData.ts

import { create } from 'zustand';
import { ModelDataType } from 'db/schema'; // Correct import path for ModelDataType

/**
 * Defines the state structure for general engine-related data,
 * such as the last loaded model, embedding models, RAG models, and configuration.
 */
export type EngineDataState = {
    lastModelLoaded: ModelDataType | null;
    embeddingModelId: number | null;
    ragReasoningModelId: number | null;
    // Assuming 'config' is an object that holds various settings.
    // You might want to define a more specific type for 'config' later.
    config: {
        // Example properties, adjust based on actual usage in loadModelContext or other places
        // e.g., n_ctx, n_threads, n_gpu_layers, etc.
        // For now, using 'any' as a placeholder if structure is unknown.
        n_ctx?: number;
        n_threads?: number;
        n_gpu_layers?: number;
        n_batch?: number;
        // ... other config properties as needed by useEngineData.getState().config
    };

    // Actions (setters) for the state properties
    setLastModelLoaded: (model: ModelDataType | null) => void;
    setEmbeddingModelId: (id: number | null) => void;
    setRagReasoningModelId: (id: number | null) => void;
    setConfig: (config: any) => void; // Or more specific type for config
};

export const useEngineData = create<EngineDataState>()((set) => ({
    lastModelLoaded: null, // Initial state for last loaded main chat model
    embeddingModelId: null, // Initial state for selected embedding model ID
    ragReasoningModelId: null, // Initial state for selected RAG reasoning model ID
    config: { // Initial state for config, populate with defaults if known
        n_ctx: 4096, // Example default, verify with your app's actual defaults
        n_threads: 4,
        n_gpu_layers: 0,
        n_batch: 512,
    },

    setLastModelLoaded: (model) => set({ lastModelLoaded: model }),
    setEmbeddingModelId: (id) => set({ embeddingModelId: id }),
    setRagReasoningModelId: (id) => set({ ragReasoningModelId: id }),
    setConfig: (newConfig) => set((state) => ({ config: { ...state.config, ...newConfig } })),
}));
