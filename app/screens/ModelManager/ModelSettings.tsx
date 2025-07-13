import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Platform,
  BackHandler,
} from 'react-native';
import Animated, { Easing, SlideInRight, SlideOutRight } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import { useMMKVBoolean } from 'react-native-mmkv';

import { SectionTitle } from '../components/text/SectionTitle';
import ThemedButton from '../components/buttons/ThemedButton';
import ThemedSlider from '../components/input/ThemedSlider';
import ThemedSwitch from '../components/input/ThemedSwitch';

import { useTheme } from '../lib/theme/ThemeManager';
import { pickFile, copyFileToAppDirectory } from '../lib/utils/File';
import { Llama } from '../lib/engine/Local/LlamaLocal';
import { KV } from '../lib/engine/Local/Model';
import { Logger } from '../lib/state/Logger';
import { readableFileSize } from '../lib/utils/File';
import { ModelDataType } from 'db/schema';

interface FileEntry {
  name: string;
  uri: string;
}

type ModelSettingsProps = {
  modelImporting: boolean;
  modelLoading: boolean;
  exit: () => void;
  models: ModelDataType[];
  setEmbeddingModelId: (id: number | null) => void;
  setRagReasoningModelId: (id: number | null) => void;
  embeddingModelId: number | null | undefined;
  ragReasoningModelId: number | null | undefined;
};

