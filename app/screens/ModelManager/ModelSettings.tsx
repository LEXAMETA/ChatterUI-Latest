import ThemedButton from '@components/buttons/ThemedButton'
import PopupMenu from '@components/views/PopupMenu'
import AntDesign from '@expo/vector-icons/AntDesign'
import * as LlamaModule from '@lib/engine/Local/LlamaLocal'
import { reportModelError } from '@lib/engine/utils/LoggerUtils'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'
import { readableFileSize, pickFile } from '@lib/utils/File'
import { ModelDataType } from 'db/schema'
import * as FileSystem from 'expo-file-system'
import React, { useEffect, useReducer, Dispatch, SetStateAction, useMemo, useCallback } from 'react'
import { ScrollView, StyleSheet, Text, View, ActivityIndicator, Alert } from 'react-native'

// Enums for context types
enum ContextType {
    Embedding = 'embedding',
    Reasoning = 'reasoning',
}

const PopupIcons = {
    database: 'database' as const,
    exclamationcircleo: 'exclamationcircleo' as const,
    file1: 'file1' as const,
    close: 'close' as const,
    pluscircleo: 'pluscircleo' as const,
}

// Define a type for PopupMenu option, matching PopupMenu expectations
type PopupMenuItem = {
    label: string
    onPress: (...args: any[]) => void
    icon: keyof typeof PopupIcons
}

type FileEntry = {
    name: string
    uri: string
    size: number
}

export interface ModelSettingsProps {
    modelImporting: boolean
    setModelImporting: Dispatch<SetStateAction<boolean>>
    modelLoading: boolean
    setModelLoading: Dispatch<SetStateAction<boolean>>
    exit: () => void
    models: ModelDataType[]
    embeddingModelId: number | null
    ragReasoningModelId: number | null
    setEmbeddingModelId: (id: number | null) => void
    setRagReasoningModelId: (id: number | null) => void
    getLoRAUriForModelId: (
        modelId: number | null,
        context: 'embedding' | 'reasoning'
    ) => string | null | undefined
    setLoRAUriForModelId: (
        modelId: number,
        uri: string | null,
        context: 'embedding' | 'reasoning'
    ) => void
}

type LoRAState = {
    availableLoRAs: FileEntry[]
    selectedEmbeddingLoRA: FileEntry | null
    selectedReasoningLoRA: FileEntry | null
    error: string | null
    isLoadingLoRAs: boolean
}

type LoRAAction =
    | { type: 'SET_AVAILABLE'; payload: FileEntry[] }
    | { type: 'SELECT_EMBEDDING'; payload: FileEntry | null }
    | { type: 'SELECT_REASONING'; payload: FileEntry | null }
    | { type: 'SET_ERROR'; payload: string | null }
    | { type: 'SET_LOADING'; payload: boolean }

const loraReducer = (state: LoRAState, action: LoRAAction): LoRAState => {
    switch (action.type) {
        case 'SET_AVAILABLE':
            return { ...state, availableLoRAs: action.payload }
        case 'SELECT_EMBEDDING':
            return { ...state, selectedEmbeddingLoRA: action.payload }
        case 'SELECT_REASONING':
            return { ...state, selectedReasoningLoRA: action.payload }
        case 'SET_ERROR':
            return { ...state, error: action.payload }
        case 'SET_LOADING':
            return { ...state, isLoadingLoRAs: action.payload }
        default:
            return state
    }
}

