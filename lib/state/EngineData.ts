// lib/state/EngineData.ts

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ModelDataType } from 'db/schema'; // Adjust the path if needed
import { ContextParams } from 'cui-llama.rn'; // Import for typing config

export interface EngineConfig extends Omit<ContextParams, 'model'> {
  n_ctx: number;
  n_threads: number;
  n_gpu_layers: number;
  n_batch: number;
  // You can add more engine-specific config props here if needed
}

export interface EngineDataState {
  config: EngineConfig;
  lastModelLoaded: ModelDataType | null;
  embeddingModelId: number | null;
  ragReasoningModelId: number | null;
  selectedEmbeddingLoRAUri: string | null;
  selectedReasoningLoRAUri: string | null;

  setEngineConfig: (config: Partial<EngineConfig>) => void;
  setLastModelLoaded: (model: ModelDataType | null) => void;
  setEmbeddingModelId: (id: number | null) => void;
  setRagReasoningModelId: (id: number | null) => void;
  setSelectedEmbeddingLoRAUri: (uri: string | null) => void;
  setSelectedReasoningLoRAUri: (uri: string | null) => void;
}

export const useEngineData = create<EngineDataState>()(
  persist(
    (set, get) => ({
      config: {
        n_ctx: 4096,
        n_threads: 4,
        n_gpu_layers: 0,
        n_batch: 512,
      },
      lastModelLoaded: null,
      embeddingModelId: null,
      ragReasoningModelId: null,
      selectedEmbeddingLoRAUri: null,
      selectedReasoningLoRAUri: null,

      setEngineConfig: (newConfig) => set((state) => ({ config: { ...state.config, ...newConfig } })),
      setLastModelLoaded: (model) => set({ lastModelLoaded: model }),
      setEmbeddingModelId: (id) => set({ embeddingModelId: id }),
      setRagReasoningModelId: (id) => set({ ragReasoningModelId: id }),
      setSelectedEmbeddingLoRAUri: (uri) => set({ selectedEmbeddingLoRAUri: uri }),
      setSelectedReasoningLoRAUri: (uri) => set({ selectedReasoningLoRAUri: uri }),
    }),
    {
      name: 'engine-data-storage',
      storage: createJSONStorage(() => localStorage), // Change to your preferred storage like MMKV if needed
      partialize: (state) => ({
        config: state.config,
        embeddingModelId: state.embeddingModelId,
        ragReasoningModelId: state.ragReasoningModelId,
        selectedEmbeddingLoRAUri: state.selectedEmbeddingLoRAUri,
        selectedReasoningLoRAUri: state.selectedReasoningLoRAUri,
        // Note: lastModelLoaded typically is runtime state, so not persisted
      }),
    }
  )
);
