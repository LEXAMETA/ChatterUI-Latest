import { SamplerID, Samplers } from '@lib/constants/SamplerData'
import { Instructs } from '@lib/state/Instructs'
import { SamplersManager } from '@lib/state/SamplerState'

import { APIConfiguration, APISampler, APIValues } from './APIBuilder.types'
import { buildChatCompletionContext, buildTextCompletionContext } from './ContextBuilder'

/**
 * Builds an API request payload depending on the configuration and selected provider.
 */
export const buildRequest = (config: APIConfiguration, values: APIValues) => {
    switch (config.payload.type) {
        case 'openai':
            return openAIRequest(config, values)
        case 'ollama':
            return ollamaRequest(config, values)
        case 'cohere':
            return cohereRequest(config, values)
        case 'horde':
            return hordeRequest(config, values)
        case 'claude':
            return claudeRequest(config, values)
        case 'custom':
            return customRequest(config, values)
        default:
            return undefined
    }
}

/**
 * OpenAI-style request builder.
 */
const openAIRequest = (config: APIConfiguration, values: APIValues) => {
    const { payloadFields, model, stop, prompt } = buildFields(config, values)
    return {
        ...payloadFields,
        ...model,
        ...stop,
        ...prompt,
    }
}

/**
 * Ollama request builder.
 */
const ollamaRequest = (config: APIConfiguration, values: APIValues) => {
    const { payloadFields, model, stop, prompt } = buildFields(config, values)
    let keep_alive = 5
    if (payloadFields.keep_alive) {
        keep_alive = payloadFields.keep_alive as number
        delete payloadFields.keep_alive
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
    }
}

/**
 * Cohere request builder.
 */
const cohereRequest = (config: APIConfiguration, values: APIValues) => {
    if (config.request.completionType.type === 'textCompletions') {
        return
    }
    const { payloadFields, model, stop, prompt } = buildFields(config, values)

    const seedObject = config.request.samplerFields.find(
        (item) => item.samplerID === SamplerID.SEED
    )

    if (
        seedObject &&
        payloadFields?.[seedObject.externalName] !== undefined &&
        payloadFields?.[seedObject.externalName] === -1
    ) {
        delete payloadFields[seedObject.externalName]
    }

    const promptData = prompt?.[config.request.promptKey]
    if (!promptData || typeof promptData === 'string') return

    const [preamble, ...history] = promptData
    const last = history.pop()

    return {
        ...payloadFields,
        ...stop,
        ...model,
        preamble: preamble.message,
        chat_history: history,
        [config.request.promptKey]: last?.message ?? '',
    }
}

/**
 * Claude request builder.
 */
const claudeRequest = (config: APIConfiguration, values: APIValues) => {
    const { payloadFields, model, stop, prompt } = buildFields(config, values)

    const systemPrompt = Instructs.useInstruct.getState().data?.system_prompt
    const systemRole =
        config.request.completionType.type === 'chatCompletions'
            ? config.request.completionType.systemRole
            : 'system'
    const promptObject = prompt?.[config.request.promptKey]
    const finalPrompt = Array.isArray(promptObject)
        ? {
              [config.request.promptKey]: promptObject.filter(
                  (item) => item.role !== systemRole && item['content']
              ),
          }
        : prompt
    return {
        system: systemPrompt,
        ...payloadFields,
        stream: true,
        ...model,
        ...stop,
        ...finalPrompt,
    }
}

/**
 * Horde request builder.
 */
const hordeRequest = (config: APIConfiguration, values: APIValues) => {
    const { payloadFields, model, stop, prompt } = buildFields(config, values)
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
    }
}

/**
 * Custom request builder, replaces macros in payload template string.
 */
const customRequest = (config: APIConfiguration, values: APIValues) => {
    if (config.payload.type !== 'custom') return {}
    const modelName = getModelName(config, values)

    let length = 0
    const sampler = SamplersManager.getCurrentSampler()

    if (config.model.useModelContextLength) {
        length = getModelContextLength(config, values) ?? 0
    }

    let prompt: any = undefined
    if (config.request.completionType.type === 'chatCompletions') {
        prompt = buildChatCompletionContext(length, config, values)
    } else {
        prompt = buildTextCompletionContext(length)
    }

    let responseBody = config.payload.customPayload

    // Replace all macros with the current sampler values
    for (const item of config.request.samplerFields) {
        const macro = Samplers[item.samplerID].macro
        responseBody = responseBody.replaceAll(macro, sampler?.[item.samplerID]?.toString() ?? '')
    }
    responseBody = responseBody.replaceAll('{{stop}}', constructStopSequence().toString())
    responseBody = responseBody.replaceAll('{{prompt}}', prompt)
    responseBody = responseBody.replaceAll('{{model}}', modelName?.toString() ?? '')

    return responseBody
}

