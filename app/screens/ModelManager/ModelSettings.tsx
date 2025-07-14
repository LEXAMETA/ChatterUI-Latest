// app/screens/ModelManager/ModelSettings.tsx

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
// import { useMMKVBoolean } from 'react-native-mmkv'; // No longer needed for specific LoRA keys, but might be for SaveLocalKV etc.

import { SectionTitle } from '../../components/text/SectionTitle';
import ThemedButton from '../../components/buttons/ThemedButton';
import ThemedSlider from '../../components/input/ThemedSlider';
import ThemedSwitch from '../../components/input/ThemedSwitch';

import { useTheme } from '../../lib/theme/ThemeManager';
import { pickFile, copyFileToAppDirectory } from '../../lib/utils/File';
import { Llama, useEngineData } from '../../lib/engine/Local/LlamaLocal'; // Import Llama and useEngineData
import { KV } from '../../lib/engine/Local/Model'; // Assuming KV is still needed for cache management
import { Logger } from '../../lib/state/Logger';
import { readableFileSize } from '../../lib/utils/File';
import { ModelDataType } from 'db/schema'; // Ensure correct import for ModelDataType
import * as FileSystem from 'expo-file-system'; // Ensure FileSystem is imported

// Interface for files picked from the system, distinct from DB models
interface FileEntry {
  name: string;
  uri: string;
}

type ModelSettingsProps = {
  modelImporting: boolean;
  modelLoading: boolean;
  exit: () => void;
  models: ModelDataType[]; // This prop now holds all your DB-backed models
  setEmbeddingModelId: (id: number | null) => void;
  setRagReasoningModelId: (id: number | null) => void;
  embeddingModelId: number | null | undefined;
  ragReasoningModelId: number | null | undefined;
};

