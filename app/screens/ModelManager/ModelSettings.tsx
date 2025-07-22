// app/screens/ModelManager/ModelSettings.tsx

import ThemedButton from '@components/buttons/ThemedButton'
import PopupMenu from '@components/views/PopupMenu'
import AntDesign from '@expo/vector-icons/AntDesign'
import { AppSettings } from '@lib/constants/GlobalValues'
import * as LlamaModule from '@lib/engine/Local/LlamaLocal'
import { LlamaContext } from '@lib/engine/Local/LlamaLocal'
import { reportModelError } from '@lib/engine/utils/LoggerUtils'
import { useEngineData, EngineDataState } from '@lib/state/EngineData'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'
import { readableFileSize } from '@lib/utils/File'
import { useMMKVBoolean } from '@storage/MMKV'
import { ModelDataType } from 'db/schema'
import DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import React, { useEffect, useState, useReducer, Dispatch, SetStateAction } from 'react'
import { ScrollView, StyleSheet, Text, View, ActivityIndicator, Alert } from 'react-native'
import { Switch } from 'react-native-gesture-handler'

// Enums for context types
enum ContextType {
    Embedding = 'embedding',
    Reasoning = 'reasoning',
}

// Icon mappings for popup menu options
const PopupIcons = {
    database: 'database' as const,
    exclamationcircleo: 'exclamationcircleo' as const,
    file1: 'file1' as const,
    close: 'close' as const,
    pluscircleo: 'pluscircleo' as const,
}

// File entry type
type FileEntry = {
    name: string
    uri: string
    size: number
}

// Props interface with updated map setters
export interface ModelSettingsProps {
    modelImporting: boolean
    setModelImporting: Dispatch<SetStateAction<boolean>>
    modelLoading: boolean
    setModelLoading: Dispatch<SetStateAction<boolean>>
    exit: () => void
    models: ModelDataType[] // Passed from ModelManager/index.tsx
    embeddingModelId: number | null
    ragReasoningModelId: number | null
    setEmbeddingModelId: (id: number | null) => void
    setRagReasoningModelId: (id: number | null) => void
}

// State shape for LoRA file selections
type LoRAState = {
    availableLoRAs: FileEntry[]
    selectedEmbeddingLoRA: FileEntry | null
    selectedReasoningLoRA: FileEntry | null
}

type LoRAAction =
    | { type: 'SET_AVAILABLE'; payload: FileEntry[] }
    | { type: 'SELECT_EMBEDDING'; payload: FileEntry | null }
    | { type: 'SELECT_REASONING'; payload: FileEntry | null }

const loraReducer = (state: LoRAState, action: LoRAAction): LoRAState => {
    switch (action.type) {
        case 'SET_AVAILABLE':
            return { ...state, availableLoRAs: action.payload }
        case 'SELECT_EMBEDDING':
            return { ...state, selectedEmbeddingLoRA: action.payload }
        case 'SELECT_REASONING':
            return { ...state, selectedReasoningLoRA: action.payload }
        default:
            return state
    }
}

// Utility hook for loading LoRA files
const useLoRAFiles = (
    selectedEmbeddingUri: string | null | undefined,
    selectedReasoningUri: string | null | undefined
) => {
    const [state, dispatch] = useReducer(loraReducer, {
        availableLoRAs: [],
        selectedEmbeddingLoRA: null,
        selectedReasoningLoRA: null,
    })

    useEffect(() => {
        let isActive = true
        const loadLoRAs = async () => {
            try {
                const loraPath = `${LlamaModule.AppDirectory.LoRAPath}`
                const info = await FileSystem.getInfoAsync(loraPath)
                if (!info.exists) {
                    await FileSystem.makeDirectoryAsync(loraPath)
                }

                const files = await FileSystem.readDirectoryAsync(loraPath)
                const loraFiles: FileEntry[] = []

                for (const file of files) {
                    const uri = `${loraPath}${file}`
                    const fileInfo = await FileSystem.getInfoAsync(uri)
                    if (fileInfo.exists && !fileInfo.isDirectory) {
                        loraFiles.push({ name: file, uri, size: fileInfo.size })
                    }
                }

                if (!isActive) return

                dispatch({ type: 'SET_AVAILABLE', payload: loraFiles })

                const embeddingFile = loraFiles.find((f) => f.uri === selectedEmbeddingUri) ?? null
                dispatch({ type: 'SELECT_EMBEDDING', payload: embeddingFile })

                const reasoningFile = loraFiles.find((f) => f.uri === selectedReasoningUri) ?? null
                dispatch({ type: 'SELECT_REASONING', payload: reasoningFile })
            } catch (error) {
                reportModelError(
                    'LoRA Files',
                    `Error loading LoRA files: ${(error as Error).message}`
                )
            }
        }
        loadLoRAs()
        return () => {
            isActive = false
        }
    }, [selectedEmbeddingUri, selectedReasoningUri])

    return [state, dispatch] as const
}

