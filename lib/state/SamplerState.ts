import {
    defaultSamplerConfig,
    SamplerConfigData,
    SamplerID,
    Samplers,
} from '@lib/constants/SamplerData'
import { Storage } from '@lib/enums/Storage'
import { Logger } from '@lib/state/Logger'
import { mmkvStorage } from '@lib/storage/MMKV'
import { getDocumentAsync } from 'expo-document-picker'
import { EncodingType, readAsStringAsync } from 'expo-file-system'
import { create } from 'zustand'
import { createJSONStorage, persist, PersistOptions, PersistStorage } from 'zustand/middleware'

export type SamplerConfig = {
    name: string
    data: SamplerConfigData
}

export type SamplerStateProps = {
    currentConfigIndex: number
    configList: SamplerConfig[]
    updateCurrentConfig: (preset: SamplerConfig) => void
    addSamplerConfig: (preset: SamplerConfig) => void
    deleteSamplerConfig: (index: number) => void
    setConfig: (index: number) => void
    fixConfigs: () => void
}

type PersistedSamplerState = Pick<SamplerStateProps, 'configList' | 'currentConfigIndex'>

export namespace SamplersManager {
    export const useSamplerState = create<SamplerStateProps>()(
        persist(
            (set, get) => ({
                currentConfigIndex: 0,
                configList: [{ name: 'Default', data: defaultSamplerConfig }],
                addSamplerConfig: (config) => {
                    const configs = get().configList
                    if (configs.some((item) => item.name === config.name)) {
                        Logger.errorToast(`Sampler Config "${config.name}" already exists!`)
                        return
                    }
                    config.data = fixSamplerConfig(config.data)
                    set((state) => ({
                        ...state,
                        configList: [...state.configList, config],
                        currentConfigIndex: state.configList.length,
                    }))
                },
                deleteSamplerConfig: (index) => {
                    set((state) => {
                        const newList = state.configList.filter((_, i) => i !== index)
                        let newIndex = state.currentConfigIndex
                        if (index === state.currentConfigIndex) {
                            newIndex = 0
                        } else if (index < state.currentConfigIndex) {
                            newIndex = Math.max(0, state.currentConfigIndex - 1)
                        }
                        return {
                            ...state,
                            configList: newList,
                            currentConfigIndex: newIndex,
                        }
                    })
                },
                setConfig: (index) => {
                    const maxLength = get().configList.length
                    if (index >= maxLength || index < 0) {
                        Logger.warn(`Attempted to set config index out of bounds: ${index}`)
                        return
                    }
                    set((state) => ({
                        ...state,
                        currentConfigIndex: index,
                    }))
                },
                updateCurrentConfig: (config) => {
                    set((state) => {
                        const configs = [...state.configList]
                        const index = state.currentConfigIndex
                        configs[index] = config
                        return {
                            ...state,
                            configList: configs,
                        }
                    })
                },
                fixConfigs: () => {
                    set((state) => ({
                        ...state,
                        configList: state.configList.map((item) => ({
                            name: item.name,
                            data: fixSamplerConfig(item.data),
                        })),
                    }))
                },
            }),
            {
                name: Storage.Samplers,
                storage: createJSONStorage(
                    () => mmkvStorage
                ) as PersistStorage<PersistedSamplerState>,
                version: 1,
                // --- FIX STARTS HERE ---
                // Explicitly type the 'state' parameter of the partialize function
                partialize: (state: SamplerStateProps) => ({
                    configList: state.configList,
                    currentConfigIndex: state.currentConfigIndex,
                }),
                // --- FIX ENDS HERE ---
                migrate: async (persistedState: unknown, version: number): Promise<void> => {},
            } as unknown as PersistOptions<SamplerStateProps, PersistedSamplerState>
        )
    )

    export const useSamplers = () => {
        const {
            currentConfigIndex,
            configList,
            addSamplerConfig,
            deleteSamplerConfig,
            setConfig: changeConfig,
            updateCurrentConfig,
        } = useSamplerState((state) => ({
            currentConfigIndex: state.currentConfigIndex,
            configList: state.configList,
            addSamplerConfig: state.addSamplerConfig,
            deleteSamplerConfig: state.deleteSamplerConfig,
            setConfig: state.setConfig,
            updateCurrentConfig: state.updateCurrentConfig,
        }))

        const currentConfig = configList[currentConfigIndex]

        return {
            currentConfigIndex,
            addSamplerConfig,
            deleteSamplerConfig,
            changeConfig,
            updateCurrentConfig,
            currentConfig,
            configList,
        }
    }

    export const getCurrentSampler = () => {
        const state = useSamplerState.getState()
        return state.configList[state.currentConfigIndex].data
    }

    export const importConfigFile = async (): Promise<SamplerConfig | undefined> => {
        try {
            const result = await getDocumentAsync({ type: ['application/*'] })
            if (
                result.canceled ||
                !result.assets?.[0] ||
                (!result.assets[0].name.endsWith('.json') &&
                    !result.assets[0].name.endsWith('.settings'))
            ) {
                Logger.errorToast(`Invalid File Type! Please select a .json or .settings file.`)
                return
            }
            const name = result.assets[0].name
                .replace('.json', '')
                .replace('.settings', '')
                .replace(/ /g, '_')
            const dataStr = await readAsStringAsync(result.assets[0].uri, {
                encoding: EncodingType.UTF8,
            })
            const data = JSON.parse(dataStr)
            return { data, name }
        } catch (e) {
            Logger.errorToast(
                `Failed to import configuration: ${e instanceof Error ? e.message : e}`
            )
        }
    }
}

/**
 * Ensures that the sampler config has all required keys with correct types.
 * Specifically coerces SEED from string to number if needed.
 * Adds missing keys with default values.
 */
export const fixSamplerConfig = (config: SamplerConfigData): SamplerConfigData => {
    const existingKeys = Object.keys(config)
    const defaultKeys = Object.values(SamplerID) as SamplerID[]
    let allKeysPresent = true

    for (const key of defaultKeys) {
        if (key === SamplerID.SEED && typeof config[key] === 'string') {
            // Attempt to safely parse SEED if it's a string
            const parsed = parseInt(config[key] as unknown as string, 10)
            if (!isNaN(parsed)) {
                config[key] = parsed
            } else {
                Logger.warn(
                    `Sampler Config SEED value "${config[key]}" could not be parsed to number.`
                )
            }
        }
        if (!existingKeys.includes(key)) {
            // Add missing key with default value
            config[key] = Samplers[key].values.default
            allKeysPresent = false
            Logger.debug(`Sampler Config was missing field: ${key}, added default.`)
        }
    }

    if (!allKeysPresent) {
        Logger.warn(`Sampler Config had missing fields and was fixed.`)
    }

    return config
}
