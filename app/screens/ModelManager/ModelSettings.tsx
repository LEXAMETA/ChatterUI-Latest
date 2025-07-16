// app/screens/ModelManager/ModelSettings.tsx

import ThemedButton from '@components/buttons/ThemedButton'
import PopupMenu from '@components/views/PopupMenu'
import * as LlamaModule from '@lib/engine/Local/LlamaLocal'
// Import GGMLNameMap and GGMLType from the GGML utility file
import { GGMLNameMap, GGMLType } from '@lib/engine/Local/GGML'
import { Theme } from '@lib/theme/ThemeManager'
import { ModelDataType } from 'db/schema'
import * as DocumentPicker from 'expo-document-picker'
// IMPORT FileSystem and getInfoAsync DIRECTLY from expo-file-system
import * as FileSystem from 'expo-file-system'
import { useEffect, useState } from 'react'
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    ActivityIndicator,
    Alert,
    Platform,
} from 'react-native'
import { Switch } from 'react-native-gesture-handler'

// IMPORT LlamaContext DIRECTLY from cui-llama.rn
import { LlamaContext } from 'cui-llama.rn'

// IMPORTANT: Verify these paths in your tsconfig.json/babel.config.js
import { AppSettings, useEngineData, EngineDataProps } from '@constants/GlobalValues' // IMPORT useEngineData and EngineDataProps directly
import { Logger } from '@state/Logger'
import { useMMKVBoolean } from '@storage/MMKV'
import { readableFileSize } from '@lib/utils/File' // IMPORT readableFileSize directly

import AntDesign from '@expo/vector-icons/AntDesign'

type ModelSettingsProps = {
    exit: () => void
    modelImporting: boolean
    modelLoading: boolean
    setModelLoading: (loading: boolean) => void
    models: ModelDataType[]
    embeddingModelId: number | null | undefined
    ragReasoningModelId: number | null | undefined
    setEmbeddingModelId: (id: number | null) => void
    setRagReasoningModelId: (id: number | null) => void
}

type FileEntry = {
    name: string
    uri: string
    size: number
}