/** Subcomponent: ModelPicker */
interface ModelPickerProps {
    currentModelId: number | null | undefined
    contextType: ModelDataType['model_type']
    title: string
    onSelectId: (id: number | null) => void
    loadedContextModel: ModelDataType | null | undefined
    disabled: boolean
    models: ModelDataType[]
}

const ModelPicker: React.FC<ModelPickerProps> = ({
    currentModelId,
    contextType,
    title,
    onSelectId,
    loadedContextModel,
    disabled,
    models,
}) => {
    const styles = useStyles()
    const { color, spacing } = Theme.useTheme()
    const filteredModels = React.useMemo(() => {
        return models.filter(
            (model) => model.model_type === contextType && model.id !== currentModelId
        )
    }, [models, contextType, currentModelId])

    return (
        <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>{title} Base Model</Text>
            <PopupMenu
                placement="top"
                icon={PopupIcons.database}
                disabled={disabled}
                options={
                    filteredModels.length > 0
                        ? filteredModels.map((model) => ({
                              label: model.name,
                              onPress: () => onSelectId(model.id),
                              icon: PopupIcons.database,
                          }))
                        : [
                              {
                                  label: 'No models of this type available',
                                  onPress: () => {},
                                  icon: PopupIcons.exclamationcircleo,
                              },
                          ]
                }>
                <View style={styles.selectionDisplay}>
                    <Text style={styles.selectionText}>
                        {models.find((m) => m.id === currentModelId)?.name || 'Select a model'}
                    </Text>
                    {loadedContextModel?.id === currentModelId && (
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
        </View>
    )
}

/** Subcomponent: LoRAPicker */
interface LoRAPickerProps {
    selectedFile: FileEntry | null
    title: string
    onSelect: (file: FileEntry | null) => void
    availableLoRAs: FileEntry[]
    onImportFile: () => Promise<void>
    disabled: boolean
}

const LoRAPicker: React.FC<LoRAPickerProps> = ({
    selectedFile,
    title,
    onSelect,
    availableLoRAs,
    onImportFile,
    disabled,
}) => {
    const styles = useStyles()
    const { color, spacing } = Theme.useTheme()

    return (
        <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>{title} LoRA Adapter</Text>
            <PopupMenu
                placement="top"
                icon={PopupIcons.file1}
                disabled={disabled}
                options={[
                    ...availableLoRAs.map((file) => ({
                        label: file.name,
                        onPress: () => onSelect(file),
                        icon: PopupIcons.file1,
                    })),
                    {
                        label: '--- Clear LoRA ---',
                        onPress: () => onSelect(null),
                        icon: PopupIcons.close,
                    },
                    {
                        label: 'Import New LoRA File',
                        onPress: onImportFile,
                        icon: PopupIcons.pluscircleo,
                    },
                ]}>
                <View style={styles.selectionDisplay}>
                    <Text style={styles.selectionText}>
                        {selectedFile?.name || 'No LoRA selected'}
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
                <Text style={styles.selectedModelInfo}>{readableFileSize(selectedFile.size)}</Text>
            )}
        </View>
    )
}

