// lib/rag/QwenLlamaRNEngine.ts

import { LlamaContext } from 'cui-llama.rn'
import { Embeddings } from 'react-native-rag'

import { getEmbeddingLlamaContext } from '../engine/Local/LlamaLocal'


// FIX: Locally augment the LlamaContext interface to include the 'embedding' method
// This tells TypeScript that LlamaContext objects *will* have this method at runtime.
interface LlamaContextWithEmbedding extends LlamaContext {
    embedding(content: string): Promise<{ embedding: number[] }>;
}

export class QwenLlamaRNEngine implements Embeddings {
    // Change type to the augmented interface
    private embeddingContext: LlamaContextWithEmbedding | null = null
    private isLoading: boolean = false

    async load(): Promise<this> {
        if (this.embeddingContext && !this.isLoading) {
            console.log('[QwenLlamaRNEngine] Model already loaded or is loading. Skipping load.')
            return this
        }
        if (this.isLoading) {
            console.log('[QwenLlamaRNEngine] Model is currently loading, waiting...')
            return new Promise((resolve) => {
                const interval = setInterval(() => {
                    if (this.embeddingContext && !this.isLoading) {
                        clearInterval(interval)
                        resolve(this)
                    }
                }, 100)
            })
        }

        this.isLoading = true
        try {
            // FIX: Ensure Llama.getEmbeddingLlamaContext() returns a context capable of embeddings.
            // (Assuming this method internally calls initLlama with `embedding: true`)
            this.embeddingContext = await (getEmbeddingLlamaContext() as Promise<LlamaContextWithEmbedding>);
            if (!this.embeddingContext) {
                throw new Error(
                    'Failed to get Qwen Embedding Llama Context. Is the model selected in settings?'
                )
            }
            console.log('[QwenLlamaRNEngine] Qwen3-Embedding model loaded successfully.')
        } catch (error) {
            console.error('[QwenLlamaRNEngine] Error loading Qwen3-Embedding model:', error)
            this.embeddingContext = null
            throw error
        } finally {
            this.isLoading = false
        }
        return this
    }

    async unload(): Promise<void> {
        this.embeddingContext = null
        console.log('[QwenLlamaRNEngine] Qwen3-Embedding context reference released.')
    }

    async embed(text: string): Promise<number[]> {
        if (!this.embeddingContext) {
            await this.load()
            if (!this.embeddingContext)
                throw new Error('Qwen Embedding model failed to load or is not available.')
        }
        // FIX: Pass the string directly, not an object
        const { embedding } = await this.embeddingContext.embedding(`query: ${text}<|endoftext|>`)
        return embedding
    }

    async embedDocument(text: string): Promise<number[]> {
        if (!this.embeddingContext) {
            await this.load()
            if (!this.embeddingContext)
                throw new Error('Qwen Embedding model failed to load or is not available.')
        }
        // FIX: Pass the string directly, not an object
        const { embedding } = await this.embeddingContext.embedding(`${text}<|endoftext|>`)
        return embedding
    }
}
