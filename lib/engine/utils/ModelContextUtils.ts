// lib/engine/utils/ModelContextUtils.ts

import { db } from '@db';
import { model_data, ModelDataType } from 'db/schema';
import { eq } from 'drizzle-orm';
import * as FileSystem from 'expo-file-system';
import { ContextParams, LlamaContext, initLlama } from 'cui-llama.rn';
import { Logger } from '../../state/Logger'; // FIX: Correct path to Logger
import { checkGGMLDeprecated, GGMLType, getGGMLTypeFromFile } from '../Local/GGML'; // <--- UPDATED IMPORT

/**
 * Fetches a model from the database by its ID.
 * @param modelId The ID of the model to fetch.
 * @returns The ModelDataType if found, otherwise undefined.
 */
export async function fetchModelById(modelId: number) {
  return db.query.model_data.findFirst({ where: eq(model_data.id, modelId) });
}


/**
 * Validates if a given LoRA file path exists and checks for deprecation warnings.
 * @param loRAPath The URI path to the LoRA file.
 * @returns True if the file exists (even if deprecated), false otherwise.
 */
export async function validateLoRAFile(loRAPath: string): Promise<boolean> {
  if (!loRAPath) return false; // Ensure loRAPath is not null/undefined

  try {
    const fileInfo = await FileSystem.getInfoAsync(loRAPath);
    if (!fileInfo.exists) {
      Logger.warn('LoRA path does not exist, ignoring.');
      return false;
    }
    // Check for GGML deprecation status for the LoRA file itself
    // Note: checkGGMLDeprecated expects a path, ensure loRAPath is a valid local path, not 'file://' prefixed

    // <--- NEW LOGIC HERE --->
    const ggmlType = await getGGMLTypeFromFile(loRAPath); // Get the numeric GGMLType from the file

    if (ggmlType !== GGMLType.UNKNOWN && checkGGMLDeprecated(ggmlType)) { // Pass the numeric type
      Logger.warn('The LoRA file format is deprecated.');
    }
    // <--- END NEW LOGIC --->

    return true;
  } catch (error) {
    Logger.error(`Error validating LoRA file ${loRAPath}: ${error}`);
    return false;
  }
}

/**
 * Initializes a Llama context with given parameters.
 * @param params Context parameters for Llama initialization.
 * @returns The initialized LlamaContext, or null if initialization fails.
 */
export async function createLlamaContext(params: ContextParams): Promise<LlamaContext | null> {
  try {
    return await initLlama(params);
  } catch (error: any) {
    // We already have ModelContextUtils.ts, we'll use LoggerUtils.ts soon
    Logger.errorToast(`Could not initialize Llama context: ${error.message}`);
    return null;
  }
}

// Interface for options when loading a Llama context for a specific purpose (e.g., embedding, reasoning)
// This interface is also added to a global types file later for better visibility.
export interface LoadContextOptions {
  modelId: number;
  expectedType: ModelDataType['model_type'];
  currentContext: LlamaContext | null;
  loadedModel: ModelDataType | null;
  isEmbeddingModel?: boolean; // Useful for internal logic if embedding/reasoning models have slightly different handling
  loraPath?: string | null;
  // FIX 4: Now expects the subset of ContextParams that doesn't include 'model'
  config: Omit<ContextParams, 'model'>;
}
