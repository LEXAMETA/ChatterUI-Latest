// lib/rag/QwenLlamaRNEngine.ts
import { Embeddings } from 'react-native-rag';
import { LlamaContext } from 'cui-llama.rn';
import { Llama } from '../engine/Local/LlamaLocal'; // Correct: Import the Llama namespace

export class QwenLlamaRNEngine implements Embeddings {
    private embeddingContext: LlamaContext | null = null;
    private isLoading: boolean = false; // Added: State to prevent race conditions

    async load(): Promise<this> {
        if (this.embeddingContext && !this.isLoading) {
            console.log('[QwenLlamaRNEngine] Model already loaded or is loading. Skipping load.');
            return this; // Already loaded or in progress
        }
        if (this.isLoading) {
            // If already loading, wait for it to complete. This is a simple retry.
            // For production, consider a more robust promise queue.
            console.log('[QwenLlamaRNEngine] Model is currently loading, waiting...');
            return new Promise(resolve => {
                const interval = setInterval(() => {
                    if (this.embeddingContext && !this.isLoading) {
                        clearInterval(interval);
                        resolve(this);
                    }
                }, 100);
            });
        }

        this.isLoading = true; // Set loading state
        try {
            // Corrected: Call the method on the Llama namespace
            this.embeddingContext = await Llama.getEmbeddingLlamaContext();
            if (!this.embeddingContext) {
                throw new Error("Failed to get Qwen Embedding Llama Context. Is the model selected in settings?");
            }
            console.log('[QwenLlamaRNEngine] Qwen3-Embedding model loaded successfully.');
        } catch (error) {
            console.error('[QwenLlamaRNEngine] Error loading Qwen3-Embedding model:', error);
            this.embeddingContext = null; // Clear context on error
            throw error; // Re-throw to propagate the error
        } finally {
            this.isLoading = false; // Reset loading state
        }
        return this;
    }

    async unload(): Promise<void> {
        // Llama.rn contexts are managed by LlamaLocal, so we primarily clear our local reference.
        // If a true "unload" from memory is needed, that would be handled in LlamaLocal.ts
        // via a dispose method on the LlamaContext itself if llama.rn exposes it.
        this.embeddingContext = null;
        console.log('[QwenLlamaRNEngine] Qwen3-Embedding context reference released.');
    }

    async embed(text: string): Promise<number[]> {
        if (!this.embeddingContext) {
            // Fallback: Try to load if not already. Ideally, load() is called explicitly by the RAG system.
            await this.load();
            if (!this.embeddingContext) throw new Error("Qwen Embedding model failed to load or is not available.");
        }
        // Qwen recommends <|endoftext|> and 'query:' prefix for queries
        const { embedding } = await this.embeddingContext.embedding({
            text: `query: ${text}<|endoftext|>`,
        });
        return embedding;
    }

    // For documents, it might be just text<|endoftext|> without 'query:' prefix
    async embedDocument(text: string): Promise<number[]> {
         if (!this.embeddingContext) {
            await this.load(); // Fallback: Try to load if not already.
            if (!this.embeddingContext) throw new Error("Qwen Embedding model failed to load or is not available.");
        }
        const { embedding } = await this.embeddingContext.embedding({
            text: `${text}<|endoftext|>`,
        });
        return embedding;
    }
}