const useLoRAFiles = (
    embeddingModelId: number | null,
    ragReasoningModelId: number | null,
    getLoRAUriForModelId: (
        modelId: number | null,
        context: 'embedding' | 'reasoning'
    ) => string | null | undefined
) => {
    const [state, dispatch] = useReducer(loraReducer, {
        availableLoRAs: [],
        selectedEmbeddingLoRA: null,
        selectedReasoningLoRA: null,
        error: null,
        isLoadingLoRAs: true,
    })

    const loadLoRAs = useCallback(async () => {
        dispatch({ type: 'SET_LOADING', payload: true })
        dispatch({ type: 'SET_ERROR', payload: null })
        let isActive = true

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
                    loraFiles.push({ name: file, uri, size: fileInfo.size ?? 0 })
                }
            }

            if (!isActive) return

            dispatch({ type: 'SET_AVAILABLE', payload: loraFiles })

            const currentEmbeddingLoRAUri = getLoRAUriForModelId(embeddingModelId, 'embedding')
            const embeddingFile = loraFiles.find((f) => f.uri === currentEmbeddingLoRAUri) ?? null
            dispatch({ type: 'SELECT_EMBEDDING', payload: embeddingFile })

            const currentReasoningLoRAUri = getLoRAUriForModelId(ragReasoningModelId, 'reasoning')
            const reasoningFile = loraFiles.find((f) => f.uri === currentReasoningLoRAUri) ?? null
            dispatch({ type: 'SELECT_REASONING', payload: reasoningFile })
        } catch (error) {
            const errorMessage = `Error loading LoRA files: ${(error as Error).message}`
            reportModelError('LoRA Files', errorMessage)
            if (isActive) {
                dispatch({ type: 'SET_ERROR', payload: errorMessage })
            }
        } finally {
            if (isActive) {
                dispatch({ type: 'SET_LOADING', payload: false })
            }
        }

        return () => {
            isActive = false
        }
    }, [embeddingModelId, ragReasoningModelId, getLoRAUriForModelId])

    useEffect(() => {
        loadLoRAs()
    }, [loadLoRAs])

    return [state, loadLoRAs, dispatch] as const
}

interface LoRAPickerProps {
    selectedFile: FileEntry | null
    title: string
    onSelect: (file: FileEntry | null) => void
    availableLoRAs: FileEntry[]
    onImportFile: () => Promise<void>
    disabled: boolean
    isLoading: boolean
}

const LoRAPicker: React.FC<LoRAPickerProps> = React.memo(
    ({ selectedFile, title, onSelect, availableLoRAs, onImportFile, disabled, isLoading }) => {
        const styles = useStyles()
        const { color, spacing } = Theme.useTheme()

        const popupOptions: PopupMenuItem[] = useMemo(() => {
            const options: PopupMenuItem[] = availableLoRAs.map((file) => ({
                label: file.name,
                onPress: () => onSelect(file),
                icon: 'file1',
            }))
            options.push(
                {
                    label: '--- Clear LoRA ---',
                    onPress: () => onSelect(null),
                    icon: 'close',
                },
                {
                    label: 'Import New LoRA File',
                    onPress: onImportFile,
                    icon: 'pluscircleo',
                }
            )
            return options
        }, [availableLoRAs, onSelect, onImportFile])

        return (
            <View style={styles.sectionContainer}>
                <Text style={styles.sectionTitle}>{title} LoRA Adapter</Text>
                <PopupMenu
                    placement="top"
                    icon="file1"
                    disabled={disabled || isLoading}
                    options={popupOptions}>
                    <View style={styles.selectionDisplay}>
                        <Text style={styles.selectionText}>
                            {selectedFile?.name ?? 'No LoRA selected'}
                        </Text>
                        {(disabled || isLoading) && (
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
                        {readableFileSize(selectedFile.size)}
                    </Text>
                )}
            </View>
        )
    }
)

