import { SamplerID, Samplers } from '@lib/constants/SamplerData';
import { Instructs } from '@lib/state/Instructs';
import { SamplersManager } from '@lib/state/SamplerState';
import { Logger } from '@lib/state/Logger'; // Explicitly import Logger

import { APIConfiguration, APISampler, APIValues } from './APIBuilder.types';
import { buildChatCompletionContext, buildTextCompletionContext } from './ContextBuilder';

/**
 * Builds an API request payload depending on the configuration and selected provider.
 */
export const buildRequest = (config: APIConfiguration, values: APIValues) => {
    switch (config.payload.type) {
        case 'openai':
            return openAIRequest(config, values);
        case 'ollama':
            return ollamaRequest(config, values);
        case 'cohere':
            return cohereRequest(config, values);
        case 'horde':
            return hordeRequest(config, values);
        case 'claude':
            return claudeRequest(config, values);
        case 'custom':
            return customRequest(config, values);
        default:
            return undefined;
    }
};

/**
 * OpenAI-style request builder.
 */
const openAIRequest = (config: APIConfiguration, values: APIValues) => {
    const { payloadFields, model, stop, prompt } = buildFields(config, values);
    return {
        ...payloadFields,
        ...model,
        ...stop,
        ...prompt,
    };
};

/**
 * Ollama request builder.
 */
const ollamaRequest = (config: APIConfiguration, values: APIValues) => {
    const { payloadFields, model, stop, prompt } = buildFields(config, values);
    let keep_alive = 5;
    if (payloadFields.keep_alive) {
        keep_alive = payloadFields.keep_alive as number;
        delete payloadFields.keep_alive;
    }
    return {
        options: {
            ...payloadFields,
            ...stop,
        },
        keep_alive: keep_alive + 'm',
        ...model,
        ...prompt,
        raw: true,
        stream: true,
    };
};

/**
 * Cohere request builder.
 */
const cohereRequest = (config: APIConfiguration, values: APIValues) => {
    if (config.request.completionType.type === 'textCompletions') {
        // This function is designed for chat completions for Cohere
        return undefined; // Return undefined if it's not a chat completion
    }
    const { payloadFields, model, stop, prompt } = buildFields(config, values);

    const seedObject = config.request.samplerFields.find(
        (item) => item.samplerID === SamplerID.SEED
    );

    if (
        seedObject &&
        payloadFields?.[seedObject.externalName] !== undefined &&
        payloadFields?.[seedObject.externalName] === -1
    ) {
        delete payloadFields[seedObject.externalName];
    }

    const promptData = prompt?.[config.request.promptKey];

    // Ensure promptData is an array for chat completions
    if (!Array.isArray(promptData)) {
        Logger.errorToast('Cohere Request: Prompt data is not an array for chat completion type. Returning undefined payload.');
        return undefined;
    }

    let preambleContent: string | undefined = undefined;
    let chatHistoryMessages: Array<{ role: string; message: string }> = [];
    let lastMessageContent: string = '';

    if (promptData.length > 0) {
        // The first message in promptData is intended for 'preamble'
        const firstMessage = promptData[0];
        // Cohere preamble expects a string (system message), typically 'content' from our message objects
        if (firstMessage && typeof firstMessage === 'object' && ('content' in firstMessage || 'message' in firstMessage)) {
            // Prefer 'content', fallback to 'message' if present
            preambleContent = (firstMessage as any).content || (firstMessage as any).message;
            if (typeof preambleContent !== 'string') {
                preambleContent = undefined; // Ensure it's a string or undefined
                Logger.warn('Cohere request: Preamble content is not a string.');
            }
        } else {
             Logger.warn('Cohere request: First message in promptData has no valid content/message for preamble.');
        }

        // Messages from the second to the second-to-last go into chat_history
        // Cohere chat_history expects objects with 'role' and 'message' (string)
        const historySlice = promptData.slice(1, promptData.length - 1);
        chatHistoryMessages = historySlice.map(msg => {
            if (msg && typeof msg === 'object' && 'role' in msg && ('content' in msg || 'message' in msg)) {
                const messageText = (msg as any).content || (msg as any).message;
                if (typeof messageText === 'string') {
                    return { role: (msg as any).role, message: messageText };
                }
            }
            Logger.warn('Cohere request: Invalid message format in chat history. Skipping this message.');
            return null; // Return null for invalid messages, will be filtered out
        }).filter(Boolean) as Array<{ role: string; message: string }>; // Filter out nulls and assert type

        // The very last message is for the Cohere 'message' field (config.request.promptKey)
        const lastMessage = promptData[promptData.length - 1];
        if (lastMessage && typeof lastMessage === 'object' && ('content' in lastMessage || 'message' in lastMessage)) {
            // Prefer 'content', fallback to 'message' if present
            lastMessageContent = (lastMessage as any).content || (lastMessage as any).message;
            if (typeof lastMessageContent !== 'string') {
                lastMessageContent = ''; // Ensure it's a string
                Logger.warn('Cohere request: Last message content is not a string.');
            }
        } else {
            Logger.warn('Cohere request: Last message in promptData has no valid content/message.');
        }
    } else {
        // If promptData is an empty array after the initial check
        Logger.warn('Cohere request: Prompt data array is empty after initial check for chat completion type. This should ideally not happen if buildChatCompletionContext ensures at least one message for chat.');
        // No preamble, history, or last message if array is empty
    }

    return {
        ...payloadFields,
        ...stop,
        ...model,
        preamble: preambleContent, // This will be undefined if no first message or no valid content
        chat_history: chatHistoryMessages,
        [config.request.promptKey]: lastMessageContent,
    };
};

