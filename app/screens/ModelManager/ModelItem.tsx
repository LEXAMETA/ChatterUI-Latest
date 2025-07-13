// app/screens/ModelManager/ModelItem.tsx

import Alert from '@components/views/Alert'
import TextBoxModal from '@components/views/TextBoxModal'
import { AntDesign } from '@expo/vector-icons'
import { GGMLNameMap } from '@lib/engine/Local'
import { Llama } from '@lib/engine/Local/LlamaLocal' // Import Llama namespace
import { Model } from '@lib/engine/Local/Model'
import { Theme } from '@lib/theme/ThemeManager'
import { readableFileSize } from '@lib/utils/File'
import { ModelDataType } from 'db/schema'
import { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View, ActivityIndicator } from 'react-native' // Import ActivityIndicator

type ModelItemProps = {
    item: ModelDataType
    index: number
    modelLoading: boolean // True if ANY model is loading
    setModelLoading: (b: boolean) => void // Function to set global modelLoading state
    modelImporting: boolean // True if ANY model is importing
    // New props for main chat model
    currentChatModel: ModelDataType | undefined;
    loadCurrentChatModel: (model: ModelDataType) => Promise<void>;
}

const ModelItem: React.FC<ModelItemProps> = ({
    item,
    modelImporting,
    modelLoading,
    setModelLoading,
    index,
    currentChatModel, // Destructure new props
    loadCurrentChatModel, // Destructure new props
}) => {
    const styles = useStyles()
    const { color } = Theme.useTheme()

    // Use currentChatModel from props instead of Llama.useLlama state directly in ModelItem
    // This allows the parent (ModelManager) to control the loading state visually.
    const isCurrentModelActive = currentChatModel?.id === item.id;


    const [showEdit, setShowEdit] = useState(false)
    //@ts-ignore
    const quant: string = item.quantization && GGMLNameMap[item.quantization]
    
    // Disable delete if this is the active main chat model, or if any model is globally loading
    const disableDelete = isCurrentModelActive || modelLoading; 
    const isInvalid = Model.isInitialEntry(item)

    const handleDeleteModel = () => {
        Alert.alert({
            title: 'Delete Model',
            description:
                `Are you sure you want to delete "${item.name}"?\n\nThis cannot be undone!` +
                (!isInvalid
                    ? !item.file_path.startsWith('content')
                        ? `\n\nThis operation will clear up ${readableFileSize(item.file_size)}`
                        : '\n\n(This will not delete external model files, just this entry)'
                    : ''),
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Delete Model',
                    onPress: async () => {
                        // If the deleted model is the currently loaded main chat model, unload it
                        if (isCurrentModelActive) {
                            await Llama.useLlama.getState().unloadCurrentChatModel();
                        }
                        // If the deleted model is assigned as a RAG model, unset its ID
                        if (Llama.useEngineData.getState().embeddingModelId === item.id) {
                            Llama.useEngineData.getState().setEmbeddingModelId(null);
                        }
                        if (Llama.useEngineData.getState().ragReasoningModelId === item.id) {
                            Llama.useEngineData.getState().setRagReasoningModelId(null);
                        }

                        await Model.deleteModelById(item.id)
                        Logger.infoToast(`Model '${item.name}' deleted.`); // Provide feedback
                    },
                    type: 'warning',
                },
            ],
        })
    }

    // Disable loading/unloading buttons if any model is importing or loading,
    // or if the current item is invalid.
    const disableLoad = modelLoading || modelImporting || isInvalid;
    const disableUnload = modelLoading || modelImporting;

    // Edit button disabled if this model is active, any model is loading, or it's invalid
    const disableEdit = isCurrentModelActive || modelLoading || isInvalid;


    const handleLoadChatModel = async () => {
        if (disableLoad) return;
        
        // Only allow loading if it's a 'main_chat' type
        if (item.model_type !== 'main_chat') {
            Alert.alert("Incorrect Model Type", `This model is of type '${item.model_type}' and cannot be loaded as the main chat model.`);
            return;
        }

        setModelLoading(true); // Signal to parent that loading has started
        try {
            await loadCurrentChatModel(item); // Use the new prop function
            Logger.infoToast(`Main chat model '${item.name}' loaded.`);
        } catch (error) {
            Logger.errorToast(`Failed to load model: ${error.message}`);
        } finally {
            setModelLoading(false); // Signal loading finished
        }
    };

    const handleUnloadChatModel = async () => {
        if (disableUnload) return;

        setModelLoading(true); // Indicate unloading
        try {
            await Llama.useLlama.getState().unloadCurrentChatModel(); // Direct call to global unload
            Logger.infoToast(`Main chat model '${item.name}' unloaded.`);
        } catch (error) {
            Logger.errorToast(`Failed to unload model: ${error.message}`);
        } finally {
            setModelLoading(false); // Signal unloading finished
        }
    };


    return (
        <View style={styles.modelContainer}>
            <TextBoxModal
                booleans={[showEdit, setShowEdit]}
                onConfirm={async (name) => {
                    await Model.updateName(name, item.id)
                }}
                title="Rename Model"
                defaultValue={item.name}
            />

            <Text style={styles.title}>{item.name}</Text>
            {!isInvalid && (
                <View style={styles.tagContainer}>
                    <Text style={styles.tag}>
                        {item.params === 'N/A' ? 'No Param Size' : item.params}
                    </Text>
                    <Text style={styles.tag}>{quant}</Text>
                    <Text style={styles.tag}>{readableFileSize(item.file_size)}</Text>
                    <Text style={{ ...styles.tag, textTransform: 'capitalize' }}>
                        {item.architecture}
                    </Text>
                    <Text style={{ ...styles.tag, textTransform: 'capitalize' }}>{item.model_type}</Text> {/* Display model_type */}
                    <Text style={styles.tag}>
                        {item.file_path.startsWith('content') ? 'External' : 'Internal'}
                    </Text>
                </View>
            )}
            {isInvalid && (
                <View style={styles.tagContainer}>
                    <Text style={styles.tag}>Model is Invalid</Text>
                </View>
            )}
            {!isInvalid && (
                <Text style={styles.subtitle}>Context Length: {item.context_length}</Text>
            )}
            <Text style={styles.subtitle}>File: {item.file.replace('.gguf', '')}</Text>
            <View style={styles.buttonContainer}>
                <TouchableOpacity
                    disabled={disableEdit}
                    onPress={() => {
                        setShowEdit(true)
                    }}>
                    <AntDesign
                        name="edit"
                        style={styles.button}
                        size={24}
                        color={disableEdit ? color.text._600 : color.text._300}
                    />
                </TouchableOpacity>
                <TouchableOpacity
                    disabled={disableDelete}
                    onPress={() => {
                        handleDeleteModel()
                    }}>
                    <AntDesign
                        name="delete"
                        style={styles.button}
                        size={24}
                        color={disableDelete ? color.text._600 : color.error._500}
                    />
                </TouchableOpacity>
                {/* Conditionally render Load/Unload button for Main Chat Models */}
                {item.model_type === 'main_chat' && (
                    <>
                        {!isCurrentModelActive ? (
                            <TouchableOpacity
                                disabled={disableLoad}
                                onPress={handleLoadChatModel}>
                                {modelLoading && Llama.useLlama.getState().currentChatModel?.id === item.id ? ( // Show loading indicator specifically for THIS model if it's the one loading
                                    <ActivityIndicator size="small" color={color.text._300} style={styles.button}/>
                                ) : (
                                    <AntDesign
                                        name="playcircleo"
                                        style={styles.button}
                                        size={24}
                                        color={disableLoad ? color.text._600 : color.text._300}
                                    />
                                )}
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity
                                disabled={disableUnload}
                                onPress={handleUnloadChatModel}>
                                {modelLoading && Llama.useLlama.getState().currentChatModel?.id === item.id ? ( // Show loading indicator specifically for THIS model if it's the one loading
                                    <ActivityIndicator size="small" color={color.text._100} style={styles.button}/>
                                ) : (
                                    <AntDesign
                                        name="closecircleo"
                                        style={styles.button}
                                        size={24}
                                        color={color.text._100}
                                    />
                                )}
                            </TouchableOpacity>
                        )}
                    </>
                )}
            </View>
            {/* Display "CURRENT CHAT MODEL" label for the active main chat model */}
            {isCurrentModelActive && (
                <Text style={styles.currentModelLabel}>CURRENT CHAT MODEL</Text>
            )}
        </View>
    )
}