const ModelSettings: React.FC<ModelSettingsProps> = ({
    exit,
    modelImporting,
    modelLoading,
    setModelLoading,
    models,
    embeddingModelId,
    ragReasoningModelId,
    setEmbeddingModelId,
    setRagReasoningModelId,
}) => {
    const styles = useStyles()
    const { color, spacing } = Theme.useTheme()

    const [availableLoRAs, setAvailableLoRAs] = useState<FileEntry[]>([])
    const [selectedEmbeddingLoRALocal, setSelectedEmbeddingLoRALocal] = useState<FileEntry | null>(
        null
    )
    const [selectedReasoningLoRALocal, setSelectedReasoningLoRALocal] = useState<FileEntry | null>(
        null
    )

    // Use useEngineData directly, no longer through LlamaModule
    const {
        selectedEmbeddingLoRAUri,
        selectedReasoningLoRAUri,
        setSelectedEmbeddingLoRAUri,
        setSelectedReasoningLoRAUri,
    } = useEngineData((state: EngineDataProps) => ({ // Use EngineDataProps directly
        selectedEmbeddingLoRAUri: state.selectedEmbeddingLoRAUri,
        selectedReasoningLoRAUri: state.selectedReasoningLoRAUri,
        setSelectedEmbeddingLoRAUri: state.setSelectedEmbeddingLoRAUri,
        setSelectedReasoningLoRAUri: state.setSelectedReasoningLoRAUri,
    }))

    const [saveLocalKV, setSaveLocalKV] = useMMKVBoolean(AppSettings.SaveLocalKV)
    const [autoLoadLocal, setAutoLoadLocal] = useMMKVBoolean(AppSettings.AutoLoadLocal)
    const [showModelInChat, setShowModelInChat] = useMMKVBoolean(AppSettings.ShowModelInChat)

    useEffect(() => {
        const loadLoRAs = async () => {
            const loraPath = `${LlamaModule.AppDirectory.LoRAPath}` // LlamaModule.AppDirectory is correct as AppDirectory is now exported from LlamaLocal.ts
            const info = await FileSystem.getInfoAsync(loraPath) // Use FileSystem directly
            if (!info.exists) {
                await FileSystem.makeDirectoryAsync(loraPath) // Use FileSystem directly
            }

            const files = await FileSystem.readDirectoryAsync(loraPath) // Use FileSystem directly
            const loraFiles: FileEntry[] = []
            for (const file of files) {
                const uri = `${loraPath}${file}`
                const fileInfo = await FileSystem.getInfoAsync(uri) // Use FileSystem directly
                if (fileInfo.exists && fileInfo.isDirectory === false) {
                    loraFiles.push({ name: file, uri: uri, size: fileInfo.size })
                }
            }
            setAvailableLoRAs(loraFiles)

            if (selectedEmbeddingLoRAUri) {
                const found = loraFiles.find((l) => l.uri === selectedEmbeddingLoRAUri)
                setSelectedEmbeddingLoRALocal(found ?? null)
            } else {
                setSelectedEmbeddingLoRALocal(null)
            }
            if (selectedReasoningLoRAUri) {
                const found = loraFiles.find((l) => l.uri === selectedReasoningLoRAUri)
                setSelectedReasoningLoRALocal(found ?? null)
            } else {
                setSelectedReasoningLoCAL(null)
            }
        }
        loadLoRAs()
    }, [selectedEmbeddingLoRAUri, selectedReasoningLoRAUri])

    const handlePickAndCopyFile = async (type: 'lora') => {
        if (modelImporting || modelLoading) return

        const result = await DocumentPicker.getDocumentAsync({
            copyToCacheDirectory: false,
        })

        if (result.canceled || !result.assets || result.assets.length === 0) {
            return
        }

        const file = result.assets[0] // TypeScript now knows 'file' is DocumentPickerAsset

        const targetPath = `${LlamaModule.AppDirectory.LoRAPath}${file.name}`

        Logger.infoToast(`Copying ${type} file...`)
        try {
            await FileSystem.copyAsync({ // Use FileSystem directly
                from: file.uri,
                to: targetPath,
            })
            const fileInfo = await FileSystem.getInfoAsync(targetPath) // Use FileSystem directly
            if (fileInfo.exists) {
                const newLoRAEntry: FileEntry = {
                    name: file.name,
                    uri: targetPath,
                    size: fileInfo.size,
                }
                setAvailableLoRAs((prev) => [...prev, newLoRAEntry])
                Logger.infoToast(`${type} file copied successfully!`)
            }
        } catch (error: any) {
            Logger.errorToast(`Failed to copy ${type} file: ${error.message}`)
            console.error(`Error copying ${type} file:`, error)
        }
    }

    const handleSelectFile = (type: 'embedding' | 'reasoning', file: FileEntry | null) => {
        if (type === 'embedding') {
            setSelectedEmbeddingLoRALocal(file)
            setSelectedEmbeddingLoRAUri(file ? file.uri : null)
        } else {
            setSelectedReasoningLoRALocal(file)
            setSelectedReasoningLoRAUri(file ? file.uri : null)
        }
    }

    const handleLoadContext = async (contextType: 'embedding' | 'reasoning') => {
        if (modelLoading || modelImporting) return

        let modelIdToLoad: number | null | undefined
        let loraUriToLoad: string | null
        let setModelIdFunc: (id: number | null) => void
        // LlamaContext is now imported directly
        let getLlamaContextFunc: (loraPath: string | null) => Promise<LlamaContext | null>
        let modelTypeName: ModelDataType['model_type']

        if (contextType === 'embedding') {
            modelIdToLoad = embeddingModelId
            loraUriToLoad = selectedEmbeddingLoRALocal?.uri ?? null
            setModelIdFunc = setEmbeddingModelId
            // Use the directly exported function
            getLlamaContextFunc = LlamaModule.getEmbeddingLlamaContext
            modelTypeName = 'rag_embedding'
        } else {
            modelIdToLoad = ragReasoningModelId
            loraUriToLoad = selectedReasoningLoCAL?.uri ?? null
            setModelIdFunc = setRagReasoningModelId
            // Use the directly exported function
            getLlamaContextFunc = LlamaModule.getRagReasoningLlamaContext
            modelTypeName = 'rag_reasoning'
        }

        if (!modelIdToLoad) {
            Alert.alert(
                'No Base Model Selected',
                `Please select a ${modelTypeName} base model first.`
            )
            return
        }

        const baseModel = models.find((m) => m.id === modelIdToLoad)
        if (!baseModel) {
            Alert.alert(
                'Model Not Found',
                `Selected base model (ID: ${modelIdToLoad}) not found in database. Please re-select.`
            )
            setModelIdFunc(null)
            return
        }

        if (baseModel.model_type !== modelTypeName) {
            Alert.alert(
                'Incorrect Model Type',
                `The selected model "${baseModel.name}" is of type "${baseModel.model_type}", but a "${modelTypeName}" model is required here. Please select a correct model type.`
            )
            return
        }

        setModelLoading(true)
        try {
            const context = await getLlamaContextFunc(loraUriToLoad)
            if (context) {
                Logger.infoToast(
                    `${baseModel.name} (${modelTypeName}) loaded with ${loraUriToLoad ? 'LoRA' : 'no LoRA'}.`
                )
            } else {
                Logger.errorToast(`Failed to load ${modelTypeName} model.`)
            }
        } catch (error: any) {
            Logger.errorToast(`Error loading ${modelTypeName} model: ${error.message}`)
            console.error(`Error loading ${modelTypeName} model:`, error)
        } finally {
            setModelLoading(false)
        }
    }

    const handleUnloadContext = async (contextType: 'embedding' | 'reasoning') => {
        if (modelLoading || modelImporting) return

        setModelLoading(true)
        try {
            if (contextType === 'embedding') {
                // Use the directly exported function
                await LlamaModule.unloadEmbeddingLlamaContext()
            } else {
                // Use the directly exported function
                await LlamaModule.unloadRagReasoningLlamaContext()
            }
            Logger.infoToast(`${contextType} model unloaded.`)
        } catch (error: any) {
            Logger.errorToast(`Failed to unload ${contextType} model: ${error.message}`)
        } finally {
            setModelLoading(false)
        }
    }

    const renderModelPicker = (
        currentModelId: number | null | undefined,
        contextType: ModelDataType['model_type'],
        title: string,
        onSelectId: (id: number | null) => void,
        loadedContextModel: ModelDataType | null | undefined
    ) => {
        const filteredModels = models.filter((m) => m.model_type === contextType)
        const selectedModel = filteredModels.find((m) => m.id === currentModelId)
        const isModelLoaded = loadedContextModel?.id === currentModelId

        const disabled = modelLoading || modelImporting

        type AntDesignIconNames = keyof typeof AntDesign.glyphMap

        return (
            <View style={styles.sectionContainer}>
                <Text style={styles.sectionTitle}>{title} Base Model</Text>
                <PopupMenu
                    placement="top"
                    icon="caretdown" // Removed `as AntDesignIconNames` after prop name
                    disabled={disabled}
                    options={
                        filteredModels.length > 0
                            ? filteredModels.map((model) => ({
                                  label: model.name,
                                  onPress: () => onSelectId(model.id),
                                  icon: 'database' as AntDesignIconNames,
                              }))
                            : [{ label: 'No models of this type available', onPress: () => {}, icon: 'exclamationcircleo' as AntDesignIconNames }]
                    }>
                    <View style={styles.selectionDisplay}>
                        <Text style={styles.selectionText}>
                            {selectedModel ? selectedModel.name : 'Select a model'}
                        </Text>
                        {selectedModel && isModelLoaded && (
                            <Text style={styles.loadedStatus}> (Active)</Text>
                        )}
                        {disabled && (
                            <ActivityIndicator
                                size="small"
                                color={color.text._300}
                                style={{ marginLeft: spacing.s }}
                            />
                        )}
                    </View>
                </PopupMenu>
                {selectedModel && (
                    <Text style={styles.selectedModelInfo}>
                        Type: {selectedModel.model_type} | Quant:{' '}
                        {/* Correctly type index for GGMLNameMap */}
                        {GGMLNameMap[parseInt(selectedModel.quantization) as GGMLType]}{' '}
                        | Size: {readableFileSize(selectedModel.file_size)} {/* Use directly imported readableFileSize */}
                    </Text>
                )}
            </View>
        )
    }

    const renderLoRAPicker = (
        selectedFile: FileEntry | null,
        title: string,
        onSelect: (file: FileEntry | null) => void
    ) => {
        const disabled = modelLoading || modelImporting;
        type AntDesignIconNames = keyof typeof AntDesign.glyphMap;

        return (
            <View style={styles.sectionContainer}>
                <Text style={styles.sectionTitle}>{title} LoRA Adapter</Text>
                <PopupMenu
                    placement="top"
                    icon="caretdown" // Removed `as AntDesignIconNames` after prop name
                    disabled={disabled}
                    options={[
                        ...(availableLoRAs.length > 0
                            ? availableLoRAs.map((file) => ({
                                  label: file.name,
                                  onPress: () => onSelect(file),
                                  icon: 'file1' as AntDesignIconNames,
                              }))
                            : []),
                        {
                            label: '--- Clear LoRA ---',
                            onPress: () => onSelect(null),
                            icon: 'close' as AntDesignIconNames,
                        },
                        {
                            label: 'Import New LoRA File',
                            onPress: () => handlePickAndCopyFile('lora'),
                            icon: 'pluscircleo' as AntDesignIconNames,
                        },
                    ]}>
                    <View style={styles.selectionDisplay}>
                        <Text style={styles.selectionText}>
                            {selectedFile ? selectedFile.name : 'No LoRA selected'}
                        </Text>
                        {disabled && (
                            <ActivityIndicator
                                size="small"
                                color={color.text._300}
                                style={{ marginLeft: spacing.s }}
                            />
                        )}
                    </View>
                </PopupMenu>
                {selectedFile && (
                    <Text style={styles.selectedModelInfo}>
                        Size: {readableFileSize(selectedFile.size)} {/* Use directly imported readableFileSize */}
                    </Text>
                )}
            </View>
        )
    }

    // Get currently loaded RAG models from LlamaModule.useLlama.getState()
    const { loadedEmbeddingModelInContext: currentEmbeddingContextModel, loadedRagReasoningModelInContext: currentReasoningContextModel } = LlamaModule.useLlama.getState();


    return (
        <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
            <Text style={styles.heading}>RAG Model Configuration</Text>
            {renderModelPicker(
                embeddingModelId,
                'rag_embedding',
                'RAG Embedding',
                setEmbeddingModelId,
                currentEmbeddingContextModel
            )}
            {renderLoRAPicker(selectedEmbeddingLoRALocal, 'RAG Embedding', (file) =>
                handleSelectFile('embedding', file)
            )}
            <View style={styles.buttonRow}>
                <ThemedButton
                    label={
                        modelLoading &&
                        currentEmbeddingContextModel?.id === embeddingModelId
                            ? 'Loading...'
                            : 'Load Embedding Context'
                    }
                    onPress={() => handleLoadContext('embedding')}
                    disabled={!embeddingModelId || modelLoading || modelImporting}
                    showActivityIndicator={
                        modelLoading &&
                        currentEmbeddingContextModel?.id === embeddingModelId
                    }
                    size="small"
                />
                <ThemedButton
                    label={
                        modelLoading && !embeddingModelId
                            ? 'Unloading...'
                            : 'Unload Embedding Context'
                    }
                    onPress={() => handleUnloadContext('embedding')}
                    disabled={!currentEmbeddingContextModel || modelLoading || modelImporting}
                    size="small"
                />
            </View>
            {renderModelPicker(
                ragReasoningModelId,
                'rag_reasoning',
                'RAG Reasoning (LLM)',
                setRagReasoningModelId,
                currentReasoningContextModel
            )}
            {renderLoRAPicker(selectedReasoningLoRALocal, 'RAG Reasoning (LLM)', (file) =>
                handleSelectFile('reasoning', file)
            )}
            <View style={styles.buttonRow}>
                <ThemedButton
                    label={
                        modelLoading &&
                        currentReasoningContextModel?.id === ragReasoningModelId
                            ? 'Loading...'
                            : 'Load Reasoning Context'
                    }
                    onPress={() => handleLoadContext('reasoning')}
                    disabled={!ragReasoningModelId || modelLoading || modelImporting}
                    showActivityIndicator={
                        modelLoading &&
                        currentReasoningContextModel?.id === ragReasoningModelId
                    }
                    size="small"
                />
                <ThemedButton
                    label={
                        modelLoading && !ragReasoningModelId
                            ? 'Unloading...'
                            : 'Unload Reasoning Context'
                    }
                    onPress={() => handleUnloadContext('reasoning')}
                    disabled={!currentReasoningContextModel || modelLoading || modelImporting}
                    size="small"
                />
            </View>
            <View style={styles.divider} />
            <Text style={styles.heading}>App Settings</Text>
            <View style={styles.settingItem}>
                <Text style={styles.settingLabel}>Save KV Cache Locally</Text>
                <Switch value={saveLocalKV} onValueChange={setSaveLocalKV} />
            </View>
            <View style={styles.settingItem}>
                <Text style={styles.settingLabel}>Auto-Load Main Chat Model on Startup</Text>
                <Switch value={autoLoadLocal} onValueChange={setAutoLoadLocal} />
            </View>
            <View style={styles.settingItem}>
                <Text style={styles.settingLabel}>Show Model Info in Chat</Text>
                <Switch value={showModelInChat} onValueChange={setShowModelInChat} />
            </View>
            <View style={{ height: spacing.xl3 }} />
        </ScrollView>
    )
}

