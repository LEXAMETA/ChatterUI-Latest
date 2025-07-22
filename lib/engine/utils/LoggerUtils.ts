// lib/engine/utils/LoggerUtils.ts

import { Logger } from '../../state/Logger' // Assuming Logger path

/**
 * Reports a model-related error to the user with a toast message.
 * @param type A string indicating the type or context of the model error (e.g., 'RAG Embedding Model').
 * @param message The error message to display.
 */
export function reportModelError(type: string, message: string) {
    Logger.errorToast(`${type}: ${message}`)
}
