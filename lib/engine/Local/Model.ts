import { db } from '@db'
import { Storage } from '@lib/enums/Storage'
import { Logger } from '@lib/state/Logger'
import { mmkvStorage } from '@lib/storage/MMKV'
import { AppDirectory, readableFileSize } from '@lib/utils/File'
import { initLlama } from 'cui-llama.rn'
import { model_data, ModelDataType } from 'db/schema' // Ensure ModelDataType is imported
import { eq } from 'drizzle-orm'
import { getDocumentAsync } from 'expo-document-picker'
import { copyAsync, deleteAsync, getInfoAsync, readDirectoryAsync } from 'expo-file-system'
import { Platform } from 'react-native'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { GGMLNameMap, GGMLType } from './GGML'

// Make sure ModelDataType is correctly imported from db/schema.ts
// It should now include the 'model_type' field.
export type ModelData = Omit<ModelDataType, 'id' | 'create_date' | 'last_modified' | 'model_type'>; // Exclude model_type for initial data creation if needed, but it will be added during insertion.

export namespace Model {
    export const getModelList = async () => {
        return await readDirectoryAsync(AppDirectory.ModelPath)
    }

    export const deleteModelById = async (id: number) => {
        const modelInfo = await db.query.model_data.findFirst({ where: eq(model_data.id, id) })
        if (!modelInfo) return
        // some models may be external
        if (modelInfo.file_path.startsWith(AppDirectory.ModelPath))
            await deleteModel(modelInfo.file)
        await db.delete(model_data).where(eq(model_data.id, id))
    }

    // Modified to accept modelType
    export const importModel = async (modelType: ModelDataType['model_type'] = 'main_chat') => {
        return getDocumentAsync({
            copyToCacheDirectory: false,
        }).then(async (result) => {
            if (result.canceled) return
            const file = result.assets[0]
            const name = file.name
            const newdir = `${AppDirectory.ModelPath}${name}`
            Logger.infoToast('Importing file...')
            const success = await copyAsync({
                from: file.uri,
                to: newdir,
            })
                .then(() => {
                    return true
                })
                .catch((error) => {
                    Logger.errorToast(`Import Failed: ${error.message}`)
                    return false
                })
            if (!success) return

            // database routine here, passing modelType
            if (await createModelData(name, true, modelType)) Logger.infoToast(`Model Imported Sucessfully!`)
        })
    }

    // Modified to accept modelType
    export const linkModelExternal = async (modelType: ModelDataType['model_type'] = 'main_chat') => {
        return getDocumentAsync({
            copyToCacheDirectory: false,
        }).then(async (result) => {
            if (result.canceled) return
            const file = result.assets[0]
            Logger.infoToast('Linking external file...') // Changed toast message
            if (!file) {
                Logger.errorToast('File Invalid')
                return
            }

            // database routine here, passing modelType
            if (await createModelDataExternal(file.uri, file.name, true, modelType)) // Pass modelType
                Logger.infoToast(`Model Linked Sucessfully!`) // Changed toast message
        })
    }

    export const verifyModelList = async () => {
        let modelList = await db.query.model_data.findMany()
        const fileList = await getModelList()

        // cull missing models
        if (Platform.OS === 'android')
            // cull not required on iOS
            modelList.forEach(async (item) => {
                if (item.name === '' || !(await getInfoAsync(item.file_path)).exists) {
                    Logger.warnToast(`Model Missing, its entry will be deleted: ${item.name}`)
                    await db.delete(model_data).where(eq(model_data.id, item.id))
                }
            })

        // refresh as some may have been deleted
        modelList = await db.query.model_data.findMany()

        // create data as migration step
        fileList.forEach(async (item) => {
            if (modelList.some((model_data) => model_data.file === item)) return
            // When creating data for existing files, default to 'main_chat' type
            await createModelData(`${item}`, false, 'main_chat')
        })
    }

    // Modified to accept modelType
    export const createModelData = async (
        filename: string,
        deleteOnFailure: boolean = false,
        modelType: ModelDataType['model_type'] = 'main_chat' // Added modelType parameter
    ) => {
        return setModelDataInternal(
            filename,
            `${AppDirectory.ModelPath}${filename}`,
            deleteOnFailure,
            modelType // Pass modelType
        )
    }

    // Modified to accept modelType
    export const createModelDataExternal = async (
        newdir: string,
        filename: string,
        deleteOnFailure: boolean = false,
        modelType: ModelDataType['model_type'] = 'main_chat' // Added modelType parameter
    ) => {
        if (!filename) {
            Logger.errorToast('Filename invalid, Import Failed')
            return
        }
        return setModelDataInternal(filename, newdir, deleteOnFailure, modelType) // Pass modelType
    }