export default ModelSettings

const useStyles = () => {
    const { color, spacing, borderRadius, fontSize } = Theme.useTheme()

    return StyleSheet.create({
        container: {
            flex: 1,
            paddingVertical: spacing.l,
            paddingHorizontal: spacing.xl,
        },
        heading: {
            fontSize: fontSize.xl,
            fontWeight: 'bold',
            color: color.text._100,
            marginBottom: spacing.l,
            textAlign: 'center',
        },
        sectionContainer: {
            backgroundColor: color.neutral._200,
            borderRadius: borderRadius.l,
            padding: spacing.l,
            marginBottom: spacing.l,
        },
        sectionTitle: {
            fontSize: fontSize.m,
            fontWeight: 'bold',
            color: color.text._100,
            marginBottom: spacing.s,
        },
        selectionDisplay: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: color.neutral._300,
            borderRadius: borderRadius.m,
            paddingVertical: spacing.s,
            paddingHorizontal: spacing.m,
            minHeight: 40,
        },
        selectionText: {
            flex: 1,
            color: color.text._100,
            fontSize: fontSize.m,
        },
        selectedModelInfo: {
            fontSize: fontSize.s,
            color: color.text._400,
            marginTop: spacing.s,
            marginLeft: spacing.xs,
        },
        loadedStatus: {
            fontSize: fontSize.m,
            fontWeight: 'bold',
            color: color.primary._500,
            marginLeft: spacing.s,
        },
        buttonRow: {
            flexDirection: 'row',
            justifyContent: 'space-around',
            marginBottom: spacing.l,
            marginTop: spacing.s,
        },
        settingItem: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: color.neutral._200,
            borderRadius: borderRadius.l,
            padding: spacing.l,
            marginBottom: spacing.m,
        },
        settingLabel: {
            fontSize: fontSize.m,
            color: color.text._100,
            flex: 1,
        },
        divider: {
            height: 1,
            backgroundColor: color.neutral._300,
            marginVertical: spacing.xl,
        },
    })
}
