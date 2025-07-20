// src/types/cui-llama.rn.d.ts

declare module 'cui-llama.rn' {
  // Re-declare or augment ContextParams with common Llama.cpp properties
  export interface ContextParams {
    model: string; // Crucial: You need to explicitly add this if it's missing from the base module's types
    n_ctx?: number;
    n_batch?: number;
    n_threads?: number;
    n_gpu_layers?: number;
    lora_path?: string;
    // Add any other parameters that cui-llama.rn's initLlama expects
  }

  // Re-declare main exports if they are no longer visible
  export class LlamaContext {
    constructor(params: ContextParams);
    completion(params: CompletionParams, callback: (data: { token: string }) => void): Promise<{ text: string; timings: CompletionTimings }>;
    stopCompletion(): Promise<void>;
    release(): Promise<void>;
    tokenizeSync(text: string): { tokens: number[] } | undefined;
    saveSession(filePath: string): Promise<number>;
    loadSession(filePath: string): Promise<void>;
    // Add any other methods/properties LlamaContext has
  }

  export function initLlama(params: ContextParams): Promise<LlamaContext>;
  export function getCpuFeatures(): Promise<string[]>; // Assuming this is also exported

  export interface CompletionParams {
    prompt: string;
    n_predict?: number;
    temp?: number;
    top_k?: number;
    top_p?: number;
    repeat_last_n?: number;
    repeat_penalty?: number;
    mirostat?: number;
    mirostat_tau?: number;
    mirostat_eta?: number;
    // Add any other completion parameters
  }

  // This part is correct from your previous submission
  export interface CompletionTimings {
    prompt_n: number;
    prompt_ms: number;
    prompt_per_token_ms: number;
    prompt_per_second?: number;
    predicted_n: number;
    predicted_ms: number;
    predicted_per_token_ms: number;
    predicted_per_second?: number;
  }
}
