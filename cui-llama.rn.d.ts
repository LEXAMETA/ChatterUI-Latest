// src/types/cui-llama.rn.d.ts or similar

declare module 'cui-llama.rn' {
  // Augment the existing ContextParams interface
  export interface ContextParams {
    lora_path?: string; // Add lora_path if it's supported by the native module
    // Add any other missing properties as needed
  }

  // Define CompletionTimings if it's not exported
  // You might need to confirm the exact structure from the cui-llama.rn documentation
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

  // Re-export other types if necessary to make sure they are accessible from 'cui-llama.rn' directly
  export * from 'cui-llama.rn';
}