const ModelSettings: React.FC<ModelSettingsProps> = ({
  modelImporting,
  modelLoading,
  exit,
  models,
  setEmbeddingModelId,
  setRagReasoningModelId,
  embeddingModelId,
  ragReasoningModelId,
}) => {
  const { colors, spacing, borderRadius, fontSize } = useTheme();
  const styles = useStyles({ colors, spacing, borderRadius, fontSize });

  const [loadingFile, setLoadingFile] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [availableModels, setAvailableModels] = useState<FileEntry[]>([]);
  const [availableLoRAs, setAvailableLoRAs] = useState<FileEntry[]>([]);

  const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState<FileEntry | null>(null);
  const [selectedEmbeddingLoRA, setSelectedEmbeddingLoRA] = useState<FileEntry | null>(null);
  const [selectedReasoningModel, setSelectedReasoningModel] = useState<FileEntry | null>(null);
  const [selectedReasoningLoRA, setSelectedReasoningLoRA] = useState<FileEntry | null>(null);

  const { config, setConfiguration: setConfig } = Llama.useEngineData((state) => ({
    config: state.config,
    setConfiguration: state.setConfiguration,
  }));

  const [saveKV, setSaveKV] = useMMKVBoolean('SaveLocalKV');
  const [autoloadLocal, setAutoloadLocal] = useMMKVBoolean('AutoLoadLocal');
  const [showModelInChat, setShowModelInChat] = useMMKVBoolean('ShowModelInChat');

  const [kvSize, setKVSize] = useState(0);

  // Load KV size on mount
  useEffect(() => {
    const getKVSize = async () => {
      const size = await KV.getKVSize();
      setKVSize(size);
    };
    getKVSize();
  }, []);

  // Android back button handling
  useFocusEffect(
    useCallback(() => {
      const backAction = () => {
        exit();
        return true;
      };
      const subscription = BackHandler.addEventListener('hardwareBackPress', backAction);
      return () => subscription.remove();
    }, [exit])
  );

  // Load files from app storage directory
  const loadFilesFromDirectory = useCallback(async (subfolder: string, extensions: string[]): Promise<FileEntry[]> => {
    const dir = `${FileSystem.documentDirectory}${subfolder}`;
    const dirInfo = await FileSystem.getInfoAsync(dir);
    if (!dirInfo.exists || !dirInfo.isDirectory) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      return [];
    }
    const files = await FileSystem.readDirectoryAsync(dir);
    return files
      .filter((f) => extensions.some((ext) => f.toLowerCase().endsWith(ext)))
      .map((f) => ({ name: f, uri: `${dir}${f}` }));
  }, []);

  // Load available models and LoRAs on mount
  useEffect(() => {
    const loadStoredFiles = async () => {
      setLoadingFile(true);
      try {
        const models = await loadFilesFromDirectory('models/', ['.gguf']);
        setAvailableModels(models);

        const loras = await loadFilesFromDirectory('loras/', ['.gguf', '.bin']);
        setAvailableLoRAs(loras);
      } catch (error) {
        Logger.error('Error loading stored files:', error);
        setStatusMessage('Error loading stored models/LoRAs.');
      } finally {
        setLoadingFile(false);
      }
    };
    loadStoredFiles();
  }, [loadFilesFromDirectory]);

  // Pick and copy model or LoRA file
  const handlePickAndCopyFile = async (type: 'model' | 'lora') => {
    setLoadingFile(true);
    setStatusMessage(`Picking ${type}...`);
    try {
      const fileTypes = type === 'model' ? ['.gguf', 'application/octet-stream'] : ['.gguf', '.bin', 'application/octet-stream'];
      const subfolder = type === 'model' ? 'models/' : 'loras/';

      const fileInfo = await pickFile(fileTypes, true);
      if (fileInfo) {
        const destinationFileName = `${subfolder}${fileInfo.name}`;
        const copiedUri = await copyFileToAppDirectory(fileInfo.uri, destinationFileName);

        if (copiedUri) {
          setStatusMessage(`${type} '${fileInfo.name}' copied successfully.`);
          if (type === 'model') {
            setAvailableModels((prev) => [...prev, { name: fileInfo.name, uri: copiedUri }]);
          } else {
            setAvailableLoRAs((prev) => [...prev, { name: fileInfo.name, uri: copiedUri }]);
          }
        } else {
          setStatusMessage(`Failed to copy ${type} '${fileInfo.name}'.`);
        }
      } else {
        setStatusMessage(`No ${type} file selected.`);
      }
    } catch (e: any) {
      Logger.error(`Error picking or copying ${type}:`, e);
      setStatusMessage(`Error: ${e.message}`);
    } finally {
      setLoadingFile(false);
    }
  };

  // Load embedding or reasoning context
  const handleLoadContext = async (contextType: 'embedding' | 'reasoning') => {
    setLoadingFile(true);
    setStatusMessage(`Loading ${contextType} context...`);
    try {
      let modelToLoad: FileEntry | null;
      let loraToLoad: FileEntry | null;

      if (contextType === 'embedding') {
        modelToLoad = selectedEmbeddingModel;
        loraToLoad = selectedEmbeddingLoRA;
      } else {
        modelToLoad = selectedReasoningModel;
        loraToLoad = selectedReasoningLoRA;
      }

      if (!modelToLoad) {
        Alert.alert('Error', `Please select a base model for the ${contextType} context.`);
        setStatusMessage(`Failed to load ${contextType} context.`);
        return;
      }

      if (contextType === 'embedding') {
        await Llama.getEmbeddingLlamaContext(modelToLoad.uri, loraToLoad?.uri);
      } else {
        await Llama.getRagReasoningLlamaContext(modelToLoad.uri, loraToLoad?.uri);
      }

      setStatusMessage(`${contextType} context loaded successfully!`);
      Alert.alert(
        'Success',
        `${contextType} context loaded with ${modelToLoad.name}` + (loraToLoad ? ` and LoRA ${loraToLoad.name}` : '')
      );
    } catch (e: any) {
      Logger.error(`Error loading ${contextType} context:`, e);
      setStatusMessage(`Failed to load ${contextType} context: ${e.message}`);
      Alert.alert('Error', `Failed to load ${contextType} context: ${e.message}`);
    } finally {
      setLoadingFile(false);
    }
  };

  // Render file selection UI for models/LoRAs
  const renderFileSelection = (
    title: string,
    files: FileEntry[],
    selectedFile: FileEntry | null,
    onSelectFile: (file: FileEntry | null) => void,
    fileType: 'model' | 'lora'
  ) => (
    <View style={styles.section}>
      <SectionTitle title={title} />
      <ThemedButton title={`Pick ${fileType} file`} onPress={() => handlePickAndCopyFile(fileType)} disabled={loadingFile} />
      {selectedFile && <Text style={[styles.text, { color: colors.text }]}>Selected: {selectedFile.name}</Text>}
      <ScrollView horizontal style={styles.fileList}>
        {files.map((file, index) => (
          <ThemedButton
            key={index}
            title={file.name}
            onPress={() => onSelectFile(file)}
            style={[
              styles.fileButton,
              selectedFile?.uri === file.uri && styles.selectedFileButton,
              { backgroundColor: selectedFile?.uri === file.uri ? colors.primary : colors.cardBackground },
            ]}
            textStyle={{ color: selectedFile?.uri === file.uri ? colors.buttonText : colors.text }}
          />
        ))}
      </ScrollView>
      {files.length > 0 && (
        <ThemedButton title={`Clear Selected ${fileType}`} onPress={() => onSelectFile(null)} style={styles.clearButton} textStyle={{ color: colors.text }} />
      )}
    </View>
  );

  // RAG model selection logic
  const handleSelectRAGModel = useCallback(
    async (modelId: number | null, modelType: 'rag_embedding' | 'rag_reasoning') => {
      const model = models.find((m) => m.id === modelId);

      if (modelId !== null && model && model.model_type !== modelType) {
        Alert.alert(
          'Incorrect Model Type',
          `The selected model '${model.name}' is registered as a '${model.model_type}' model. Please select a model of type '${modelType}'.`
        );
        return;
      }

      if (modelType === 'rag_embedding') {
        setEmbeddingModelId(modelId);
        Logger.infoToast(modelId ? `RAG Embedding Model set to: ${model?.name}` : 'RAG Embedding Model unset.');
      } else if (modelType === 'rag_reasoning') {
        setRagReasoningModelId(modelId);
        Logger.infoToast(modelId ? `RAG Reasoning Model set to: ${model?.name}` : 'RAG Reasoning Model unset.');
      }
    },
    [models, setEmbeddingModelId, setRagReasoningModelId]
  );

  const renderModelPicker = (
    currentModelId: number | null | undefined,
    modelType: 'rag_embedding' | 'rag_reasoning',
    title: string
  ) => {
    const selectedModel = models.find((m) => m.id === currentModelId);
    const filteredModels = models.filter((m) => m.model_type === modelType);

    return (
      <View style={styles.pickerContainer}>
        <Text style={styles.pickerTitle}>{title}</Text>
        <TouchableOpacity
          style={styles.pickerButton}
          onPress={() =>
            Alert.alert({
              title,
              description: 'Select a model:',
              buttons: [
                ...(filteredModels.length > 0
                  ? filteredModels.map((model) => ({
                      label: `${model.name} (${model.params}, ${model.quantization})`,
                      onPress: () => handleSelectRAGModel(model.id, modelType),
                    }))
                  : [{ label: 'No models of this type available.', style: 'cancel' }]),
                {
                  label: 'Unset Current Selection',
                  onPress: () => handleSelectRAGModel(null, modelType),
                  style: 'destructive',
                },
                { label: 'Cancel', style: 'cancel' },
              ],
              cancelable: true,
            })
          }
        >
          <Text style={styles.pickerButtonText}>{selectedModel ? selectedModel.name : 'Tap to Select'}</Text>
        </TouchableOpacity>
        {selectedModel && (
          <Text style={styles.modelDetailsSmall}>
            Details: {selectedModel.params}, {selectedModel.quantization}
          </Text>
        )}
      </View>
    );
  };

  // KV Cache deletion handler
  const handleDeleteKV = () => {
    Alert.alert({
      title: 'Delete KV Cache',
      description: `Are you sure you want to delete the KV Cache? This cannot be undone. \n\n This will clear up ${readableFileSize(kvSize)} of space.`,
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Delete KV Cache',
          onPress: async () => {
            await KV.deleteKV();
            Logger.info('KV Cache deleted!');
            const size = await KV.getKVSize();
            setKVSize(size);
          },
          style: 'destructive',
        },
      ],
    });
  };

  return (
    <Animated.ScrollView
      showsVerticalScrollIndicator={false}
      style={[styles.container, { backgroundColor: colors.background }]}
      entering={SlideInRight.easing(Easing.inOut(Easing.cubic))}
      exiting={SlideOutRight.easing(Easing.inOut(Easing.cubic))}
    >
      <SectionTitle title="File Management" />
      {loadingFile && <ActivityIndicator color={colors.primary} style={styles.indicator} />}
      {statusMessage && <Text style={[styles.text, { color: colors.text }]}>{statusMessage}</Text>}

      {/* Embedding Model Selection */}
      {renderFileSelection('Embedding Model', availableModels, selectedEmbeddingModel, setSelectedEmbeddingModel, 'model')}
      {renderFileSelection('Embedding LoRA Adapter (Optional)', availableLoRAs, selectedEmbeddingLoRA, setSelectedEmbeddingLoRA, 'lora')}
      <ThemedButton
        title="Load Embedding Context"
        onPress={() => handleLoadContext('embedding')}
        disabled={loadingFile || !selectedEmbeddingModel}
        style={styles.loadContextButton}
      />
      <ThemedButton title="Unload Embedding Context" onPress={Llama.unloadEmbeddingLlamaContext} style={styles.loadContextButton} />

      {/* Reasoning Model Selection */}
      {renderFileSelection('Reasoning Model', availableModels, selectedReasoningModel, setSelectedReasoningModel, 'model')}
      {renderFileSelection('Reasoning LoRA Adapter (Optional)', availableLoRAs, selectedReasoningLoRA, setSelectedReasoningLoRA, 'lora')}
      <ThemedButton
        title="Load Reasoning Context"
        onPress={() => handleLoadContext('reasoning')}
        disabled={loadingFile || !selectedReasoningModel}
        style={styles.loadContextButton}
      />
      <ThemedButton title="Unload Reasoning Context" onPress={Llama.unloadRagReasoningLlamaContext} style={styles.loadContextButton} />

      {/* RAG Model Assignments */}
      <SectionTitle>RAG Model Assignments</SectionTitle>
      <View style={styles.sectionContainer}>
        {renderModelPicker(embeddingModelId, 'rag_embedding', 'RAG Embedding Model')}
        {renderModelPicker(ragReasoningModelId, 'rag_reasoning', 'RAG Reasoning Model')}
      </View>

      {/* CPU Settings */}
      <SectionTitle>CPU Settings</SectionTitle>
      <View style={styles.sectionContainer}>
        {config && (
          <>
            <ThemedSlider
              label="Max Context"
              value={config.context_length}
              onValueChange={(value) => setConfig({ ...config, context_length: value })}
              min={1024}
              max={32768}
              step={1024}
              disabled={modelImporting || modelLoading}
            />
            <ThemedSlider
              label="Threads"
              value={config.threads}
              onValueChange={(value) => setConfig({ ...config, threads: value })}
              min={1}
              max={8}
              step={1}
              disabled={modelImporting || modelLoading}
            />
            <ThemedSlider
              label="Batch"
              value={config.batch}
              onValueChange={(value) => setConfig({ ...config, batch: value })}
              min={16}
              max={512}
              step={16}
              disabled={modelImporting || modelLoading}
            />
            {Platform.OS === 'ios' && (
              <ThemedSlider
                label="GPU Layers"
                value={config.gpu_layers}
                onValueChange={(value) => setConfig({ ...config, gpu_layers: value })}
                min={0}
                max={100}
                step={1}
              />
            )}
          </>
        )}
      </View>

      {/* Advanced Settings */}
      <SectionTitle>Advanced Settings</SectionTitle>
      <View style={styles.sectionContainer}>
        <ThemedSwitch label="Show Model Name In Chat" value={showModelInChat} onChangeValue={setShowModelInChat} />
        <ThemedSwitch label="Automatically Load Model on Chat" value={autoloadLocal} onChangeValue={setAutoloadLocal} />
        <ThemedSwitch
          label="Save Local KV"
          value={saveKV}
          onChangeValue={setSaveKV}
          description={
            saveKV
              ? ''
              : 'Saves the KV cache on generations, allowing you to continue sessions after closing the app. Must use the same model for this to function properly. Saving the KV cache file may be very big and negatively impact battery life!'
          }
        />
        {saveKV && (
          <ThemedButton
            buttonStyle={{ marginTop: 8 }}
            label={`Purge KV Cache (${readableFileSize(kvSize)})`}
            onPress={handleDeleteKV}
            variant={kvSize === 0 ? 'disabled' : 'critical'}
          />
        )}
      </View>
    </Animated.ScrollView>
  );
};

