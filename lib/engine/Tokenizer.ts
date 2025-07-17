import { useAppModeState } from '@lib/state/AppMode'
import { Logger } from '@lib/state/Logger'
import { initLlama, LlamaContext } from 'cui-llama.rn'
import { Asset } from 'expo-asset'
import {
    copyAsync,
    deleteAsync,
    documentDirectory,
    getInfoAsync,
    makeDirectoryAsync,
} from 'expo-file-system'
import { create } from 'zustand'

// FIX: Import useLlama as its named export
import { useLlama, LlamaState } from './Local/LlamaLocal' // <--- Changed this line

type TokenizerState = {
    model?: LlamaContext
    tokenize: (text: string) => number[]
    getTokenCount: (text: string) => number
    loadModel: () => Promise<void>
}

export namespace Tokenizer {
    export const useDefaultTokenizer = create<TokenizerState>()((set, get) => ({
        model: undefined,
        tokenize: (text: string) => {
            return get()?.model?.tokenizeSync(text)?.tokens ?? []
        },
        getTokenCount: (text: string) => {
            const tokens = get()?.model?.tokenizeSync(text)?.tokens?.length ?? 0
            return tokens
        },
        loadModel: async () => {
            if (get().model) return

            await importModelFromRes()

            const context = await initLlama({
                model: documentDirectory + 'appAssets/llama3tokenizer.gguf',
                vocab_only: true,
                use_mlock: true,
            })
            set((state) => ({ ...state, model: context }))
        },
    }))

    const importModelFromRes = async () => {
        const folderDir = `${documentDirectory}appAssets/`
        const folderExists = (await getInfoAsync(folderDir)).exists
        if (!folderExists) await makeDirectoryAsync(`${documentDirectory}appAssets`)
        const modelDir = `${folderDir}llama3tokenizer.gguf`
        const modelExists = (await getInfoAsync(modelDir)).exists
        if (modelExists) return
        Logger.info('Importing Tokenizer')
        const [asset] = await Asset.loadAsync(require('./../../assets/models/llama3tokenizer.gguf'))

        // FIX: Add check for asset being defined
        if (asset) {
            await asset.downloadAsync()
            if (asset.localUri) {
                await copyAsync({ from: asset.localUri, to: modelDir })
            }
        } else {
            Logger.error('Failed to load tokenizer asset.')
            // You might want to throw an error or handle this more gracefully
        }
    }

    export const debugDeleteModel = async () => {
        await deleteAsync(documentDirectory + 'appAssets')
    }

    export const getTokenizer = () => {
        return useAppModeState.getState().appMode === 'local'
            ? useLlama.getState().tokenLength // FIX: Use useLlama directly
            : Tokenizer.useDefaultTokenizer.getState().getTokenCount
    }

    export const useTokenizer = () => {
        const defaultTokenizer = useDefaultTokenizer((state) => state.getTokenCount)
        // FIX: Provide type for state and use useLlama directly
        const llamaTokenizer = useLlama((state: LlamaState) => state.tokenLength) // <--- Changed this line
        const appMode = useAppModeState((state) => state.appMode)
        return appMode === 'local' ? llamaTokenizer : defaultTokenizer
    }
}

Tokenizer.useDefaultTokenizer.getState().loadModel()
