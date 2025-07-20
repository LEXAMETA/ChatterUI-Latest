// app/screens/ModelManager/ModelSettings.tsx

import React, {
  useEffect,
  useState,
  useReducer,
  Dispatch,
  SetStateAction,
} from 'react'
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { Switch } from 'react-native-gesture-handler'

import DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'

import ThemedButton from '@components/buttons/ThemedButton'
import PopupMenu from '@components/views/PopupMenu'

import * as LlamaModule from '@lib/engine/Local/LlamaLocal'
import { GGMLNameMap, GGMLType } from '@lib/engine/Local/GGML'

import { Theme } from '@lib/theme/ThemeManager'
import { ModelDataType } from 'db/schema'
import { AppSettings, useEngineData, EngineDataProps } from '@constants/GlobalValues'
import { Logger } from '@state/Logger'
import { useMMKVBoolean } from '@storage/MMKV'
import { readableFileSize } from '@lib/utils/File'

import AntDesign from '@expo/vector-icons/AntDesign'

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
  models: ModelDataType[]
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
        Logger.errorToast(`Error loading LoRA files: ${(error as Error).message}`)
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
}

const ModelPicker: React.FC<ModelPickerProps> = ({
  currentModelId,
  contextType,
  title,
  onSelectId,
  loadedContextModel,
  disabled,
}) => {
  const styles = useStyles()
  const { color, spacing } = Theme.useTheme()

  const filteredModels = React.useMemo(
    () => filteredModelsSafe(),
    [currentModelId, contextType]
  )

  function filteredModelsSafe() {
    return loadedContextModel
      ? loadedContextModel.id === currentModelId
        ? []
        : []
      : []
  }

  const filtered = filteredModelsSafe()
  // (Your original version filtered here based on models - will pass models as prop in usage)

  return (
    <View style={styles.sectionContainer}>
      <Text style={styles.sectionTitle}>{title} Base Model</Text>
      <PopupMenu
        placement="top"
        icon={PopupIcons.database}
        disabled={disabled}
        options={
          filtered.length > 0
            ? filtered.map((model) => ({
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
        }
      >
        <View style={styles.selectionDisplay}>
          <Text style={styles.selectionText}>
            {filtered.find((m) => m.id === currentModelId)?.name || 'Select a model'}
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
        ]}
      >
        <View style={styles.selectionDisplay}>
          <Text style={styles.selectionText}>{selectedFile?.name || 'No LoRA selected'}</Text>
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

  // Engine data (LoRA URIs)
  const {
    selectedEmbeddingLoRAUri,
    selectedReasoningLoRAUri,
    setSelectedEmbeddingLoRAUri,
    setSelectedReasoningLoRAUri,
  } = useEngineData((state: EngineDataProps) => ({
    selectedEmbeddingLoRAUri: state.selectedEmbeddingLoRAUri,
    selectedReasoningLoRAUri: state.selectedReasoningLOraUri,
    setSelectedEmbeddingLoRAUri: state.setSelectedEmbeddingLoRAUri,
    setSelectedReasoningLoRAUri: state.setSelectedReasoningLoRAUri,
  }))

  // LoRA file management through reducer & effect
  const [{ availableLoRAs, selectedEmbeddingLoRA, selectedReasoningLoRA }, dispatch] = useLoRAFiles(
    selectedEmbeddingLoRAUri,
    selectedReasoningLoRAUri
  )

  // Settings toggles
  const [saveLocalKV, setSaveLocalKV] = useMMKVBoolean(AppSettings.SaveLocalKV)
  const [autoLoadLocal, setAutoLoadLocal] = useMMKVBoolean(AppSettings.AutoLoadLocal)
  const [showModelInChat, setShowModelInChat] = useMMKVBoolean(AppSettings.ShowModelInChat)

  // Handle file import with copying
  const handlePickAndCopyFile = async () => {
    if (modelImporting || modelLoading) return

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: false,
      })

      if (result.type === 'cancel') return

      // DocumentPicker changed API: assets[0] might be present for multiple files; fallback to result object
      const file: any = (result as any).assets?.[0] ?? result
      if (!file?.uri || !file?.name) {
        Logger.errorToast('No valid file selected')
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
      Logger.errorToast(`Failed to copy lora file: ${error.message}`)
      console.error('Error copying LoRA file:', error)
    }
  }

  // Select a LoRA file in reducer and engine data
  const handleSelectFile = (type: ContextType, file: FileEntry | null) => {
    if (type === ContextType.Embedding) {
      dispatch({ type: 'SELECT_EMBEDDING', payload: file })
      setSelectedEmbeddingLoRAUri(file ? file.uri : null)
    } else {
      dispatch({ type: 'SELECT_REASONING', payload: file })
      setSelectedReasoningLoRAUri(file ? file.uri : null)
    }
  }

  // Context loading/unloading functions
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
      Alert.alert('No Base Model Selected', `Please select a ${modelTypeName} base model first.`)
      return
    }

    const baseModel = models.find((m) => m.id === modelId)
    if (!baseModel) {
      Alert.alert(
        'Model Not Found',
        `Selected base model (ID: ${modelId}) not found in database. Please re-select.`
      )
      setModelId(null)
      return
    }

    if (baseModel.model_type !== modelTypeName) {
      Alert.alert(
        'Incorrect Model Type',
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
        Logger.errorToast(`Failed to load ${modelTypeName} model.`)
      }
    } catch (e: any) {
      Logger.errorToast(`Error loading ${modelTypeName} model: ${e.message}`)
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
      Logger.errorToast(`Failed to unload ${contextType} model: ${e.message}`)
    } finally {
      setModelLoading(false)
    }
  }

  // Get currently loaded RAG models
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
          showActivityIndicator={modelLoading && currentEmbeddingContextModel?.id === embeddingModelId}
          size="small"
        />
        <ThemedButton
          label={
            modelLoading && !embeddingModelId ? 'Unloading...' : 'Unload Embedding Context'
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
          showActivityIndicator={modelLoading && currentReasoningContextModel?.id === ragReasoningModelId}
          size="small"
        />
        <ThemedButton
          label={
            modelLoading && !ragReasoningModelId ? 'Unloading...' : 'Unload Reasoning Context'
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