export default ModelSettings;

const useStyles = () => {
  const { color, spacing, borderRadius, fontSize } = Theme.useTheme();

  return StyleSheet.create({
    container: {
      flex: 1,
      padding: spacing.l,
    },
    indicator: {
      marginVertical: 10,
    },
    text: {
      marginTop: 10,
    },
    section: {
      marginTop: 20,
      borderWidth: 1,
      borderColor: color.neutral._200,
      borderRadius: borderRadius.l,
      padding: spacing.m,
    },
    fileList: {
      flexDirection: 'row',
      marginTop: 10,
      marginBottom: 5,
    },
    fileButton: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 20,
      marginRight: 8,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: color.neutral._400,
    },
    selectedFileButton: {
      borderColor: color.primary,
      borderWidth: 2,
    },
    clearButton: {
      marginTop: 5,
      backgroundColor: 'transparent',
      borderColor: color.neutral._400,
      borderWidth: 1,
      paddingVertical: 8,
    },
    loadContextButton: {
      marginTop: 15,
      marginBottom: 5,
    },
    sectionContainer: {
      padding: spacing.l,
      backgroundColor: color.neutral._100,
      borderRadius: borderRadius.l,
      marginBottom: spacing.l,
    },
    pickerContainer: {
      marginBottom: spacing.m,
    },
    pickerTitle: {
      fontSize: fontSize.m,
      fontWeight: '600',
      color: color.text._400,
      marginBottom: spacing.s,
    },
    pickerButton: {
      borderWidth: 1,
      borderColor: color.neutral._400,
      borderRadius: borderRadius.s,
      padding: spacing.m,
      alignItems: 'center',
      backgroundColor: color.neutral._100,
    },
    pickerButtonText: {
      fontSize: fontSize.m,
      fontWeight: 'bold',
      color: color.primary,
    },
    modelDetailsSmall: {
      fontSize: fontSize.s,
      color: color.text._400,
      marginTop: spacing.xs,
      textAlign: 'center',
    },
  });
};