/**
 * Claude request builder.
 */
const claudeRequest = (config: APIConfiguration, values: APIValues) => {
    const { payloadFields, model, stop, prompt } = buildFields(config, values);

    const systemPrompt = Instructs.useInstruct.getState().data?.system_prompt;
    const systemRole =
        config.request.completionType.type === 'chatCompletions'
            ? config.request.completionType.systemRole
            : 'system';
    const promptObject = prompt?.[config.request.promptKey];
    const finalPrompt = Array.isArray(promptObject)
        ? {
              [config.request.promptKey]: promptObject.filter(
                  (item) => item.role !== systemRole && (item as any)['content'] // Use 'any' or define stricter types
              ),
          }
        : prompt;
    return {
        system: systemPrompt,
        ...payloadFields,
        stream: true,
        ...model,
        ...stop,
        ...finalPrompt,
    };
};

/**
 * Horde request builder.
 */
const hordeRequest = (config: APIConfiguration, values: APIValues) => {
    const { payloadFields, model, stop, prompt } = buildFields(config, values);
    return {
        params: {
            ...payloadFields,
            n: 1,
            frmtadsnsp: false,
            frmtrmblln: false,
            frmtrmspch: false,
            frmttriminc: true,
            ...stop,
        },
        ...prompt,
        trusted_workers: false,
        slow_workers: true,
        workers: [],
        worker_blacklist: false,
        models: model.model,
        dry_run: false,
    };
};

/**
 * Custom request builder, replaces macros in payload template string.
 */
const customRequest = (config: APIConfiguration, values: APIValues) => {
    if (config.payload.type !== 'custom') return {};
    const modelName = getModelName(config, values);

    let length = 0;
    const sampler = SamplersManager.getCurrentSampler();

    if (config.model.useModelContextLength) {
        length = getModelContextLength(config, values) ?? 0;
    }

    let prompt: any = undefined;
    if (config.request.completionType.type === 'chatCompletions') {
        prompt = buildChatCompletionContext(length, config, values);
    } else {
        prompt = buildTextCompletionContext(length);
    }

    let responseBody = config.payload.customPayload;

    // Replace all macros with the current sampler values
    for (const item of config.request.samplerFields) {
        const macro = Samplers[item.samplerID].macro;
        responseBody = responseBody.replaceAll(macro, sampler?.[item.samplerID]?.toString() ?? '');
    }
    responseBody = responseBody.replaceAll('{{stop}}', constructStopSequence().toString());
    responseBody = responseBody.replaceAll('{{prompt}}', prompt);
    responseBody = responseBody.replaceAll('{{model}}', modelName?.toString() ?? '');

    return responseBody;
};

/**
 * Helper to build request fields for all providers.
 */
