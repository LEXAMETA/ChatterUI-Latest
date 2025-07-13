// app/screens/ModelManager/ModelSettings.tsx

import ThemedButton from '@components/buttons/ThemedButton'
import ThemedSlider from '@components/input/ThemedSlider'
import ThemedSwitch from '@components/input/ThemedSwitch'
import SectionTitle from '@components/text/SectionTitle'
import Alert from '@components/views/Alert'
import { AppSettings } from '@lib/constants/GlobalValues'
import { Llama } from '@lib/engine/Local/LlamaLocal'
import { KV } from '@lib/engine/Local/Model'
import { Logger } from '@lib/state/Logger'
import { readableFileSize } from '@lib/utils/File'
import { useFocusEffect } from 'expo-router'
import React, { useCallback, useEffect, useState } from 'react' // Import useCallback
import { BackHandler, Platform, View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native' // Import necessary RN components
import { useMMKVBoolean } from 'react-native-mmkv'
import Animated, { Easing, SlideInRight, SlideOutRight } from 'react-native-reanimated'
import { ModelDataType } from 'db/schema'; // Import ModelDataType

type ModelSettingsProp = {
    modelImporting: boolean
    modelLoading: boolean
    exit: () => void
    // New props from ModelManager
    models: ModelDataType[]; // List of all available models
    setEmbeddingModelId: (id: number | null) => void;
    setRagReasoningModelId: (id: number | null) => void;
    embeddingModelId: number | null | undefined;
    ragReasoningModelId: number | null | undefined;
}

const ModelSettings: React.FC<ModelSettingsProp> = ({
    modelImporting,
    modelLoading,
    exit,
    models, // Destructure new props
    setEmbeddingModelId,
    setRagReasoningModelId,
    embeddingModelId,
    ragReasoningModelId,
}) => {
    // Assuming useStyles is defined outside or imported
    const styles = useStyles(); // You'll need to define useStyles if not already global/imported
    const { color, spacing, borderRadius, fontSize } = Theme.useTheme(); // Assuming Theme.useTheme is available

    const { config, setConfig } = Llama.useEngineData((state) => ({
        config: state.config,
        setConfig: state.setConfiguration,
    }))

    const [saveKV, setSaveKV] = useMMKVBoolean(AppSettings.SaveLocalKV)
    const [autoloadLocal, setAutoloadLocal] = useMMKVBoolean(AppSettings.AutoLoadLocal)
    const [showModelInChat, setShowModelInChat] = useMMKVBoolean(AppSettings.ShowModelInChat)

    const [kvSize, setKVSize] = useState(0)

    const getKVSize = async () => {
        const size = await KV.getKVSize()
        setKVSize(size)
    }

    useEffect(() => {
        getKVSize()
    }, [])

    const backAction = () => {
        exit()
        return true
    }

    useFocusEffect(() => {
        const handler = BackHandler.addEventListener('hardwareBackPress', backAction)
        return () => handler.remove()
    })

    const handleDeleteKV = () => {
        Alert.alert({
            title: 'Delete KV Cache',
            description: `Are you sure you want to delete the KV Cache? This cannot be undone. \n\n This will clear up ${readableFileSize(kvSize)} of space.`,
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Delete KV Cache',
                    onPress: async () => {
                        await KV.deleteKV()
                        Logger.info('KV Cache deleted!')
                        getKVSize()
                    },
                    type: 'warning',
                },
            ],
        })
    }

    // --- NEW RAG Model Selection Logic ---
    const handleSelectRAGModel = useCallback(async (modelId: number | null, modelType: 'rag_embedding' | 'rag_reasoning') => {
        const model = models.find(m => m.id === modelId);

        if (modelId !== null && model && model.model_type !== modelType) {
            Alert.alert(
                "Incorrect Model Type",
                `The selected model '${model.name}' is registered as a '${model.model_type}' model. Please select a model of type '${modelType}'.`
            );
            return;
        }

        if (modelType === 'rag_embedding') {
            setEmbeddingModelId(modelId);
            Logger.infoToast(modelId ? `RAG Embedding Model set to: ${model?.name}` : "RAG Embedding Model unset.");
        } else if (modelType === 'rag_reasoning') {
            setRagReasoningModelId(modelId);
            Logger.infoToast(modelId ? `RAG Reasoning Model set to: ${model?.name}` : "RAG Reasoning Model unset.");
        }
    }, [models, setEmbeddingModelId, setRagReasoningModelId]); // Add dependencies

    const renderModelPicker = (currentModelId: number | null | undefined, modelType: 'rag_embedding' | 'rag_reasoning', title: string) => {
        const selectedModel = models.find(m => m.id === currentModelId);
        const filteredModels = models.filter(m => m.model_type === modelType);

        return (
            <View style={styles.pickerContainer}>
                <Text style={styles.pickerTitle}>{title}</Text>
                <TouchableOpacity
                    style={styles.pickerButton}
                    onPress={() =>
                        Alert.alert({
                            title: title,
                            description: "Select a model:",
                            buttons: [
                                ...(filteredModels.length > 0 ? filteredModels.map(model => ({
                                    label: `${model.name} (${model.params}, ${model.quantization})`,
                                    onPress: () => handleSelectRAGModel(model.id, modelType),
                                })) : [{ label: "No models of this type available.", style: "cancel" }]),
                                {
                                    label: "Unset Current Selection",
                                    onPress: () => handleSelectRAGModel(null, modelType),
                                    type: "destructive", // Use type for styling if your Alert supports it
                                },
                                { label: "Cancel", style: "cancel" },
                            ],
                            cancelable: true,
                        })
                    }
                >
                    <Text style={styles.pickerButtonText}>
                        {selectedModel ? selectedModel.name : "Tap to Select"}
                    </Text>
                </TouchableOpacity>
                {selectedModel && (
                    <Text style={styles.modelDetailsSmall}>
                        Details: {selectedModel.params}, {selectedModel.quantization}
                    </Text>
                )}
            </View>
        );
    };
    // --- END NEW RAG Model Selection Logic ---


    return (
        <Animated.ScrollView
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            entering={SlideInRight.easing(Easing.inOut(Easing.cubic))}
            exiting={SlideOutRight.easing(Easing.inOut(Easing.cubic))}>

            {/* NEW RAG Model Assignment Section */}
            <SectionTitle>RAG Model Assignments</SectionTitle>
            <View style={styles.sectionContainer}>
                {renderModelPicker(embeddingModelId, 'rag_embedding', "RAG Embedding Model")}
                {renderModelPicker(ragReasoningModelId, 'rag_reasoning', "RAG Reasoning Model")}
            </View>

            <SectionTitle>CPU Settings</SectionTitle>
            <View style={styles.sectionContainer}> {/* Use a consistent section container */}
            {config && (
                <View>
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
                    {/* Note: llama.rn does not have any Android gpu acceleration */}
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
                </View>
            )}
            </View> {/* Close sectionContainer */}

            <SectionTitle>Advanced Settings</SectionTitle>
            <View style={styles.sectionContainer}> {/* Use a consistent section container */}
                <ThemedSwitch
                    label="Show Model Name In Chat"
                    value={showModelInChat}
                    onChangeValue={setShowModelInChat}
                />
                <ThemedSwitch
                    label="Automatically Load Model on Chat"
                    value={autoloadLocal}
                    onChangeValue={setAutoloadLocal}
                />
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
                        label={'Purge KV Cache (' + readableFileSize(kvSize) + ')'}
                        onPress={handleDeleteKV}
                        variant={kvSize === 0 ? 'disabled' : 'critical'}
                    />
                )}
            </View> {/* Close sectionContainer */}
        </Animated.ScrollView>
    )
}

export default ModelSettings

// Re-define useStyles here or import it if it's in a shared file
const useStyles = () => {
    const { color, spacing, borderRadius, fontSize } = Theme.useTheme();

    return StyleSheet.create({
        // Add styles for the new RAG selection UI
        sectionContainer: {
            padding: spacing.l,
            backgroundColor: color.neutral._200,
            borderRadius: borderRadius.l,
            marginBottom: spacing.l,
        },
        pickerContainer: {
            marginBottom: spacing.m,
        },
        pickerTitle: {
            fontSize: fontSize.m,
            fontWeight: '600',
            color: color.text._200,
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
            color: color.primary._700,
        },
        modelDetailsSmall: {
            fontSize: fontSize.s,
            color: color.text._400,
            marginTop: spacing.xs,
            textAlign: 'center',
        },
        // Existing styles for ModelSettings can go here too if not globally defined
    });
};
