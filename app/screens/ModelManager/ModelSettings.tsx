// app/screens/ModelManager/ModelSettings.tsx

import ThemedButton from '@components/buttons/ThemedButton';
import PopupMenu from '@components/views/PopupMenu';
import { Llama } from '@lib/engine/Local/LlamaLocal';
import { ModelDataType } from 'db/schema';
import { Model } from '@lib/engine/Local/Model'; // Make sure Model namespace is imported
import { Theme } from '@lib/theme/ThemeManager';
import { readDirectoryAsync, getInfoAsync } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator, Alert, Platform } from 'react-native';
import { Switch } from 'react-native-gesture-handler'; // Assuming you use this for switches

import { AppSettings } from '../../constants/GlobalValues';
import { Logger } from '../../state/Logger';
import { useMMKVBoolean } from '../../storage/MMKV'; // Keep relevant MMKV hooks

type ModelSettingsProps = {
    exit: () => void;
    modelImporting: boolean;
    modelLoading: boolean;
    models: ModelDataType[]; // All models from the database
    embeddingModelId: number | null | undefined;
    ragReasoningModelId: number | null | undefined;
    setEmbeddingModelId: (id: number | null) => void;
    setRagReasoningModelId: (id: number | null) => void;
};

// Type for local file entries (used for LoRAs)
type FileEntry = {
    name: string;
    uri: string;
    size: number;
};