    export const getModelListQuery = () => {
        return db.query.model_data.findMany()
    }

    export const updateName = async (name: string, id: number) => {
        await db.update(model_data).set({ name: name }).where(eq(model_data.id, id))
    }

    export const isInitialEntry = (data: ModelData) => {
        // NOTE: This function's `ModelData` type should likely be `ModelDataType` now
        // to properly account for `model_type` if you intend to check it here.
        // For now, keeping as is, but be mindful of its usage.
        const initial: ModelData = {
            file: '',
            file_path: '',
            context_length: 0,
            name: 'N/A',
            file_size: 0,
            params: 'N/A',
            quantization: '-1',
            architecture: 'N/A',
            // If you want to include model_type in this check, add it here and update ModelData type
            // model_type: 'main_chat',
        }

        for (const key in initial) {
            if (key === 'file' || key === 'file_path') continue
            const initialV = initial[key as keyof ModelData]
            const dataV = data[key as keyof ModelData]
            if (initialV !== dataV) return false
        }
        return true
    }

    // Modified to accept modelType
    const initialModelEntry = (filename: string, file_path: string, modelType: ModelDataType['model_type']) => ({
        context_length: 0,
        file: filename,
        file_path: file_path,
        name: 'N/A',
        file_size: 0,
        params: 'N/A',
        quantization: '-1',
        architecture: 'N/A',
        model_type: modelType, // Set the model type here
    })

    const setModelDataInternal = async (
        filename: string,
        file_path: string,
        deleteOnFailure: boolean,
        modelType: ModelDataType['model_type'] // Added modelType parameter
    ) => {
        try {
            const [{ id }, ...rest] = await db
                .insert(model_data)
                .values(initialModelEntry(filename, file_path, modelType)) // Pass modelType here
                .returning({ id: model_data.id })

            const modelContext = await initLlama({ model: file_path, vocab_only: true })

            const modelInfo: any = modelContext.model
            const modelArchitecture = modelInfo.metadata?.['general.architecture'] // Changed variable name for clarity
            const modelDataEntry = {
                context_length: modelInfo.metadata?.[modelArchitecture + '.context_length'] ?? 0, // Use modelArchitecture
                file: filename,
                file_path: file_path,
                name: modelInfo.metadata?.['general.name'] ?? 'N/A',
                file_size: modelInfo.size ?? 0,
                params: modelInfo.metadata?.['general.size_label'] ?? 'N/A',
                quantization: modelInfo.metadata?.['general.file_type'] ?? '-1',
                architecture: modelArchitecture ?? 'N/A', // Use modelArchitecture
                model_type: modelType, // Ensure model_type is explicitly set here after initial insert
            }
            Logger.info(`New Model Data:\n${modelDataText(modelDataEntry)}`)
            await modelContext.release()
            await db.update(model_data).set(modelDataEntry).where(eq(model_data.id, id))
            return true
        } catch (e) {
            Logger.errorToast(`Failed to create data: ${e}`)
            if (deleteOnFailure) deleteAsync(file_path, { idempotent: true })
            return false
        }
    }

    const modelDataText = (data: ModelData) => { // NOTE: This type should ideally be ModelDataType now
        const quantValue = parseInt(data.quantization) as GGMLType
        const quantType = GGMLNameMap[quantValue]
        // Added model_type to the info text
        return `Context length: ${data.context_length ?? 'N/A'}\nFile: ${data.file}\nName: ${data.name ?? 'N/A'}\nSize: ${(data.file_size && readableFileSize(data.file_size)) ?? 'N/A'}\nParams: ${data.params ?? 'N/A'}\nQuantization: ${quantType ?? 'N/A'}\nArchitecture: ${data.architecture ?? 'N/A'}\nType: ${data.model_type ?? 'N/A'}`; // Added model_type here
    }

    const modelExists = async (modelName: string) => {
        return (await getModelList()).includes(modelName)
    }

    const deleteModel = async (name: string) => {
        if (!(await modelExists(name))) return
        return await deleteAsync(`${AppDirectory.ModelPath}${name}`)
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

export namespace KV {
    export const useKVState = create<KVStateProps>()(
        persist(
            (set, get) => ({
                kvCacheLoaded: false,
                kvCacheTokens: [],
                setKvCacheLoaded: (b: boolean) => {
                    set((state) => ({ ...state, kvCacheLoaded: b }))
                },
                setKvCacheTokens: (tokens: number[]) => {
                    set((state) => ({ ...state, kvCacheTokens: tokens }))
                },
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
                partialize: (state) => ({
                    kvCacheTokens: state.kvCacheTokens,
                }),
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
