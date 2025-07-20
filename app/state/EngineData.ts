// app/state/EngineData.ts

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from '@storage/MMKV'; // Assuming this path based on your file list
import { ModelDataType } from 'db/schema'; // Assuming ModelDataType is exported from here

// Define the state interface for the EngineData store
export interface EngineDataState {
    // Model IDs for RAG contexts
    embeddingModelId: number | null;
    ragReasoningModelId: number | null;

    // LoRA URIs associated with RAG models
    selectedEmbeddingLoRAUri: string | null;
    selectedReasoningLoRAUri: string | null;

    // Configuration object (type can be refined if known, 'any' for now)
    config: any; // Placeholder - ideally define a more specific type if config structure is known

    // Last loaded main chat model (used in LlamaLocal.ts)
    lastModelLoaded: ModelDataType | null;

    // Actions (setters)
    setEmbeddingModelId: (id: number | null) => void;
    setRagReasoningModelId: (id: number | null) => void;
    setSelectedEmbeddingLoRAUri: (uri: string | null) => void;
    setSelectedReasoningLoRAUri: (uri: string | null) => void;
    setLastModelLoaded: (model: ModelDataType | null) => void;
    setConfig: (config: any) => void; // Placeholder setter for config
}

// Create the Zustand store
export const useEngineData = create<EngineDataState>()(
    persist(
        (set) => ({
            embeddingModelId: null,
            ragReasoningModelId: null,
            selectedEmbeddingLoRAUri: null,
            selectedReasoningLoRAUri: null,
            config: {}, // Initialize with an empty object or a default config
            lastModelLoaded: null,

            setEmbeddingModelId: (id) => set({ embeddingModelId: id }),
            setRagReasoningModelId: (id) => set({ ragReasoningModelId: id }),
            setSelectedEmbeddingLoRAUri: (uri) => set({ selectedEmbeddingLoRAUri: uri }),
            setSelectedReasoningLoRAUri: (uri) => set({ selectedReasoningLoRAUri: uri }),
            setLastModelLoaded: (model) => set({ lastModelLoaded: model }),
            setConfig: (config) => set({ config: config }),
        }),
        {
            name: 'engine-data-storage', // unique name for the storage
            storage: createJSONStorage(() => mmkvStorage), // Use MMKV for persistence
        }
    )
);

// Optional: Export the interface as EngineDataProps for consistency in other components
// This allows you to use `EngineDataState` for the store definition and `EngineDataProps`
// for component prop types, if you prefer that naming convention.
export type EngineDataProps = EngineDataState;

