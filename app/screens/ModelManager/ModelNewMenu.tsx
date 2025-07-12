// app/screens/ModelManager/ModelNewMenu.tsx

import PopupMenu, { MenuRef } from '@components/views/PopupMenu';
import { Model } from '@lib/engine/Local/Model'; // Assuming Model.importModel and Model.linkModelExternal handle the actual import/linking
import { useState, useRef } from 'react'; // Import useRef
import { View, Alert, Platform } from 'react-native'; // Import Alert and Platform
import { ModelType } from 'db/schema'; // Import ModelType from your schema

type ModelNewMenuProps = {
    modelImporting: boolean;
    setModelImporting: (b: boolean) => void;
};

const ModelNewMenu: React.FC<ModelNewMenuProps> = ({ modelImporting, setModelImporting }) => {
    const menuRef = useRef<MenuRef>(null); // Create a ref for the PopupMenu if needed to close it programmatically

    const showModelTypeSelection = (onSelect: (type: ModelType) => Promise<void>) => {
        if (Platform.OS === 'ios') {
            Alert.alert(
                "Select Model Type",
                "Choose the purpose of this model:",
                [
                    {
                        text: "Main Chat Model",
                        onPress: () => onSelect('main_chat'),
                    },
                    {
                        text: "RAG Embedding Model",
                        onPress: () => onSelect('rag_embedding'),
                    },
                    {
                        text: "RAG Reasoning Model",
                        onPress: () => onSelect('rag_reasoning'),
                    },
                    {
                        text: "Cancel",
                        style: "cancel",
                    },
                ],
                { cancelable: true }
            );
        } else {
            // For Android or other platforms, a simpler prompt or custom modal might be needed.
            // For now, let's use a text input prompt for demonstration, user types the value.
            Alert.prompt(
                "Select Model Type",
                "Enter model type (main_chat, rag_embedding, rag_reasoning):",
                [
                    {
                        text: "Cancel",
                        style: "cancel",
                    },
                    {
                        text: "OK",
                        onPress: (text) => {
                            const type = text?.toLowerCase() as ModelType;
                            if (['main_chat', 'rag_embedding', 'rag_reasoning'].includes(type)) {
                                onSelect(type);
                            } else {
                                Alert.alert("Invalid Type", "Please enter a valid model type: main_chat, rag_embedding, or rag_reasoning.");
                            }
                        },
                    },
                ],
                'plain-text',
                'main_chat' // Default value
            );
        }
    };

    const handleSetExternal = async () => {
        menuRef.current?.close(); // Close the popup menu
        if (modelImporting) return;

        showModelTypeSelection(async (modelType) => {
            setModelImporting(true);
            await Model.linkModelExternal(modelType); // Pass the modelType
            setModelImporting(false);
        });
    };

    const handleImportModel = async () => {
        menuRef.current?.close(); // Close the popup menu
        if (modelImporting) return;

        showModelTypeSelection(async (modelType) => {
            setModelImporting(true);
            await Model.importModel(modelType); // Pass the modelType
            setModelImporting(false);
        });
    };

    return (
        <View>
            <PopupMenu
                ref={menuRef} // Assign the ref to your PopupMenu
                placement="bottom"
                icon="addfile"
                disabled={modelImporting}
                options={[
                    {
                        label: 'Copy Model Into ChatterUI',
                        icon: 'download',
                        onPress: handleImportModel,
                    },
                    {
                        label: 'Use External Model',
                        icon: 'link',
                        onPress: handleSetExternal,
                    },
                ]}
            />
        </View>
    );
};

export default ModelNewMenu;