/**
 * Helper to build request fields for all providers.
 */
const buildFields = (config: APIConfiguration, values: APIValues) => {
    const payloadFields = getSamplerFields(config, values)

    // Model Data
    const model = config.features.useModel
        ? {
              model: getModelName(config, values),
          }
        : {}

    // Stop Sequence
    const stop = config.request.useStop ? { [config.request.stopKey]: constructStopSequence() } : {}

    // Seed Data
    const seedObject = config.request.samplerFields.find(
        (item) => item.samplerID === SamplerID.SEED
    )

    if (
        seedObject &&
        config.request.removeSeedifNegative &&
        payloadFields?.[seedObject.externalName] !== undefined &&
        payloadFields?.[seedObject.externalName] < 0
    ) {
        delete payloadFields[seedObject.externalName]
    }

    // Context Length
    const contextLengthObject = config.request.samplerFields.find(
        (item) => item.samplerID === SamplerID.CONTEXT_LENGTH
    )

    // Declare instructLengthField here, outside the 'if' block
    let instructLengthField: any = undefined // Use 'any' for now for flexibility, or 'number | undefined' if you're strict

    if (contextLengthObject) {
        // Assign the value (remove 'const' here)
        instructLengthField = payloadFields?.[contextLengthObject.externalName]
        if (instructLengthField !== undefined) {
            delete payloadFields[contextLengthObject.externalName]
        }
    }

    const modelLengthField = getModelContextLength(config, values)
    const instructLength =
        typeof instructLengthField === 'number' ? instructLengthField : (modelLengthField ?? 0)
    const modelLength = modelLengthField ?? instructLength
    const length = config.model.useModelContextLength
        ? Math.min(modelLength, instructLength)
        : instructLength

    // Prompt
    const prompt = {
        [config.request.promptKey]:
            config.request.completionType.type === 'chatCompletions'
                ? buildChatCompletionContext(length, config, values)
                : buildTextCompletionContext(length),
    }
    return { payloadFields, model, stop, prompt, length }
}

/**
 * Deep value getter for nested model property.
 */
const getNestedValue = (obj: any, path: string) => {
    if (!path) return obj
    const keys = path.split('.')
    let value = obj
    for (const key of keys) {
        value = value?.[key]
        if (value === undefined) return null
    }
    return value
}

/**
 * Gets the model name, supports multiple models.
 */
const getModelName = (config: APIConfiguration, values: APIValues) => {
    if (config.features.multipleModels) {
        return values.model.map((item: any) => getNestedValue(item, config.model.nameParser))
    } else {
        return getNestedValue(values.model, config.model.nameParser)
    }
}

/**
 * Gets the model's context length, or undefined.
 */
const getModelContextLength = (config: APIConfiguration, values: APIValues): number | undefined => {
    if (!config.model.contextSizeParser) return undefined
    const keys = config.model.contextSizeParser.split('.')
    let result = values.model
    for (const key of keys) {
        result = result?.[key]
        if (result === undefined) return undefined
    }
    return Number.isInteger(result) ? result : undefined
}

/**
 * Gets fields for all samplers, normalizing types as needed.
 */
const getSamplerFields = (config: APIConfiguration, values: APIValues) => {
    let max_length = undefined
    if (config.model.useModelContextLength) {
        max_length = getModelContextLength(config, values)
    }
    const preset = SamplersManager.getCurrentSampler()
    const fieldObj: Record<string, any> = {}

    for (const item of config.request.samplerFields) {
        const value = preset[item.samplerID]
        const samplerItem = Samplers[item.samplerID]
        let cleanvalue = value
        if (typeof value === 'number') {
            if (item.samplerID === SamplerID.CONTEXT_LENGTH && max_length) {
                cleanvalue = Math.min(value, max_length)
            } else if (samplerItem.values.type === 'integer') {
                cleanvalue = Math.floor(value)
            }
        }
        if (item.samplerID === SamplerID.DRY_SEQUENCE_BREAK && typeof value === 'string') {
            cleanvalue = value.split(',')
        }
        fieldObj[item.externalName as SamplerID] = cleanvalue
    }
    return fieldObj
}

/**
 * Builds a stop sequence from instruct macros.
 */
const constructStopSequence = (): string[] => {
    const instruct = Instructs.useInstruct.getState().replacedMacros()
    const sequence: string[] = []
    if (instruct.stop_sequence && instruct.stop_sequence !== '') {
        for (const item of instruct.stop_sequence.split(',')) {
            if (item !== '') sequence.push(item)
        }
    }
    return sequence
}
