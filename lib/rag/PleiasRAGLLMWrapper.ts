// lib/rag/PleiasRAGLLMWrapper.ts
import { LLM, Message } from 'react-native-rag';
import { LlamaContext } from 'cui-llama.rn';
import { Llama } from '../engine/Local/LlamaLocal'; // Correct: Import the Llama namespace

export class PleiasRAGLLMWrapper implements LLM {
    private pleiasContext: LlamaContext | null = null;
    private isLoading: boolean = false; // Added: State to prevent race conditions

    async load(): Promise<this> {
        if (this.pleiasContext && !this.isLoading) {
            console.log('[PleiasRAGLLMWrapper] Model already loaded or is loading. Skipping load.');
            return this; // Already loaded or in progress
        }
        if (this.isLoading) {
            // If already loading, wait for it to complete.
            console.log('[PleiasRAGLLMWrapper] Model is currently loading, waiting...');
            return new Promise(resolve => {
                const interval = setInterval(() => {
                    if (this.pleiasContext && !this.isLoading) {
                        clearInterval(interval);
                        resolve(this);
                    }
                }, 100);
            });
        }

        this.isLoading = true; // Set loading state
        try {
            // Corrected: Call the method on the Llama namespace
            this.pleiasContext = await Llama.getRagReasoningLlamaContext();
            if (!this.pleiasContext) {
                throw new Error("Failed to get Pleias RAG Llama Context. Is the model selected in settings?");
            }
            console.log('[PleiasRAGLLMWrapper] Pleias-RAG-350M model loaded successfully.');
        } catch (error) {
            console.error('[PleiasRAGLLMWrapper] Error loading Pleias-RAG-350M model:', error);
            this.pleiasContext = null; // Clear context on error
            throw error; // Re-throw to propagate the error
        } finally {
            this.isLoading = false; // Reset loading state
        }
        return this;
    }

    async unload(): Promise<void> {
        this.pleiasContext = null;
        console.log('[PleiasRAGLLMWrapper] Pleias-RAG-350M context reference released.');
    }

    async generate(messages: Message[], callback: (token: string) => void): Promise<string> {
        if (!this.pleiasContext) {
            await this.load(); // Fallback: Ensure loaded before generating
            if (!this.pleiasContext) throw new Error("Pleias RAG model failed to load or is not available.");
        }

        const fullPrompt = messages.map(msg => `${msg.role}: ${msg.content}`).join('\n');

        let generatedText = '';
        await this.pleiasContext.completion({
            prompt: fullPrompt,
            onToken: (token: string) => {
                generatedText += token;
                callback(token); // Stream tokens back to react-native-rag
            },
            // Add any other llama.rn parameters needed for Pleias (e.g., temperature, max_tokens)
        });

        return generatedText;
    }

    async interrupt(): Promise<void> {
        if (this.pleiasContext) {
            // Corrected: Use the stopCompletion method from llama.rn context
            await this.pleiasContext.stopCompletion();
            console.log('[PleiasRAGLLMWrapper] Generation interrupt requested.');
        }
    }
}
