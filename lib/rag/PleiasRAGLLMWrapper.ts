import { LlamaContext } from 'cui-llama.rn' // For LlamaContext
// import { LLM, Message } from 'react-native-rag' // For LLM and Message

// import { getRagReasoningLlamaContext } from '../engine/Local/LlamaLocal' // For the new Llama context function

export class PleiasRAGLLMWrapper implements LLM {
    private pleiasContext: LlamaContext | null = null
    private isLoading: boolean = false

    async load(): Promise<this> {
        if (this.pleiasContext && !this.isLoading) {
            console.log('[PleiasRAGLLMWrapper] Model already loaded or is loading. Skipping load.')
            return this
        }
        if (this.isLoading) {
            console.log('[PleiasRAGLLMWrapper] Model is currently loading, waiting...')
            return new Promise((resolve) => {
                const interval = setInterval(() => {
                    if (this.pleiasContext && !this.isLoading) {
                        clearInterval(interval)
                        resolve(this)
                    }
                }, 100)
            })
        }

        this.isLoading = true
        try {
            this.pleiasContext = await getRagReasoningLlamaContext()
            if (!this.pleiasContext) {
                throw new Error(
                    'Failed to get Pleias RAG Llama Context. Is the model selected in settings?'
                )
            }
            console.log('[PleiasRAGLLMWrapper] Pleias-RAG-350M model loaded successfully.')
        } catch (error) {
            console.error('[PleiasRAGLLMWrapper] Error loading Pleias-RAG-350M model:', error)
            this.pleiasContext = null
            throw error
        } finally {
            this.isLoading = false
        }
        return this
    }

    async unload(): Promise<void> {
        this.pleiasContext = null
        console.log('[PleiasRAGLLMWrapper] Pleias-RAG-350M context reference released.')
    }

    async generate(messages: Message[], callback: (token: string) => void): Promise<string> {
        if (!this.pleiasContext) {
            await this.load()
            if (!this.pleiasContext)
                throw new Error('Pleias RAG model failed to load or is not available.')
        }

        const fullPrompt = messages.map((msg) => `${msg.role}: ${msg.content}`).join('\n')

        let generatedText = ''
        // THIS IS THE CRUCIAL CHANGE for the completion call
        await this.pleiasContext.completion(
            {
                // First argument: CompletionParams object
                prompt: fullPrompt,
                // Add any other standard llama.rn parameters (like n_predict, temp, top_k, etc.) here if needed
            },
            (data: { token: string }) => {
                // Second argument: The callback for token streaming
                const token = data.token
                generatedText += token
                callback(token) // Pass the token received from llama.rn to react-native-rag's callback
            }
        )

        return generatedText
    }

    async interrupt(): Promise<void> {
        if (this.pleiasContext) {
            await this.pleiasContext.stopCompletion()
            console.log('[PleiasRAGLLMWrapper] Generation interrupt requested.')
        }
    }
}
