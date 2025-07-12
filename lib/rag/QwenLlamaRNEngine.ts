// lib/rag/QwenLlamaRNEngine.ts
import { Embeddings } from 'react-native-rag';
import { LlamaContext } from 'llama.rn';
import { getEmbeddingLlamaContext } from '../engine/Local/LlamaLocal'; // Assuming this provides the context

export class QwenLlamaRNEngine implements Embeddings {
    private embeddingContext: LlamaContext | null = null;

    async load(): Promise<this> {
        this.embeddingContext = await getEmbeddingLlamaContext();
        console.log('[QwenLlamaRNEngine] Qwen3-Embedding model loaded.');
        return this;
    }

    async unload(): Promise<void> {
        // Llama.rn contexts don't have an explicit 'unload' in the same way,
        // but we can manage it by setting the context to null if needed for resource release.
        this.embeddingContext = null;
        console.log('[QwenLlamaRNEngine] Qwen3-Embedding context released.');
    }

    async embed(text: string): Promise<number[]> {
        if (!this.embeddingContext) {
            await this.load(); // Ensure loaded before embedding
            if (!this.embeddingContext) throw new Error("Qwen Embedding model failed to load.");
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
            await this.load();
            if (!this.embeddingContext) throw new Error("Qwen Embedding model failed to load.");
        }
        const { embedding } = await this.embeddingContext.embedding({
            text: `${text}<|endoftext|>`,
        });
        return embedding;
    }
}