export default ModelItem

const useStyles = () => {
    const { color, spacing, borderRadius, fontSize } = Theme.useTheme()

    return StyleSheet.create({
        modelContainer: {
            borderRadius: spacing.l,
            paddingVertical: spacing.l,
            paddingHorizontal: spacing.xl2,
            backgroundColor: color.neutral._200,
            marginBottom: spacing.l,
        },

        tagContainer: {
            columnGap: 4,
            rowGap: 4,
            paddingTop: spacing.m,
            paddingBottom: spacing.m,
            flexDirection: 'row',
            justifyContent: 'flex-start',
            flexWrap: 'wrap',
        },

        tag: {
            borderRadius: borderRadius.m,
            borderColor: color.primary._300,
            borderWidth: 1,
            paddingHorizontal: spacing.m,
            paddingVertical: spacing.s,
            color: color.text._300,
        },
        title: {
            fontSize: fontSize.l,
            color: color.text._100,
        },

        subtitle: {
            color: color.text._400,
        },

        buttonContainer: {
            flexDirection: 'row',
            flex: 1,
            justifyContent: 'space-between',
            marginTop: spacing.l,
            borderColor: color.neutral._300,
        },

        button: {
            flex: 1,
            paddingVertical: spacing.m,
            paddingHorizontal: spacing.xl3,
            // Ensure ActivityIndicator can also occupy this space
            alignItems: 'center',
            justifyContent: 'center',
        },
        currentModelLabel: {
            fontSize: fontSize.s,
            fontWeight: 'bold',
            color: 'green', // Or a themed green color
            marginTop: spacing.s,
            textAlign: 'center',
        }
    })
}
