// lib/rag/PleiasRAGLLMWrapper.ts
import { LLM, Message } from 'react-native-rag';
import { LlamaContext } from 'cui-llama.rn';
import { Llama } from '../engine/Local/LlamaLocal'; // Assuming this provides the context

export class PleiasRAGLLMWrapper implements LLM {
    private pleiasContext: LlamaContext | null = null;

    async load(): Promise<this> {
        this.pleiasContext = await getRagReasoningLlamaContext();
        console.log('[PleiasRAGLLMWrapper] Pleias-RAG-350M model loaded.');
        return this;
    }

    async unload(): Promise<void> {
        this.pleiasContext = null;
        console.log('[PleiasRAGLLMWrapper] Pleias-RAG-350M context released.');
    }

    async generate(messages: Message[], callback: (token: string) => void): Promise<string> {
        if (!this.pleiasContext) {
            await this.load(); // Ensure loaded before generating
            if (!this.pleiasContext) throw new Error("Pleias RAG model failed to load.");
        }

        // react-native-rag's `generate` provides `Message[]`.
        // You need to convert this to a single string prompt for llama.rn.
        // Pleias-RAG-350M expects a structured input (query and sources).
        // `react-native-rag`'s `generate` method (on the RAG class/hook) handles combining
        // the query and retrieved chunks into a prompt for *this* LLM.
        // So, `messages` here will be the combined prompt from `react-native-rag`.

        // For Pleias, the prompt might look something like:
        // "query: ${user_query}\nsources: ${[source1, source2, ...]}`
        // You'll need to confirm the exact format `react-native-rag` passes.

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
            // Assuming llama.rn context has an interrupt method, or manage a cancellation token
            // For now, this is a placeholder as llama.rn's interrupt might be global or not directly exposed on context
            // For streaming, the `callback` itself can be used to stop the process.
            console.log('[PleiasRAGLLMWrapper] Generation interrupt requested.');
        }
    }
}
