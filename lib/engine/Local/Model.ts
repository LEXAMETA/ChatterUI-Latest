import { db } from '@db'
import { Storage } from '@lib/enums/Storage'
import { Logger } from '@lib/state/Logger'
import { mmkvStorage } from '@lib/storage/MMKV'
import { AppDirectory, readableFileSize } from '@lib/utils/File'
import { initLlama } from 'cui-llama.rn'
import { model_data, ModelDataType } from 'db/schema'
import { eq } from 'drizzle-orm'
import { getDocumentAsync } from 'expo-document-picker'
import { copyAsync, deleteAsync, getInfoAsync, readDirectoryAsync } from 'expo-file-system'
import { Platform } from 'react-native'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { GGMLNameMap, GGMLType } from './GGML'

export type ModelData = Omit<ModelDataType, 'id' | 'create_date' | 'last_modified' | 'model_type'>

// Add this interface to define the structure of modelInfo.metadata
interface ModelMetadata {
    'general.architecture': string
    'general.name': string
    'general.size_label': string
    'general.file_type': string
    // Use an index signature for dynamic properties like `${modelArchitecture}.context_length`
    [key: string]: string | number // This allows any string key, with a value of string or number
}

export namespace Model {
    export const getModelList = async () => {
        return await readDirectoryAsync(AppDirectory.ModelPath)
    }

    export const deleteModelById = async (id: number) => {
        const modelInfo = await db.query.model_data.findFirst({ where: eq(model_data.id, id) })
        if (!modelInfo) return
        if (modelInfo.file_path.startsWith(AppDirectory.ModelPath))
            await deleteModel(modelInfo.file)
        await db.delete(model_data).where(eq(model_data.id, id))
    }

    export const importModel = async (modelType: ModelDataType['model_type'] = 'main_chat') => {
        const result = await getDocumentAsync({ copyToCacheDirectory: false })
        if (result.canceled) return false
        const file = result.assets?.[0]
        if (!file) {
            Logger.errorToast('No file selected or an error occurred during selection.')
            return false
        }
        const name = file.name
        const newdir = `${AppDirectory.ModelPath}${name}`
        Logger.infoToast('Importing file...')
        const success = await copyAsync({ from: file.uri, to: newdir })
            .then(() => true)
            .catch((error) => {
                Logger.errorToast(`Import Failed: ${error.message}`)
                return false
            })
        if (!success) return false
        return await createModelData(name, true, modelType)
    }

    export const linkModelExternal = async (
        modelType: ModelDataType['model_type'] = 'main_chat'
    ) => {
        const result = await getDocumentAsync({ copyToCacheDirectory: false })
        if (result.canceled) return false
        const file = result.assets?.[0]
        Logger.infoToast('Linking external file...')
        if (!file) {
            Logger.errorToast('File Invalid')
            return false
        }
        return await createModelDataExternal(file.uri, file.name, true, modelType)
    }

    export const verifyModelList = async () => {
        let modelList = await db.query.model_data.findMany()
        const fileList = await getModelList()

        if (Platform.OS === 'android') {
            for (const item of modelList) {
                if (item.name === '' || !(await getInfoAsync(item.file_path)).exists) {
                    Logger.warnToast(`Model Missing, its entry will be deleted: ${item.name}`)
                    await db.delete(model_data).where(eq(model_data.id, item.id))
                }
            }
        }

        modelList = await db.query.model_data.findMany() // refresh after deletion

        for (const item of fileList) {
            if (!modelList.some((model_data) => model_data.file === item)) {
                await createModelData(item, false, 'main_chat')
            }
        }
    }

    export const createModelData = async (
        filename: string,
        deleteOnFailure = false,
        modelType: ModelDataType['model_type'] = 'main_chat'
    ) => {
        return setModelDataInternal(
            filename,
            `${AppDirectory.ModelPath}${filename}`,
            deleteOnFailure,
            modelType
        )
    }

    export const createModelDataExternal = async (
        newdir: string,
        filename: string,
        deleteOnFailure = false,
        modelType: ModelDataType['model_type'] = 'main_chat'
    ) => {
        if (!filename) {
            Logger.errorToast('Filename invalid, Import Failed')
            return false
        }
        return setModelDataInternal(filename, newdir, deleteOnFailure, modelType)
    }

    export const getModelListQuery = () => db.query.model_data.findMany()

    export const updateName = async (name: string, id: number) => {
        await db.update(model_data).set({ name }).where(eq(model_data.id, id))
    }

    export const isInitialEntry = (data: ModelData) => {
        const initial: ModelData = {
            file: '',
            file_path: '',
            context_length: 0,
            name: 'N/A',
            file_size: 0,
            params: 'N/A',
            quantization: '-1',
            architecture: 'N/A',
        }
        for (const key in initial) {
            if (key === 'file' || key === 'file_path') continue
            if (initial[key as keyof ModelData] !== data[key as keyof ModelData]) return false
        }
        return true
    }

    const initialModelEntry = (
        filename: string,
        file_path: string,
        modelType: ModelDataType['model_type']
    ) => ({
        context_length: 0,
        file: filename,
        file_path,
        name: 'N/A',
        file_size: 0,
        params: 'N/A',
        quantization: '-1',
        architecture: 'N/A',
        model_type: modelType,
    })

