// lib/rag/ragSystem.ts
import { useEffect, useState } from 'react'
// import { useRAG, MemoryVectorStore } from 'react-native-rag'

import { PleiasRAGLLMWrapper } from './PleiasRAGLLMWrapper'
import { QwenLlamaRNEngine } from './QwenLlamaRNEngine'

// Global instance of the RAG system, or a hook to provide it
let ragSystemInstance: ReturnType<typeof useRAG> | null = null
let isRAGSystemLoading = false
let ragSystemError: string | null = null

export const initRagSystem = async (knowledgeData: string[]) => {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    if (ragSystemInstance || isRAGSystemLoading) {
        // THIS IS THE LINE THAT NEEDS TO BE DISABLED
        console.log('[RAGSystem] RAG system already initialized or loading.')
        return ragSystemInstance
    }

    isRAGSystemLoading = true
    ragSystemError = null
    console.log('[RAGSystem] Initializing RAG system...')

    try {
        const embeddings = new QwenLlamaRNEngine()
        await embeddings.load()

        const vectorStore = new MemoryVectorStore({ embeddings })

        const pleiasLLM = new PleiasRAGLLMWrapper()
        await pleiasLLM.load()

        const { RAG } = require('react-native-rag')
        const ragInstance = new RAG({
            llm: pleiasLLM,
            vectorStore: vectorStore,
        })
        await ragInstance.load()

        console.log(`[RAGSystem] Adding ${knowledgeData.length} documents to vector store.`)
        for (const doc of knowledgeData) {
            await ragInstance.splitAddDocument(doc)
        }
        console.log('[RAGSystem] Documents added to vector store.')

        ragSystemInstance = ragInstance
        isRAGSystemLoading = false
        return ragSystemInstance
    } catch (e: any) {
        console.error('[RAGSystem] Error initializing RAG system:', e)
        ragSystemError = `RAG System Init Error: ${e.message}`
        isRAGSystemLoading = false
        throw e
    }
}

// Hook to access the RAG system instance from React components
export const useGlobalRAGSystem = () => {
    const [rag, setRag] = useState<ReturnType<typeof useRAG> | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (ragSystemInstance) {
            setRag(ragSystemInstance as any)
            setLoading(false)
        } else if (ragSystemError) {
            setError(ragSystemError)
            setLoading(false)
        } else if (!isRAGSystemLoading) {
            // Optionally trigger initRagSystem here or in app startup
        }
    }, [ragSystemInstance, isRAGSystemLoading, ragSystemError])

    return { rag, loading, error }
}

export const knowledgeBaseData = [
    'ChatterUI is a mobile application for AI chat.',
    'It supports local GGUF models.',
    'TCP client is used for peer-to-peer communication.',
    "Models can be copied into the application's assets.",
    'ChatterUI uses React Native for its UI.',
    'The application includes character management features.',
    'Swarm AI allows distributed inference across peers.',
]
