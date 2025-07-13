// app/screens/ModelManager/index.tsx
// (No significant changes needed to this file based on your provided code, beyond ensuring
// ModelSettings receives necessary props to handle RAG model selection internally.
// The RAG model selection UI will move into ModelSettings.tsx)

import ThemedButton from '@components/buttons/ThemedButton'
import HeaderButton from '@components/views/HeaderButton'
import HeaderTitle from '@components/views/HeaderTitle'
import { AntDesign } from '@expo/vector-icons'
import { Llama } from '@lib/engine/Local/LlamaLocal' // Keep this import
import { Model } from '@lib/engine/Local/Model' // Keep this import
import { Theme } from '@lib/theme/ThemeManager'
import { useLiveQuery } from 'drizzle-orm/expo-sqlite'
import { useState } from 'react'
import { StyleSheet, Text, View, FlatList } from 'react-native'
import * as Progress from 'react-native-progress'
import Animated, { Easing, SlideInLeft, SlideOutLeft } from 'react-native-reanimated'

import ModelEmpty from './ModelEmpty'
import ModelItem from './ModelItem'
import ModelNewMenu from './ModelNewMenu'
import ModelSettings from './ModelSettings' // ModelSettings will handle RAG model selection

const ModelManager = () => {
    const styles = useStyles()
    const { color } = Theme.useTheme()

    const { data: models, updatedAt } = useLiveQuery(Model.getModelListQuery()) // Renamed 'data' to 'models' for clarity

    const [showSettings, setShowSettings] = useState(false)

    const [modelLoading, setModelLoading] = useState(false)
    const [modelImporting, setModelImporting] = useState(false)

    // Ensure ModelDataType matches the schema for 'model'
    const { currentChatModel, loadProgress, setloadProgress } = Llama.useLlama((state) => ({
        currentChatModel: state.currentChatModel, // Changed 'model' to 'currentChatModel' as per LlamaLocal.ts
        loadProgress: state.loadProgress,
        setloadProgress: state.setLoadProgress,
    }))

    // No direct RAG model selection UI here. That goes into ModelSettings.
    // We only need to ensure ModelSettings receives the models list and setters.

    return (
        <View style={styles.mainContainer}>
            <HeaderTitle title={showSettings ? 'Model Settings' : 'Models'} />
            <HeaderButton
                headerRight={() =>
                    !showSettings && (
                        <ModelNewMenu
                            modelImporting={modelImporting}
                            setModelImporting={setModelImporting}
                        />
                    )
                }
            />

            {!showSettings && (
                <Animated.View
                    style={{ flex: 1 }}
                    entering={SlideInLeft.easing(Easing.inOut(Easing.cubic))}
                    exiting={SlideOutLeft.easing(Easing.inOut(Easing.cubic))}>
                    <View style={styles.modelContainer}>
                        {!modelImporting && !modelLoading && models.length !== 0 && ( // Use 'models'
                            <View
                                style={{
                                    flexDirection: 'row',
                                }}>
                                <Text style={styles.subtitle}>Model Loaded: </Text>
                                <Text style={styles.modelTitle} ellipsizeMode="tail">
                                    {currentChatModel ? currentChatModel.name : 'None'} {/* Use currentChatModel */}
                                </Text>
                            </View>
                        )}
                        {!modelImporting && !modelLoading && models.length === 0 && updatedAt && ( // Use 'models'
                            <View>
                                <Text style={styles.hint}>
                                    Hint: Press <AntDesign name="addfile" size={16} /> and import a
                                    GGUF model!
                                </Text>
                            </View>
                        )}

                        {!modelLoading && modelImporting && (
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Progress.Bar
                                    style={{ flex: 5 }}
                                    indeterminate
                                    indeterminateAnimationDuration={2000}
                                    color={color.primary._500}
                                    borderColor={color.neutral._300}
                                    height={12}
                                    borderRadius={12}
                                    width={null}
                                />

                                <Text
                                    style={{
                                        flex: 2,
                                        color: color.text._100,
                                        textAlign: 'center',
                                    }}>
                                    Importing...
                                </Text>
                            </View>
                        )}

                        {modelLoading && !modelImporting && (
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Progress.Bar
                                    style={{ flex: 5 }}
                                    progress={loadProgress / 100}
                                    color={color.primary._500}
                                    borderColor={color.neutral._300}
                                    height={12}
                                    borderRadius={12}
                                    width={null}
                                />
                                <Text
                                    style={{
                                        flex: 1,
                                        color: color.text._100,
                                        textAlign: 'center',
                                    }}>
                                    {loadProgress}%
                                </Text>
                            </View>
                        )}
                    </View>

                    {models.length === 0 && updatedAt && <ModelEmpty />} {/* Use 'models' */}

                    <FlatList
                        style={styles.list}
                        data={models} // Use 'models'
                        renderItem={({ item, index }) => (
                            <ModelItem
                                item={item}
                                index={index}
                                modelLoading={modelLoading}
                                setModelLoading={(b: boolean) => {
                                    if (b) setloadProgress(0)
                                    setModelLoading(b)
                                }}
                                modelImporting={modelImporting}
                                // Pass currentChatModel and loadCurrentChatModel to ModelItem if it handles loading
                                // This is crucial for ModelItem to know if it's the active chat model
                                currentChatModel={currentChatModel}
                                loadCurrentChatModel={Llama.useLlama.getState().loadCurrentChatModel} // Directly get the function
                            />
                        )}
                        keyExtractor={(item) => item.id.toString()}
                        removeClippedSubviews={false}
                        showsVerticalScrollIndicator={false}
                    />
                </Animated.View>
            )}

            {showSettings && (
                <ModelSettings
                    modelImporting={modelImporting}
                    modelLoading={modelLoading}
                    exit={() => setShowSettings(false)}
                    models={models} // Pass the list of all models to ModelSettings
                    // Pass the setters for RAG models if ModelSettings needs to call them
                    setEmbeddingModelId={Llama.useEngineData.getState().setEmbeddingModelId}
                    setRagReasoningModelId={Llama.useEngineData.getState().setRagReasoningModelId}
                    // Pass current RAG model IDs to ModelSettings so it can display them
                    embeddingModelId={Llama.useEngineData.getState().embeddingModelId}
                    ragReasoningModelId={Llama.useEngineData.getState().ragReasoningModelId}
                />
            )}
            <ThemedButton
                label={showSettings ? 'Back To Models' : 'Show Settings'}
                onPress={() => setShowSettings(!showSettings)}
            />
        </View>
    )
}

export default ModelManager

export const useStyles = () => {
    const { color, spacing, borderRadius, fontSize } = Theme.useTheme()

    return StyleSheet.create({
        mainContainer: {
            paddingTop: spacing.xl,
            paddingHorizontal: spacing.xl,
            paddingBottom: spacing.xl2,
            flex: 1,
        },

        list: {
            flex: 1,
        },

        modelContainer: {
            borderRadius: borderRadius.l,
            paddingVertical: spacing.l,
            paddingHorizontal: spacing.xl2,
            backgroundColor: color.neutral._200,
            marginBottom: spacing.l,
        },

        title: {
            fontSize: fontSize.l,
            color: color.text._100,
        },

        modelTitle: {
            color: color.primary._700,
        },

        subtitle: {
            color: color.text._300,
        },

        hint: {
            color: color.text._400,
        },
    })
}
