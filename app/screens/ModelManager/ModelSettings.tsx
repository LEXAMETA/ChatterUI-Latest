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
import React, { useEffect, useReducer, Dispatch, SetStateAction } from 'react'
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
}

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

/** ModelPicker component omitted for brevity, same as before with proper imports **/

/** LoRAPicker component with nullish coalescing fix and correct size display **/
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
                        {selectedFile?.name ?? 'No LoRA selected'}
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

// (Include the rest of ModelSettings component and styles here, as before)

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