const buildFields = (config: APIConfiguration, values: APIValues) => {
    const payloadFields = getSamplerFields(config, values);

    // Model Data
    const model = config.features.useModel
        ? {
              model: getModelName(config, values),
          }
        : {};

    // Stop Sequence
    const stop = config.request.useStop ? { [config.request.stopKey]: constructStopSequence() } : {};

    // Seed Data
    const seedObject = config.request.samplerFields.find(
        (item) => item.samplerID === SamplerID.SEED
    );

    if (
        seedObject &&
        config.request.removeSeedifNegative &&
        payloadFields?.[seedObject.externalName] !== undefined &&
        payloadFields?.[seedObject.externalName] < 0
    ) {
        delete payloadFields[seedObject.externalName];
    }

    // Context Length
    const contextLengthObject = config.request.samplerFields.find(
        (item) => item.samplerID === SamplerID.CONTEXT_LENGTH
    );

    // Declare instructLengthField here, outside the 'if' block
    let instructLengthField: any = undefined; // Use 'any' for now for flexibility, or 'number | undefined' if you're strict

    if (contextLengthObject) {
        // Assign the value (remove 'const' here)
        instructLengthField = payloadFields?.[contextLengthObject.externalName];
        if (instructLengthField !== undefined) {
            delete payloadFields[contextLengthObject.externalName];
        }
    }

    const modelLengthField = getModelContextLength(config, values);
    const instructLength =
        typeof instructLengthField === 'number' ? instructLengthField : (modelLengthField ?? 0);
    const modelLength = modelLengthField ?? instructLength;
    const length = config.model.useModelContextLength
        ? Math.min(modelLength, instructLength)
        : instructLength;

    // Prompt
    const prompt = {
        [config.request.promptKey]:
            config.request.completionType.type === 'chatCompletions'
                ? buildChatCompletionContext(length, config, values)
                : buildTextCompletionContext(length),
    };
    return { payloadFields, model, stop, prompt, length };
};

/**
 * Deep value getter for nested model property.
 */
const getNestedValue = (obj: any, path: string) => {
    if (!path) return obj;
    const keys = path.split('.');
    let value = obj;
    for (const key of keys) {
        value = value?.[key];
        if (value === undefined) return null;
    }
    return value;
};

/**
 * Gets the model name, supports multiple models.
 */
const getModelName = (config: APIConfiguration, values: APIValues) => {
    if (config.features.multipleModels) {
        return values.model.map((item: any) => getNestedValue(item, config.model.nameParser));
    } else {
        return getNestedValue(values.model, config.model.nameParser);
    }
};

/**
 * Gets the model's context length, or undefined.
 */
const getModelContextLength = (config: APIConfiguration, values: APIValues): number | undefined => {
    if (!config.model.contextSizeParser) return undefined;
    const keys = config.model.contextSizeParser.split('.');
    let result = values.model;
    for (const key of keys) {
        result = result?.[key];
        if (result === undefined) return undefined;
    }
    return Number.isInteger(result) ? result : undefined;
};

/**
 * Gets fields for all samplers, normalizing types as needed.
 */
const getSamplerFields = (config: APIConfiguration, values: APIValues) => {
    let max_length = undefined;
    if (config.model.useModelContextLength) {
        max_length = getModelContextLength(config, values);
    }
    const preset = SamplersManager.getCurrentSampler();
    const fieldObj: Record<string, any> = {};

    for (const item of config.request.samplerFields) {
        const value = preset[item.samplerID];
        const samplerItem = Samplers[item.samplerID];
        let cleanvalue = value;
        if (typeof value === 'number') {
            if (item.samplerID === SamplerID.CONTEXT_LENGTH && max_length) {
                cleanvalue = Math.min(value, max_length);
            } else if (samplerItem.values.type === 'integer') {
                cleanvalue = Math.floor(value);
            }
        }
        if (item.samplerID === SamplerID.DRY_SEQUENCE_BREAK && typeof value === 'string') {
            cleanvalue = value.split(',');
        }
        fieldObj[item.externalName as SamplerID] = cleanvalue;
    }
    return fieldObj;
};

/**
 * Builds a stop sequence from instruct macros.
 */
const constructStopSequence = (): string[] => {
    const instruct = Instructs.useInstruct.getState().replacedMacros();
    const sequence: string[] = [];
    if (instruct.stop_sequence && instruct.stop_sequence !== '') {
        for (const item of instruct.stop_sequence.split(',')) {
            if (item !== '') sequence.push(item);
        }
    }
    return sequence;
};