const ModelSettings: React.FC<ModelSettingsProps> = ({
    exit,
    modelImporting,
    modelLoading,
    setModelImporting,
    setModelLoading,
    models,
    embeddingModelId,
    ragReasoningModelId,
    setEmbeddingModelId,
    setRagReasoningModelId,
}) => {
    const styles = useStyles()
    const { color, spacing } = Theme.useTheme()

    const {
        selectedEmbeddingLoRAUri,
        selectedReasoningLoRAUri,
        setSelectedEmbeddingLoRAUri,
        setSelectedReasoningLoRAUri,
    } = useEngineData((state: EngineDataState) => ({
        selectedEmbeddingLoRAUri: state.selectedEmbeddingLoRAUri,
        selectedReasoningLoRAUri: state.selectedReasoningLoRAUri,
        setSelectedEmbeddingLoRAUri: state.setSelectedEmbeddingLoRAUri,
        setSelectedReasoningLoRAUri: state.setSelectedReasoningLoRAUri,
    }))

    const [{ availableLoRAs, selectedEmbeddingLoRA, selectedReasoningLoRA }, dispatch] =
        useLoRAFiles(selectedEmbeddingLoRAUri, selectedReasoningLoRAUri)

    const [saveLocalKV, setSaveLocalKV] = useMMKVBoolean(AppSettings.SaveLocalKV)
    const [autoLoadLocal, setAutoLoadLocal] = useMMKVBoolean(AppSettings.AutoLoadLocal)
    const [showModelInChat, setShowModelInChat] = useMMKVBoolean(AppSettings.ShowModelInChat)

    const handlePickAndCopyFile = async () => {
        if (modelImporting || modelLoading) return
        try {
            setModelImporting(true)
            const result = await DocumentPicker.getDocumentAsync({
                copyToCacheDirectory: false,
            })
            if (result.canceled) {
                setModelImporting(false)
                return
            }
            const file = result.assets?.[0]
            if (!file?.uri || !file?.name) {
                reportModelError('LoRA Import', 'No valid file selected')
                setModelImporting(false)
                return
            }
            const targetPath = `${LlamaModule.AppDirectory.LoRAPath}${file.name}`
            Logger.infoToast(`Copying lora file...`)
            await FileSystem.copyAsync({ from: file.uri, to: targetPath })
            const fileInfo = await FileSystem.getInfoAsync(targetPath)
            if (fileInfo.exists) {
                const newFile: FileEntry = { name: file.name, uri: targetPath, size: fileInfo.size }
                dispatch({ type: 'SET_AVAILABLE', payload: [...availableLoRAs, newFile] })
                Logger.infoToast('LoRA file copied successfully!')
            }
        } catch (error: any) {
            reportModelError('LoRA Import', `Failed to copy LoRA file: ${error.message}`)
            console.error('Error copying LoRA file:', error)
        } finally {
            setModelImporting(false)
        }
    }

    const handleSelectFile = (type: ContextType, file: FileEntry | null) => {
        if (type === ContextType.Embedding) {
            dispatch({ type: 'SELECT_EMBEDDING', payload: file })
            useEngineData.getState().setSelectedEmbeddingLoRAUri(file ? file.uri : null)
        } else {
            dispatch({ type: 'SELECT_REASONING', payload: file })
            useEngineData.getState().setSelectedReasoningLoRAUri(file ? file.uri : null)
        }
    }

    const loadContext = async (contextType: ContextType) => {
        if (modelLoading || modelImporting) return

        let modelId: number | null
        let setModelId: (id: number | null) => void
        let loraUri: string | null = null
        let getContextFunc: (loraPath: string | null) => Promise<LlamaContext | null>
        let modelTypeName: ModelDataType['model_type']

        if (contextType === ContextType.Embedding) {
            modelId = embeddingModelId
            setModelId = setEmbeddingModelId
            loraUri = selectedEmbeddingLoRA?.uri ?? null
            getContextFunc = LlamaModule.getEmbeddingLlamaContext
            modelTypeName = 'rag_embedding'
        } else {
            modelId = ragReasoningModelId
            setModelId = setRagReasoningModelId
            loraUri = selectedReasoningLoRA?.uri ?? null
            getContextFunc = LlamaModule.getRagReasoningLlamaContext
            modelTypeName = 'rag_reasoning'
        }

        if (!modelId) {
            Alert.alert(
                'No Base Model Selected',
                `Please select a ${modelTypeName} base model first.`
            )
            return
        }

        const baseModel = models.find((m) => m.id === modelId)
        if (!baseModel) {
            reportModelError(
                modelTypeName,
                `Selected base model (ID: ${modelId}) not found in database. Please re-select.`
            )
            if (contextType === ContextType.Embedding) setEmbeddingModelId(null)
            else setRagReasoningModelId(null)
            return
        }

        if (baseModel.model_type !== modelTypeName) {
            reportModelError(
                modelTypeName,
                `The selected model "${baseModel.name}" is of type "${baseModel.model_type}", but a "${modelTypeName}" model is required here.`
            )
            return
        }

        setModelLoading(true)
        try {
            const context = await getContextFunc(loraUri)
            if (context) {
                Logger.infoToast(
                    `${baseModel.name} (${modelTypeName}) loaded${loraUri ? ' with LoRA' : ''}.`
                )
            } else {
                reportModelError(modelTypeName, `Failed to load ${modelTypeName} model.`)
            }
        } catch (e: any) {
            reportModelError(modelTypeName, `Error loading ${modelTypeName} model: ${e.message}`)
            console.error(`Error loading ${modelTypeName} model:`, e)
        } finally {
            setModelLoading(false)
        }
    }

    const unloadContext = async (contextType: ContextType) => {
        if (modelLoading || modelImporting) return
        setModelLoading(true)
        try {
            if (contextType === ContextType.Embedding) {
                await LlamaModule.unloadEmbeddingLlamaContext()
            } else {
                await LlamaModule.unloadRagReasoningLlamaContext()
            }
            Logger.infoToast(`${contextType} model unloaded.`)
        } catch (e: any) {
            reportModelError(contextType, `Failed to unload ${contextType} model: ${e.message}`)
        } finally {
            setModelLoading(false)
        }
    }

    const {
        loadedEmbeddingModelInContext: currentEmbeddingContextModel,
        loadedRagReasoningModelInContext: currentReasoningContextModel,
    } = LlamaModule.useLlama.getState()

    return (
        <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
            <Text style={styles.heading}>RAG Model Configuration</Text>

            <ModelPicker
                currentModelId={embeddingModelId}
                contextType="rag_embedding"
                title="RAG Embedding"
                onSelectId={setEmbeddingModelId}
                loadedContextModel={currentEmbeddingContextModel}
                disabled={modelLoading || modelImporting}
                models={models}
            />
            <LoRAPicker
                selectedFile={selectedEmbeddingLoRA}
                availableLoRAs={availableLoRAs}
                title="RAG Embedding"
                onSelect={(file) => handleSelectFile(ContextType.Embedding, file)}
                onImportFile={handlePickAndCopyFile}
                disabled={modelLoading || modelImporting}
            />
            <View style={styles.buttonRow}>
                <ThemedButton
                    label={
                        modelLoading && currentEmbeddingContextModel?.id === embeddingModelId
                            ? 'Loading...'
                            : 'Load Embedding Context'
                    }
                    onPress={() => loadContext(ContextType.Embedding)}
                    disabled={!embeddingModelId || modelLoading || modelImporting}
                    showActivityIndicator={
                        modelLoading && currentEmbeddingContextModel?.id === embeddingModelId
                    }
                    size="small"
                />
                <ThemedButton
                    label={
                        modelLoading && !embeddingModelId
                            ? 'Unloading...'
                            : 'Unload Embedding Context'
                    }
                    onPress={() => unloadContext(ContextType.Embedding)}
                    disabled={!currentEmbeddingContextModel || modelLoading || modelImporting}
                    size="small"
                />
            </View>

            <ModelPicker
                currentModelId={ragReasoningModelId}
                contextType="rag_reasoning"
                title="RAG Reasoning (LLM)"
                onSelectId={setRagReasoningModelId}
                loadedContextModel={currentReasoningContextModel}
                disabled={modelLoading || modelImporting}
                models={models}
            />
            <LoRAPicker
                selectedFile={selectedReasoningLoRA}
                availableLoRAs={availableLoRAs}
                title="RAG Reasoning (LLM)"
                onSelect={(file) => handleSelectFile(ContextType.Reasoning, file)}
                onImportFile={handlePickAndCopyFile}
                disabled={modelLoading || modelImporting}
            />
            <View style={styles.buttonRow}>
                <ThemedButton
                    label={
                        modelLoading && currentReasoningContextModel?.id === ragReasoningModelId
                            ? 'Loading...'
                            : 'Load Reasoning Context'
                    }
                    onPress={() => loadContext(ContextType.Reasoning)}
                    disabled={!ragReasoningModelId || modelLoading || modelImporting}
                    showActivityIndicator={
                        modelLoading && currentReasoningContextModel?.id === ragReasoningModelId
                    }
                    size="small"
                />
                <ThemedButton
                    label={
                        modelLoading && !ragReasoningModelId
                            ? 'Unloading...'
                            : 'Unload Reasoning Context'
                    }
                    onPress={() => unloadContext(ContextType.Reasoning)}
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