const ModelSettings: React.FC<ModelSettingsProps> = ({
    modelImporting,
    setModelImporting,
    modelLoading,
    setModelLoading,
    exit,
    models,
    embeddingModelId,
    ragReasoningModelId,
    setEmbeddingModelId,
    setRagReasoningModelId,
    getLoRAUriForModelId,
    setLoRAUriForModelId,
}) => {
    const styles = useStyles()
    const { color, spacing } = Theme.useTheme()

    const [loraState, loadLoRAs, loraDispatch] = useLoRAFiles(
        embeddingModelId,
        ragReasoningModelId,
        getLoRAUriForModelId
    )

    const handleExit = useCallback(() => exit(), [exit])

    const handleImportLoRAFile = useCallback(async () => {
        setModelImporting(true)
        try {
            const result = await pickFile('application/octet-stream', false)
            if (result?.uri) {
                const loraFileName = result.name ?? result.uri.split('/').pop() ?? 'imported_lora'
                const destUri = `${LlamaModule.AppDirectory.LoRAPath}${loraFileName}`

                const info = await FileSystem.getInfoAsync(destUri)
                if (info.exists) {
                    Alert.alert(
                        'File Exists',
                        `A file named "${loraFileName}" already exists. Do you want to overwrite it?`,
                        [
                            { text: 'Cancel', style: 'cancel' },
                            {
                                text: 'Overwrite',
                                onPress: async () => {
                                    await FileSystem.deleteAsync(destUri, { idempotent: true })
                                    await FileSystem.copyAsync({ from: result.uri, to: destUri })
                                    Logger.infoToast(
                                        `LoRA "${loraFileName}" imported successfully!`
                                    )
                                    loadLoRAs()
                                },
                            },
                        ]
                    )
                } else {
                    await FileSystem.copyAsync({ from: result.uri, to: destUri })
                    Logger.infoToast(`LoRA "${loraFileName}" imported successfully!`)
                    loadLoRAs()
                }
            }
        } catch (error) {
            const errorMessage = `Failed to import LoRA: ${(error as Error).message}`
            reportModelError('LoRA Import', errorMessage)
            Logger.errorToast(errorMessage)
        } finally {
            setModelImporting(false)
        }
    }, [loadLoRAs, setModelImporting])

    const handleSelectEmbeddingLoRA = useCallback(
        (file: FileEntry | null) => {
            if (embeddingModelId !== null) {
                setLoRAUriForModelId(embeddingModelId, file?.uri ?? null, 'embedding')
                loraDispatch({ type: 'SELECT_EMBEDDING', payload: file })
            } else {
                Logger.warnToast('No embedding model selected to associate LoRA with.')
            }
        },
        [embeddingModelId, setLoRAUriForModelId, loraDispatch]
    )

    const handleSelectReasoningLoRA = useCallback(
        (file: FileEntry | null) => {
            if (ragReasoningModelId !== null) {
                setLoRAUriForModelId(ragReasoningModelId, file?.uri ?? null, 'reasoning')
                loraDispatch({ type: 'SELECT_REASONING', payload: file })
            } else {
                Logger.warnToast('No reasoning model selected to associate LoRA with.')
            }
        },
        [ragReasoningModelId, setLoRAUriForModelId, loraDispatch]
    )

    return (
        <ScrollView contentContainerStyle={styles.container}>
            <Text style={styles.heading}>Model Settings</Text>

            {(modelLoading || loraState.isLoadingLoRAs) && (
                <ActivityIndicator
                    size="large"
                    color={color.primary._500}
                    style={{ marginBottom: spacing.l }}
                />
            )}

            {loraState.error && (
                <Text
                    style={{
                        color: color.error._400,
                        textAlign: 'center',
                        marginBottom: spacing.m,
                    }}>
                    {loraState.error}
                </Text>
            )}

            {models.length === 0 ? (
                <Text style={{ color: color.text._300, textAlign: 'center' }}>
                    No models available.
                </Text>
            ) : (
                models.map((model) => (
                    <View key={model.id} style={styles.settingItem}>
                        <Text style={styles.settingLabel}>{model.name}</Text>
                        <Text style={styles.selectedModelInfo}>
                            {readableFileSize(model.file_size)}
                        </Text>
                    </View>
                ))
            )}

            <LoRAPicker
                selectedFile={loraState.selectedEmbeddingLoRA}
                title="Embedding"
                onSelect={handleSelectEmbeddingLoRA}
                availableLoRAs={loraState.availableLoRAs}
                onImportFile={handleImportLoRAFile}
                disabled={modelImporting || modelLoading}
                isLoading={loraState.isLoadingLoRAs}
            />

            <LoRAPicker
                selectedFile={loraState.selectedReasoningLoRA}
                title="Reasoning"
                onSelect={handleSelectReasoningLoRA}
                availableLoRAs={loraState.availableLoRAs}
                onImportFile={handleImportLoRAFile}
                disabled={modelImporting || modelLoading}
                isLoading={loraState.isLoadingLoRAs}
            />

            <View style={{ marginTop: spacing.l }}>
                <ThemedButton
                    label="Exit"
                    onPress={handleExit}
                    disabled={modelImporting || modelLoading}
                />
            </View>
        </ScrollView>
    )
}

const useStyles = () => {
    const { color, spacing, borderRadius, fontSize } = Theme.useTheme()

    return useMemo(
        () =>
            StyleSheet.create({
                container: {
                    flexGrow: 1,
                    padding: spacing.l,
                    backgroundColor: color.neutral._100,
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
            }),
        [color, spacing, borderRadius, fontSize]
    )
}

export default ModelSettings