    const setModelDataInternal = async (
        filename: string,
        file_path: string,
        deleteOnFailure: boolean,
        modelType: ModelDataType['model_type']
    ) => {
        let insertedId: number | null = null
        try {
            const insertedModels = await db
                .insert(model_data)
                .values(initialModelEntry(filename, file_path, modelType))
                .returning({ id: model_data.id })

            if (insertedModels.length === 0) {
                Logger.errorToast('Failed to insert initial model data into database.')
                if (deleteOnFailure) await deleteAsync(file_path, { idempotent: true })
                return false
            }

            insertedId = (insertedModels[0] as { id: number }).id

            const modelContext = await initLlama({ model: file_path, vocab_only: true })

            // Cast modelInfo.metadata to the new interface
            const modelInfoMetadata = modelContext.model.metadata as ModelMetadata

            const modelArchitecture = modelInfoMetadata['general.architecture']

            const modelDataEntry: Omit<ModelDataType, 'id' | 'create_date' | 'last_modified'> = {
                context_length:
                    (modelInfoMetadata[`${modelArchitecture}.context_length`] as number) ?? 0,
                file: filename,
                file_path,
                name: modelInfoMetadata['general.name'] ?? 'N/A',
                file_size: modelContext.model.size ?? 0, // modelInfo.size is directly accessible
                params: modelInfoMetadata['general.size_label'] ?? 'N/A',
                quantization: modelInfoMetadata['general.file_type'] ?? '-1',
                architecture: modelArchitecture ?? 'N/A',
                model_type: modelType,
            }

            Logger.info(`New Model Data:\n${modelDataText(modelDataEntry)}`)

            await modelContext.release()

            if (insertedId !== null) {
                await db.update(model_data).set(modelDataEntry).where(eq(model_data.id, insertedId))
            } else {
                Logger.errorToast('Internal error: Model ID not available for update.')
                return false
            }

            return true
        } catch (e: any) {
            Logger.errorToast(`Failed to create data: ${e.message || e}`)
            if (deleteOnFailure) {
                try {
                    await deleteAsync(file_path, { idempotent: true })
                } catch {
                    // Ignore deletion errors silently
                }
            }
            return false
        }
    }

    const modelDataText = (data: Omit<ModelDataType, 'id' | 'create_date' | 'last_modified'>) => {
        const quantValue = parseInt(data.quantization) as GGMLType
        const quantType = GGMLNameMap[quantValue]
        return `Context length: ${data.context_length ?? 'N/A'}\nFile: ${data.file}\nName: ${
            data.name ?? 'N/A'
        }\nSize: ${(data.file_size && readableFileSize(data.file_size)) ?? 'N/A'}\nParams: ${
            data.params ?? 'N/A'
        }\nQuantization: ${quantType ?? 'N/A'}\nArchitecture: ${data.architecture ?? 'N/A'}\nType: ${
            data.model_type ?? 'N/A'
        }`
    }

    const modelExists = async (modelName: string) => {
        return (await getModelList()).includes(modelName)
    }

    const deleteModel = async (name: string) => {
        if (!(await modelExists(name))) return
        return await deleteAsync(`${AppDirectory.ModelPath}${name}`)
    }
}

export namespace KV {
    export const useKVState = create<KVStateProps>()(
        persist(
            (set, get) => ({
                kvCacheLoaded: false,
                kvCacheTokens: [],
                setKvCacheLoaded: (b: boolean) => set((state) => ({ ...state, kvCacheLoaded: b })),
                setKvCacheTokens: (tokens: number[]) =>
                    set((state) => ({ ...state, kvCacheTokens: tokens })),
                verifyKVCache: (tokens: number[]) => {
                    const cachedTokens = get().kvCacheTokens
                    let matched = 0
                    const [a, b] =
                        cachedTokens.length <= tokens.length
                            ? [cachedTokens, tokens]
                            : [tokens, cachedTokens]
                    a.forEach((v, i) => {
                        if (v === b[i]) matched++
                    })
                    return {
                        match: matched === a.length,
                        cachedLength: cachedTokens.length,
                        inputLength: tokens.length,
                        matchLength: matched,
                    }
                },
            }),
            {
                name: Storage.KV,
                partialize: (state) => ({ kvCacheTokens: state.kvCacheTokens }),
                storage: createJSONStorage(() => mmkvStorage),
                version: 1,
            }
        )
    )

    export const sessionFile = `${AppDirectory.SessionPath}llama-session.bin`

    export const getKVSize = async () => {
        const data = await getInfoAsync(sessionFile)
        return data.exists ? data.size : 0
    }

    export const deleteKV = async () => {
        if ((await getInfoAsync(sessionFile)).exists) {
            await deleteAsync(sessionFile)
        }
    }

    export const kvInfo = async () => {
        const data = await getInfoAsync(sessionFile)
        if (!data.exists) {
            Logger.warn('No KV Cache found')
            return
        }
        Logger.info(`Size of KV cache: ${Math.floor(data.size * 0.000001)} MB`)
    }
}

type KvVerifyResult = {
    match: boolean
    matchLength: number
    inputLength: number
    cachedLength: number
}

type KVStateProps = {
    kvCacheLoaded: boolean
    kvCacheTokens: number[]
    setKvCacheLoaded: (b: boolean) => void
    setKvCacheTokens: (na: number[]) => void
    verifyKVCache: (na: number[]) => KvVerifyResult
}