const ModelSettings: React.FC<ModelSettingsProps> = ({
  modelImporting,
  modelLoading,
  exit,
  models, // Now actively used for base model selection
  setEmbeddingModelId,
  setRagReasoningModelId,
  embeddingModelId,
  ragReasoningModelId,
}) => {
  const { colors, spacing, borderRadius, fontSize } = useTheme();
  const styles = useStyles({ colors, spacing, borderRadius, fontSize });

  const [loadingFile, setLoadingFile] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // No longer need availableModels, as base models come from the 'models' prop
  const [availableLoRAs, setAvailableLoRAs] = useState<FileEntry[]>([]);

  // Use Zustand store for persistent LoRA selection
  const {
    selectedEmbeddingLoRAUri,
    setSelectedEmbeddingLoRAUri,
    selectedReasoningLoRAUri,
    setSelectedReasoningLoRAUri,
    config, // Retain config for CPU settings
    setConfiguration: setConfig, // Retain setConfig for CPU settings
  } = useEngineData((state) => ({
    selectedEmbeddingLoRAUri: state.selectedEmbeddingLoRAUri,
    setSelectedEmbeddingLoRAUri: state.setSelectedEmbeddingLoRAUri,
    selectedReasoningLoRAUri: state.selectedReasoningLoRAUri,
    setSelectedReasoningLoRAUri: state.setSelectedReasoningLoRAUri,
    config: state.config,
    setConfiguration: state.setConfiguration,
  }));

  // Local state to track which FileEntry corresponds to the persistent LoRA URI
  const [selectedEmbeddingLoRALocal, setSelectedEmbeddingLoRALocal] = useState<FileEntry | null>(null);
  const [selectedReasoningLoRALocal, setSelectedReasoningLoRALocal] = useState<FileEntry | null>(null);

  // MMKV booleans for other settings (still needed)
  const [saveKV, setSaveKV] = useMMKVBoolean('SaveLocalKV');
  const [autoloadLocal, setAutoloadLocal] = useMMKVBoolean('AutoLoadLocal');
  const [showModelInChat, setShowModelInChat] = useMMKVBoolean('ShowModelInChat');

  const [kvSize, setKVSize] = useState(0);

  // ... (Existing useEffect for KV size, Android back button handling) ...

  // --- REFACTORED: Load LoRAs from app storage directory and link to persistent state ---
  // No longer loading 'models/' directory here, as base models are from DB.
  useEffect(() => {
    const loadStoredLoRAsAndSelections = async () => {
      setLoadingFile(true);
      try {
        const loras = await loadFilesFromDirectory('loras/', ['.gguf', '.bin']);
        setAvailableLoRAs(loras);

        // Link persistent LoRA URIs to local FileEntry objects
        if (selectedEmbeddingLoRAUri) {
          const found = loras.find(l => l.uri === selectedEmbeddingLoRAUri);
          setSelectedEmbeddingLoRALocal(found || null);
        }
        if (selectedReasoningLoRAUri) {
          const found = loras.find(l => l.uri === selectedReasoningLoRAUri);
          setSelectedReasoningLoRALocal(found || null);
        }
      } catch (error) {
        Logger.error('Error loading stored LoRAs and selections:', error);
        setStatusMessage('Error loading stored LoRAs.');
      } finally {
        setLoadingFile(false);
      }
    };
    loadStoredLoRAsAndSelections();
  }, [
    loadFilesFromDirectory,
    selectedEmbeddingLoRAUri,
    selectedReasoningLoRAUri,
  ]); // Dependencies ensure re-run if persistent URIs change

  // ... (Existing loadFilesFromDirectory function, no change needed) ...

  // --- REFACTORED: handlePickAndCopyFile (now primarily for LoRAs or new base model import) ---
  const handlePickAndCopyFile = async (type: 'model' | 'lora') => {
    setLoadingFile(true);
    setStatusMessage(`Picking ${type}...`);
    try {
      const fileTypes = type === 'model' ? ['.gguf', 'application/octet-stream'] : ['.gguf', '.bin', 'application/octet-stream'];
      const subfolder = type === 'model' ? 'models/' : 'loras/'; // Still copy to 'models/' for raw new models

      const fileInfo = await pickFile(fileTypes, true);
      if (fileInfo) {
        const destinationFileName = `${subfolder}${fileInfo.name}`;
        const copiedUri = await copyFileToAppDirectory(fileInfo.uri, destinationFileName);

        if (copiedUri) {
          setStatusMessage(`${type} '${fileInfo.name}' copied successfully.`);
          if (type === 'lora') { // Only update availableLoRAs here
            setAvailableLoRAs((prev) => [...prev, { name: fileInfo.name, uri: copiedUri }]);
          } else {
            // If a 'model' is picked directly, it should ideally be added to your DB.
            // This part is crucial: After copying, you need to add this model to your Drizzle DB
            // so it can be selected by ID. For now, we'll just log this.
            Logger.info(`Model file copied: ${copiedUri}. Please ensure it's added to your database.`);
            Alert.alert("Model Copied", `Model '${fileInfo.name}' copied to app directory. You might need to add it to your model database.`);
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

  // --- REFACTORED: handleSelectFile (now only for LoRAs) ---
  const handleSelectFile = useCallback((file: FileEntry | null, fileType: 'lora', contextType: 'embedding' | 'reasoning') => {
    if (fileType === 'lora') { // Ensure it's explicitly a LoRA selection
      if (contextType === 'embedding') {
        setSelectedEmbeddingLoRALocal(file);
        setSelectedEmbeddingLoRAUri(file ? file.uri : null);
      } else {
        setSelectedReasoningLoRALocal(file);
        setSelectedReasoningLoRAUri(file ? file.uri : null);
      }
    }
  }, [setSelectedEmbeddingLoRAUri, setSelectedReasoningLoRAUri]);

  // --- REFACTORED: handleLoadContext (uses DB model ID and LoRA URI) ---
  const handleLoadContext = async (contextType: 'embedding' | 'reasoning') => {
    setLoadingFile(true);
    setStatusMessage(`Loading ${contextType} context...`);
    try {
      let modelIdToLoad: number | null | undefined;
      let loraUriToLoad: string | null;
      let selectedModelData: ModelDataType | undefined;

      if (contextType === 'embedding') {
        modelIdToLoad = embeddingModelId;
        loraUriToLoad = selectedEmbeddingLoRAUri;
        selectedModelData = models.find(m => m.id === embeddingModelId); // Get model data from prop
      } else {
        modelIdToLoad = ragReasoningModelId;
        loraUriToLoad = selectedReasoningLoRAUri;
        selectedModelData = models.find(m => m.id === ragReasoningModelId); // Get model data from prop
      }

      if (!modelIdToLoad || !selectedModelData) {
        Alert.alert('Error', `Please select a base model for the ${contextType} context.`);
        setStatusMessage(`Failed to load ${contextType} context.`);
        return;
      }

      // Pass the model ID and LoRA URI directly to LlamaLocal functions
      if (contextType === 'embedding') {
        await Llama.getEmbeddingLlamaContext(modelIdToLoad, loraUriToLoad);
      } else {
        await Llama.getRagReasoningLlamaContext(modelIdToLoad, loraUriToLoad);
      }

      setStatusMessage(`${contextType} context loaded successfully!`);
      Alert.alert(
        'Success',
        `${contextType} context loaded with ${selectedModelData.name}` + (loraUriToLoad ? ` and LoRA ${selectedEmbeddingLoRALocal?.name || selectedReasoningLoRALocal?.name}` : '')
      );
    } catch (e: any) {
      Logger.error(`Error loading ${contextType} context:`, e);
      setStatusMessage(`Failed to load ${contextType} context: ${e.message}`);
      Alert.alert('Error', `Failed to load ${contextType} context: ${e.message}`);
    } finally {
      setLoadingFile(false);
    }
  };

  // --- NEW: Render Model Picker (for DB-backed base models) ---
  const renderModelPicker = (
    currentId: number | null | undefined,
    contextType: 'rag_embedding' | 'rag_reasoning' | 'main_chat', // Add main_chat if needed elsewhere
    title: string,
    onSelectId: (id: number | null) => void // Setter for embeddingModelId or ragReasoningModelId
  ) => {
    const filteredModels = models.filter(m => m.model_type === contextType);
    const selectedModelName = filteredModels.find(m => m.id === currentId)?.name;

    return (
      <View style={styles.section}>
        <SectionTitle title={title} />
        {selectedModelName && <Text style={[styles.text, { color: colors.text }]}>Selected: {selectedModelName}</Text>}
        <ScrollView horizontal style={styles.fileList}>
          {filteredModels.length > 0 ? (
            filteredModels.map((model) => (
              <ThemedButton
                key={model.id}
                title={model.name}
                onPress={() => onSelectId(model.id)}
                style={[
                  styles.fileButton,
                  currentId === model.id && styles.selectedFileButton,
                  { backgroundColor: currentId === model.id ? colors.primary : colors.cardBackground },
                ]}
                textStyle={{ color: currentId === model.id ? colors.buttonText : colors.text }}
              />
            ))
          ) : (
            <Text style={[styles.text, { color: colors.textSecondary }]}>No {title.toLowerCase()} models found.</Text>
          )}
        </ScrollView>
        {currentId !== null && (
          <ThemedButton
            title={`Clear Selected ${title}`}
            onPress={() => onSelectId(null)}
            style={styles.clearButton}
            textStyle={{ color: colors.text }}
          />
        )}
      </View>
    );
  };

  // --- REFACTORED: Render LoRA Picker (for file-based LoRAs) ---
  const renderLoRAPicker = (
    title: string,
    files: FileEntry[],
    selectedFile: FileEntry | null, // This is now the local state for LoRA
    onSelectFileLocal: (file: FileEntry | null, fileType: 'lora', contextType: 'embedding' | 'reasoning') => void,
    contextType: 'embedding' | 'reasoning' // Add contextType to differentiate
  ) => (
    <View style={styles.section}>
      <SectionTitle title={title} />
      <ThemedButton title={`Pick LoRA file`} onPress={() => handlePickAndCopyFile('lora')} disabled={loadingFile} />
      {selectedFile && <Text style={[styles.text, { color: colors.text }]}>Selected: {selectedFile.name}</Text>}
      <ScrollView horizontal style={styles.fileList}>
        {files.length > 0 ? (
          files.map((file, index) => (
            <ThemedButton
              key={index}
              title={file.name}
              onPress={() => onSelectFileLocal(file, 'lora', contextType)} // Use the new wrapper
              style={[
                styles.fileButton,
                selectedFile?.uri === file.uri && styles.selectedFileButton,
                { backgroundColor: selectedFile?.uri === file.uri ? colors.primary : colors.cardBackground },
              ]}
              textStyle={{ color: selectedFile?.uri === file.uri ? colors.buttonText : colors.text }}
            />
          ))
        ) : (
          <Text style={[styles.text, { color: colors.textSecondary }]}>No LoRA files found. Pick one to get started!</Text>
        )}
      </ScrollView>
      {selectedFile !== null && (
        <ThemedButton
          title={`Clear Selected LoRA`}
          onPress={() => onSelectFileLocal(null, 'lora', contextType)} // Use the new wrapper
          style={styles.clearButton}
          textStyle={{ color: colors.text }}
        />
      )}
    </View>
  );

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

      {/* REFACTORED: Embedding Model Selection (from DB) */}
      {renderModelPicker(embeddingModelId, 'rag_embedding', 'Embedding Model', setEmbeddingModelId)}
      {renderLoRAPicker('Embedding LoRA Adapter (Optional)', availableLoRAs, selectedEmbeddingLoRALocal, handleSelectFile, 'embedding')}
      <ThemedButton
        title="Load Embedding Context"
        onPress={() => handleLoadContext('embedding')}
        disabled={loadingFile || !embeddingModelId} // Base model must be selected
        style={styles.loadContextButton}
      />
      <ThemedButton title="Unload Embedding Context" onPress={Llama.unloadEmbeddingLlamaContext} style={styles.loadContextButton} />

      {/* REFACTORED: Reasoning Model Selection (from DB) */}
      {renderModelPicker(ragReasoningModelId, 'rag_reasoning', 'Reasoning Model', setRagReasoningModelId)}
      {renderLoRAPicker('Reasoning LoRA Adapter (Optional)', availableLoRAs, selectedReasoningLoRALocal, handleSelectFile, 'reasoning')}
      <ThemedButton
        title="Load Reasoning Context"
        onPress={() => handleLoadContext('reasoning')}
        disabled={loadingFile || !ragReasoningModelId} // Base model must be selected
        style={styles.loadContextButton}
      />
      <ThemedButton title="Unload Reasoning Context" onPress={Llama.unloadRagReasoningLlamaContext} style={styles.loadContextButton} />

      {/* The existing RAG Model Assignments (model picker) section can be removed if the above replaces it fully.
          If 'rag_embedding' and 'rag_reasoning' types were meant for _these_ pickers, then they're now merged
          into the new `renderModelPicker`. If they served a different purpose, you'll need to clarify.
          Based on the prompt, it seems the new `renderModelPicker` is the unified solution. */}
      {/* <SectionTitle>RAG Model Assignments</SectionTitle>
      <View style={styles.sectionContainer}>
        {renderModelPicker(embeddingModelId, 'rag_embedding', 'RAG Embedding Model')} // This old function
        {renderModelPicker(ragReasoningModelId, 'rag_reasoning', 'RAG Reasoning Model')} // This old function
      </View> */}

      {/* CPU Settings (existing, no change needed) */}
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

      {/* Advanced Settings (existing, no change needed unless other MMKV uses are consolidated) */}
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

// ... (useStyles and other existing code should be retained as is) ...
