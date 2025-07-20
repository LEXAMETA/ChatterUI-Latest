// app/screens/ModelManager/ModelNewMenu.tsx

import PopupMenu from '@components/views/PopupMenu' // FIX: Removed MenuRef import
import { Model } from '@lib/engine/Local/Model'
import { Logger } from '@lib/state/Logger'
import { ModelType } from 'db/schema'
import { useState, useRef } from 'react'
import { View, Alert, Platform } from 'react-native'

type ModelNewMenuProps = {
    modelImporting: boolean
    setModelImporting: (b: boolean) => void
}

const ModelNewMenu: React.FC<ModelNewMenuProps> = ({ modelImporting, setModelImporting }) => {
    // FIX: Changed MenuRef to any, as it's not exported by PopupMenu
    const menuRef = useRef<any>(null) // Create a ref for the PopupMenu if needed to close it programmatically

    const showModelTypeSelection = (onSelect: (type: ModelType) => Promise<void>) => {
        if (Platform.OS === 'ios') {
            Alert.alert(
                'Select Model Type',
                'Choose the purpose of this model:',
                [
                    {
                        text: 'Main Chat Model',
                        onPress: () => onSelect('main_chat'),
                    },
                    {
                        text: 'RAG Embedding Model',
                        onPress: () => onSelect('rag_embedding'),
                    },
                    {
                        text: 'RAG Reasoning Model',
                        onPress: () => onSelect('rag_reasoning'),
                    },
                    {
                        text: 'Cancel',
                        style: 'cancel',
                    },
                ],
                { cancelable: true }
            )
        } else {
            Alert.prompt(
                'Select Model Type',
                'Enter model type (main_chat, rag_embedding, rag_reasoning):',
                [
                    {
                        text: 'Cancel',
                        style: 'cancel',
                    },
                    {
                        text: 'OK',
                        onPress: (text) => {
                            const type = text?.toLowerCase() as ModelType
                            if (['main_chat', 'rag_embedding', 'rag_reasoning'].includes(type)) {
                                onSelect(type)
                            } else {
                                Alert.alert(
                                    'Invalid Type',
                                    'Please enter a valid model type: main_chat, rag_embedding, or rag_reasoning.'
                                )
                            }
                        },
                    },
                ],
                'plain-text',
                'main_chat' // Default value
            )
        }
    }

    const handleSetExternal = async () => {
        menuRef.current?.close() // Close the popup menu
        if (modelImporting) return

        showModelTypeSelection(async (modelType) => {
            setModelImporting(true)
            try {
                const success = await Model.linkModelExternal(modelType)
                if (success) {
                    Logger.infoToast(`Model linked successfully as '${modelType}'.`)
                } else {
                    Logger.errorToast(`Failed to link model as '${modelType}'.`)
                }
            } catch (error: any) {
                Logger.errorToast(`Error linking model: ${(error as Error).message}`)
                console.error('Error linking model:', error)
            } finally {
                setModelImporting(false)
            }
        })
    }

    const handleImportModel = async () => {
        menuRef.current?.close() // Close the popup menu
        if (modelImporting) return

        showModelTypeSelection(async (modelType) => {
            setModelImporting(true)
            try {
                const success = await Model.importModel(modelType)
                if (success) {
                    Logger.infoToast(`Model imported successfully as '${modelType}'.`)
                } else {
                    Logger.errorToast(`Failed to import model as '${modelType}'.`)
                }
            } catch (error: any) {
                Logger.errorToast(`Error importing model: ${(error as Error).message}`)
                console.error('Error importing model:', error)
            } finally {
                setModelImporting(false)
            }
        })
    }

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
    )
}

export default ModelNewMenu