const ModelSettings: React.FC<ModelSettingsProps> = ({
    exit,
    modelImporting,
    modelLoading,
    models, // All models from the database
    embeddingModelId,
    ragReasoningModelId,
    setEmbeddingModelId,
    setRagReasoningModelId,
}) => {
    const styles = useStyles();
    const { color, spacing } = Theme.useTheme();

    const [availableLoRAs, setAvailableLoRAs] = useState<FileEntry[]>([]);
    const [selectedEmbeddingLoRALocal, setSelectedEmbeddingLoRALocal] = useState<FileEntry | null>(null);
    const [selectedReasoningLoRALocal, setSelectedReasoningLoRALocal] = useState<FileEntry | null>(null);

    // Get LoRA URIs from Zustand (LlamaLocal.ts)
    const { selectedEmbeddingLoRAUri, selectedReasoningLoRAUri, setSelectedEmbeddingLoRAUri, setSelectedReasoningLoRAUri } = Llama.useEngineData(state => ({
        selectedEmbeddingLoRAUri: state.selectedEmbeddingLoRAUri,
        selectedReasoningLoRAUri: state.selectedReasoningLoRAUri,
        setSelectedEmbeddingLoRAUri: state.setSelectedEmbeddingLoRAUri,
        setSelectedReasoningLoRAUri: state.setSelectedReasoningLoRAUri,
    }));

    // MMKV states for general settings
    const [saveLocalKV, setSaveLocalKV] = useMMKVBoolean(AppSettings.SaveLocalKV);
    const [autoLoadLocal, setAutoLoadLocal] = useMMKVBoolean(AppSettings.AutoLoadLocal);
    const [showModelInChat, setShowModelInChat] = useMMKVBoolean(AppSettings.ShowModelInChat);


    // Effect to load available LoRAs and set initial selections
    useEffect(() => {
        const loadLoRAs = async () => {
            const loraPath = `${Llama.AppDirectory.LoRAPath}`;
            const info = await getInfoAsync(loraPath);
            if (!info.exists) {
                await Llama.FileSystem.makeDirectoryAsync(loraPath);
            }

            const files = await readDirectoryAsync(loraPath);
            const loraFiles: FileEntry[] = [];
            for (const file of files) {
                const uri = `${loraPath}${file}`;
                const fileInfo = await getInfoAsync(uri);
                if (fileInfo.exists && fileInfo.isDirectory === false) {
                    loraFiles.push({ name: file, uri: uri, size: fileInfo.size });
                }
            }
            setAvailableLoRAs(loraFiles);

            // Set local selected LoRA states based on persisted URIs
            if (selectedEmbeddingLoRAUri) {
                const found = loraFiles.find(l => l.uri === selectedEmbeddingLoRAUri);
                setSelectedEmbeddingLoRALocal(found || null);
            } else {
                setSelectedEmbeddingLoRALocal(null);
            }
            if (selectedReasoningLoRAUri) {
                const found = loraFiles.find(l => l.uri === selectedReasoningLoRAUri);
                setSelectedReasoningLoRALocal(found || null);
            } else {
                setSelectedReasoningLoRALocal(null);
            }
        };
        loadLoRAs();
    }, [selectedEmbeddingLoRAUri, selectedReasoningLoRAUri]); // Re-run if persisted URIs change

    const handlePickAndCopyFile = async (type: 'lora') => {
        if (modelImporting || modelLoading) return;

        const result = await Llama.getDocumentAsync({
            copyToCacheDirectory: false,
        });

        if (result.canceled || !result.assets || result.assets.length === 0) return;

        const file = result.assets[0];
        const targetPath = `${Llama.AppDirectory.LoRAPath}${file.name}`; // Always copy to LoRA path

        Logger.infoToast(`Copying ${type} file...`);
        try {
            await Llama.FileSystem.copyAsync({
                from: file.uri,
                to: targetPath,
            });
            // After successful copy, refresh the list of available LoRAs
            // and update the selected LoRA state
            const fileInfo = await getInfoAsync(targetPath);
            if (fileInfo.exists) {
                const newLoRAEntry: FileEntry = { name: file.name, uri: targetPath, size: fileInfo.size };
                setAvailableLoRAs(prev => [...prev, newLoRAEntry]);
                Logger.infoToast(`${type} file copied successfully!`);
            }
        } catch (error: any) {
            Logger.errorToast(`Failed to copy ${type} file: ${error.message}`);
            console.error(`Error copying ${type} file:`, error);
        }
    };

    const handleSelectFile = (type: 'embedding' | 'reasoning', file: FileEntry | null) => {
        if (type === 'embedding') {
            setSelectedEmbeddingLoRALocal(file);
            setSelectedEmbeddingLoRAUri(file ? file.uri : null);
        } else {
            setSelectedReasoningLoRALocal(file);
            setSelectedReasoningLoRAUri(file ? file.uri : null);
        }
    };

    const handleLoadContext = async (contextType: 'embedding' | 'reasoning') => {
        if (modelLoading || modelImporting) return;

        let modelIdToLoad: number | null | undefined;
        let loraUriToLoad: string | null;
        let setModelIdFunc: (id: number | null) => void;
        let getLlamaContextFunc: (loraPath: string | null) => Promise<Llama.LlamaContext | null>;
        let modelTypeName: ModelDataType['model_type'];

        if (contextType === 'embedding') {
            modelIdToLoad = embeddingModelId;
            loraUriToLoad = selectedEmbeddingLoRALocal?.uri || null;
            setModelIdFunc = setEmbeddingModelId;
            getLlamaContextFunc = Llama.getEmbeddingLlamaContext;
            modelTypeName = 'rag_embedding';
        } else { // 'reasoning'
            modelIdToLoad = ragReasoningModelId;
            loraUriToLoad = selectedReasoningLoRALocal?.uri || null;
            setModelIdFunc = setRagReasoningModelId;
            getLlamaContextFunc = Llama.getRagReasoningLlamaContext;
            modelTypeName = 'rag_reasoning';
        }

        if (!modelIdToLoad) {
            Alert.alert("No Base Model Selected", `Please select a ${modelTypeName} base model first.`);
            return;
        }

        // Find the full ModelDataType object using the ID
        const baseModel = models.find(m => m.id === modelIdToLoad);
        if (!baseModel) {
            Alert.alert("Model Not Found", `Selected base model (ID: ${modelIdToLoad}) not found in database. Please re-select.`);
            setModelIdFunc(null); // Clear invalid ID
            return;
        }

        // Check if the selected model matches the expected type
        if (baseModel.model_type !== modelTypeName) {
            Alert.alert(
                "Incorrect Model Type",
                `The selected model "${baseModel.name}" is of type "${baseModel.model_type}", but a "${modelTypeName}" model is required here. Please select a correct model type.`,
            );
            return;
        }

        setModelLoading(true); // Signal global loading
        try {
            // LlamaLocal.ts `get...LlamaContext` functions now handle model lookup by ID internally
            // and manage their own global contexts. We just need to trigger the load.
            const context = await getLlamaContextFunc(loraUriToLoad);
            if (context) {
                Logger.infoToast(`${baseModel.name} (${modelTypeName}) loaded with ${loraUriToLoad ? 'LoRA' : 'no LoRA'}.`);
            } else {
                Logger.errorToast(`Failed to load ${modelTypeName} model.`);
            }
        } catch (error: any) {
            Logger.errorToast(`Error loading ${modelTypeName} model: ${error.message}`);
            console.error(`Error loading ${modelTypeName} model:`, error);
        } finally {
            setModelLoading(false); // Signal global loading finished
        }
    };

    const handleUnloadContext = async (contextType: 'embedding' | 'reasoning') => {
        if (modelLoading || modelImporting) return;

        setModelLoading(true); // Indicate unloading
        try {
            if (contextType === 'embedding') {
                await Llama.unloadEmbeddingLlamaContext();
            } else {
                await Llama.unloadRagReasoningLlamaContext();
            }
            Logger.infoToast(`${contextType} model unloaded.`);
        } catch (error: any) {
            Logger.errorToast(`Failed to unload ${contextType} model: ${error.message}`);
        } finally {
            setModelLoading(false); // Signal unloading finished
        }
    };


    const renderModelPicker = (
        currentModelId: number | null | undefined,
        contextType: ModelDataType['model_type'], // e.g., 'rag_embedding', 'rag_reasoning'
        title: string,
        onSelectId: (id: number | null) => void,
        loadedContextModel: ModelDataType | undefined // From LlamaLocal.ts (if context is currently active)
    ) => {
        const filteredModels = models.filter(m => m.model_type === contextType);
        const selectedModel = filteredModels.find(m => m.id === currentModelId);
        const isModelLoaded = loadedContextModel?.id === currentModelId;

        const disabled = modelLoading || modelImporting;

        return (
            <View style={styles.sectionContainer}>
                <Text style={styles.sectionTitle}>{title} Base Model</Text>
                <PopupMenu
                    placement="top" // Or "bottom", depending on preferred UX
                    icon="caretdown" // Placeholder, you might want a more fitting icon
                    disabled={disabled}
                    options={
                        filteredModels.length > 0
                            ? filteredModels.map((model) => ({
                                label: model.name,
                                onPress: () => onSelectId(model.id),
                            }))
                            : [{ label: 'No models of this type available', onPress: () => { } }]
                    }
                >
                    <View style={styles.selectionDisplay}>
                        <Text style={styles.selectionText}>
                            {selectedModel ? selectedModel.name : 'Select a model'}
                        </Text>
                        {selectedModel && isModelLoaded && (
                            <Text style={styles.loadedStatus}> (Active)</Text>
                        )}
                        {disabled && <ActivityIndicator size="small" color={color.text._300} style={{ marginLeft: spacing.s }} />}
                    </View>
                </PopupMenu>
                {selectedModel && (
                    <Text style={styles.selectedModelInfo}>
                        Type: {selectedModel.model_type} | Quant: {Model.GGMLNameMap[parseInt(selectedModel.quantization) as Llama.GGMLType]} | Size: {Llama.readableFileSize(selectedModel.file_size)}
                    </Text>
                )}
            </View>
        );
    };

    const renderLoRAPicker = (
        selectedFile: FileEntry | null,
        title: string,
        onSelect: (file: FileEntry | null) => void,
    ) => {
        const disabled = modelLoading || modelImporting;
        return (
            <View style={styles.sectionContainer}>
                <Text style={styles.sectionTitle}>{title} LoRA Adapter</Text>
                <PopupMenu
                    placement="top"
                    icon="caretdown"
                    disabled={disabled}
                    options={[
                        ...(availableLoRAs.length > 0
                            ? availableLoRAs.map((file) => ({
                                label: file.name,
                                onPress: () => onSelect(file),
                            }))
                            : []),
                        { label: '--- Clear LoRA ---', onPress: () => onSelect(null), icon: 'close' },
                        { label: 'Import New LoRA File', onPress: () => handlePickAndCopyFile('lora'), icon: 'pluscircleo' },
                    ]}
                >
                    <View style={styles.selectionDisplay}>
                        <Text style={styles.selectionText}>
                            {selectedFile ? selectedFile.name : 'No LoRA selected'}
                        </Text>
                        {disabled && <ActivityIndicator size="small" color={color.text._300} style={{ marginLeft: spacing.s }} />}
                    </View>
                </PopupMenu>
                {selectedFile && (
                    <Text style={styles.selectedModelInfo}>
                        Size: {Llama.readableFileSize(selectedFile.size)}
                    </Text>
                )}
            </View>
        );
    };

    // Get currently loaded RAG models from LlamaLocal's internal state
    const currentEmbeddingContextModel = Llama.useLlama.getState().loadedEmbeddingModel;
    const currentReasoningContextModel = Llama.useLlama.getState().loadedRagReasoningModel;

    return (
        <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
            <Text style={styles.heading}>RAG Model Configuration</Text>

            {/* Embedding Model Selection */}
            {renderModelPicker(
                embeddingModelId,
                'rag_embedding',
                'RAG Embedding',
                setEmbeddingModelId,
                currentEmbeddingContextModel
            )}
            {renderLoRAPicker(
                selectedEmbeddingLoRALocal,
                'RAG Embedding',
                (file) => handleSelectFile('embedding', file)
            )}
            <View style={styles.buttonRow}>
                <ThemedButton
                    label={modelLoading && Llama.useLlama.getState().loadedEmbeddingModel?.id === embeddingModelId ? 'Loading...' : 'Load Embedding Context'}
                    onPress={() => handleLoadContext('embedding')}
                    disabled={!embeddingModelId || modelLoading || modelImporting}
                    // Show activity indicator if this specific model is loading
                    showActivityIndicator={modelLoading && Llama.useLlama.getState().loadedEmbeddingModel?.id === embeddingModelId}
                    size="small"
                />
                <ThemedButton
                    label={modelLoading && !embeddingModelId ? 'Unloading...' : 'Unload Embedding Context'} // Adjusted label for unloading
                    onPress={() => handleUnloadContext('embedding')}
                    disabled={!currentEmbeddingContextModel || modelLoading || modelImporting}
                    size="small"
                    type="warning"
                />
            </View>


            {/* Reasoning Model Selection */}
            {renderModelPicker(
                ragReasoningModelId,
                'rag_reasoning',
                'RAG Reasoning (LLM)',
                setRagReasoningModelId,
                currentReasoningContextModel
            )}
            {renderLoRAPicker(
                selectedReasoningLoRALocal,
                'RAG Reasoning (LLM)',
                (file) => handleSelectFile('reasoning', file)
            )}
            <View style={styles.buttonRow}>
                <ThemedButton
                    label={modelLoading && Llama.useLlama.getState().loadedRagReasoningModel?.id === ragReasoningModelId ? 'Loading...' : 'Load Reasoning Context'}
                    onPress={() => handleLoadContext('reasoning')}
                    disabled={!ragReasoningModelId || modelLoading || modelImporting}
                    // Show activity indicator if this specific model is loading
                    showActivityIndicator={modelLoading && Llama.useLlama.getState().loadedRagReasoningModel?.id === ragReasoningModelId}
                    size="small"
                />
                 <ThemedButton
                    label={modelLoading && !ragReasoningModelId ? 'Unloading...' : 'Unload Reasoning Context'} // Adjusted label for unloading
                    onPress={() => handleUnloadContext('reasoning')}
                    disabled={!currentReasoningContextModel || modelLoading || modelImporting}
                    size="small"
                    type="warning"
                />
            </View>

            <View style={styles.divider} />

            <Text style={styles.heading}>App Settings</Text>

            {/* General App Settings */}
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

            <View style={{ height: spacing.xl4 }} /> {/* Spacer */}
        </ScrollView>
    );
};

export default ModelSettings;

const useStyles = () => {
    const { color, spacing, borderRadius, fontSize } = Theme.useTheme();

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
            color: color.primary._500, // Or a distinct "active" color
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
    });
};
