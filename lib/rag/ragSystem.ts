// lib/rag/ragSystem.ts
import { useRAG, MemoryVectorStore } from 'react-native-rag';
import { QwenLlamaRNEngine } from './QwenLlamaRNEngine';
import { PleiasRAGLLMWrapper } from './PleiasRAGLLMWrapper';
import { useEffect, useState } from 'react';

// Global instance of the RAG system, or a hook to provide it
let ragSystemInstance: ReturnType<typeof useRAG> | null = null;
let isRAGSystemLoading = false;
let ragSystemError: string | null = null;

export const initRagSystem = async (knowledgeData: string[]) => {
    if (ragSystemInstance || isRAGSystemLoading) {
        console.log("[RAGSystem] RAG system already initialized or loading.");
        return ragSystemInstance;
    }

    isRAGSystemLoading = true;
    ragSystemError = null;
    console.log("[RAGSystem] Initializing RAG system...");

    try {
        const embeddings = new QwenLlamaRNEngine();
        await embeddings.load(); // Explicitly load the embedding model

        const vectorStore = new MemoryVectorStore({ embeddings });

        const pleiasLLM = new PleiasRAGLLMWrapper();
        await pleiasLLM.load(); // Explicitly load the Pleias RAG model

        // `useRAG` is a hook, so it needs to be called within a React component.
        // We'll return the initialized components, and the component using the hook
        // will then build the `useRAG` instance.

        // For initial setup, we might need a non-hook based RAG class if you
        // want to manage it outside a component. Let's adapt if needed.
        // Given the `react-native-rag` docs, the `RAG` class is what you'd use
        // for more control outside a hook.

        const ragInstance = new (require('react-native-rag').RAG)({
            llm: pleiasLLM,
            vectorStore: vectorStore,
        });
        await ragInstance.load(); // Load RAG components

        // Add knowledge base documents
        console.log(`[RAGSystem] Adding ${knowledgeData.length} documents to vector store.`);
        for (const doc of knowledgeData) {
            await ragInstance.splitAddDocument(doc);
        }
        console.log("[RAGSystem] Documents added to vector store.");

        ragSystemInstance = ragInstance; // Store the instance for global access
        isRAGSystemLoading = false;
        return ragSystemInstance;

    } catch (e: any) {
        console.error("[RAGSystem] Error initializing RAG system:", e);
        ragSystemError = `RAG System Init Error: ${e.message}`;
        isRAGSystemLoading = false;
        throw e;
    }
};

// This hook allows React components to access the initialized RAG system
export const useGlobalRAGSystem = () => {
    const [rag, setRag] = useState<ReturnType<typeof useRAG> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // This is a simplified example. In a real app, you'd manage the lifecycle
    // and ensure the RAG class instance (ragSystemInstance) is properly
    // tied to the useRAG hook's requirements if you want to use the hook API.
    // For now, let's assume `initRagSystem` returns a class instance,
    // and you manually manage its `generate` calls.

    // A better approach:
    // Use the `RAG` class directly as it's not a hook and can be managed globally.
    // Then, the `ChatMenu` component would call `ragSystemInstance.generate()`.
    // The `useRAG` hook would only be used if `react-native-rag` strictly ties
    // its internal state management to that hook, which for `RAG` class seems not the case.
    // Let's proceed with `RAG` class for global management.

    useEffect(() => {
        // This hook can just return the global instance after `initRagSystem` is called
        // outside of a component, perhaps on app startup.
        if (ragSystemInstance) {
            setRag(ragSystemInstance as any); // Type assertion for now
            setLoading(false);
        } else if (ragSystemError) {
            setError(ragSystemError);
            setLoading(false);
        } else if (!isRAGSystemLoading) {
             // Trigger initialization if not already happening
             // You might want to call initRagSystem in App.tsx's useEffect or similar
             // to ensure it's ready before components need it.
        }
    }, [ragSystemInstance, isRAGSystemLoading, ragSystemError]);

    return { rag, loading, error };
};

// Example knowledge base data (replace with actual data loading)
export const knowledgeBaseData = [
    "ChatterUI is a mobile application for AI chat.",
    "It supports local GGUF models.",
    "TCP client is used for peer-to-peer communication.",
    "Models can be copied into the application's assets.",
    "ChatterUI uses React Native for its UI.",
    "The application includes character management features.",
    "Swarm AI allows distributed inference across peers."
    // Add more comprehensive documentation here
];
