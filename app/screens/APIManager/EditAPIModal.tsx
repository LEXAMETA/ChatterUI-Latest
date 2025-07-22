// app/screens/APIManager/EditAPIModal.tsx

import HeartbeatButton from '@components/buttons/HeartbeatButton'
import ThemedButton from '@components/buttons/ThemedButton'
import DropdownSheet from '@components/input/DropdownSheet'
import MultiDropdownSheet from '@components/input/MultiDropdownSheet'
import ThemedTextInput from '@components/input/ThemedTextInput'
import FadeBackrop from '@components/views/FadeBackdrop'
import { CLAUDE_VERSION } from '@lib/constants/GlobalValues'
import { APIConfiguration } from '@lib/engine/API/APIBuilder.types'
import { APIManagerValue, APIState } from '@lib/engine/API/APIManagerState'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'
import React, { useEffect, useState } from 'react'
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, { SlideOutDown } from 'react-native-reanimated'

type EditAPIModalProps = {
    index: number
    show: boolean
    close: () => void
    originalValues: APIManagerValue
}

const EditAPIModal: React.FC<EditAPIModalProps> = ({ index, show, close, originalValues }) => {
    const { color, spacing, fontSize } = Theme.useTheme()
    const styles = useStyles()

    const { getTemplates, editValue } = APIState.useAPIState((state) => ({
        getTemplates: state.getTemplates,
        editValue: state.editValue,
    }))

    const [template, setTemplate] = useState<APIConfiguration | null>(getTemplates()[0] ?? null)
    const [values, setValues] = useState<APIManagerValue>(originalValues)
    const [modelList, setModelList] = useState<any[]>([])
    const [modelListLoading, setModelListLoading] = useState(false)
    const [modelListError, setModelListError] = useState<string | null>(null)

    useEffect(() => {
        setValues(originalValues)
    }, [originalValues])

    useEffect(() => {
        const newTemplate = getTemplates().find((item) => item.name === values.configName)
        if (!newTemplate) {
            Logger.errorToast('Could not get valid template!')
            close()
            return
        }
        setTemplate(newTemplate)
    }, [values.configName, getTemplates, close])

    const handleGetModelList = async () => {
        if (!template?.features.useModel || !show) return

        setModelListLoading(true)
        setModelListError(null)
        try {
            const auth: any = {}
            if (template.features.useKey) {
                auth[template.request.authHeader] = template.request.authPrefix + values.key
                if (template.name === 'Claude') {
                    auth['anthropic-version'] = CLAUDE_VERSION
                }
            }
            const result = await fetch(values.modelEndpoint, { headers: { ...auth } })
            const data = await result.json()
            if (result.status !== 200) {
                setModelListError(data?.error?.message ?? 'Error retrieving models')
                return
            }
            const models = getNestedValue(data, template.model.modelListParser)
            setModelList(models ?? [])
        } catch (e: any) {
            setModelListError(e.message ?? 'Unexpected error')
        } finally {
            setModelListLoading(false)
        }
    }

    useEffect(() => {
        if (show) {
            handleGetModelList()
        }
    }, [show, template])

    if (!template) {
        return (
            <Modal visible={show} transparent animationType="fade">
                <FadeBackrop handleOverlayClick={close} />
                <View style={{ flex: 1 }} />
                <Animated.View style={styles.mainContainer} exiting={SlideOutDown.duration(300)}>
                    <Text style={{ color: color.text._100, fontSize: fontSize.xl }}>
                        Could not load template configuration.
                    </Text>
                    <ThemedButton label="Close" onPress={close} />
                </Animated.View>
            </Modal>
        )
    }

    return (
        <Modal
            visible={show}
            transparent
            onRequestClose={close}
            statusBarTranslucent
            animationType="fade">
            <FadeBackrop handleOverlayClick={close} />
            <ScrollView
                contentContainerStyle={styles.scrollContainer}
                showsVerticalScrollIndicator={false}>
                <Animated.View style={styles.mainContainer} exiting={SlideOutDown.duration(300)}>
                    <Text
                        style={{
                            color: color.text._100,
                            fontSize: fontSize.xl2,
                            fontWeight: '500',
                            paddingBottom: spacing.xl2,
                        }}>
                        Edit Connection
                    </Text>

                    <ThemedTextInput
                        label="Friendly Name"
                        value={values.friendlyName}
                        onChangeText={(val: string) => setValues({ ...values, friendlyName: val })}
                    />

                    {template.ui.editableCompletionPath && (
                        <View>
                            <ThemedTextInput
                                label="Completion URL"
                                value={values.endpoint}
                                onChangeText={(val: string) =>
                                    setValues({ ...values, endpoint: val })
                                }
                            />
                            <Text style={styles.hintText}>Note: Use full URL path</Text>
                        </View>
                    )}

                    {template.ui.editableModelPath && (
                        <View>
                            <ThemedTextInput
                                label="Model URL"
                                value={values.modelEndpoint}
                                onChangeText={(val: string) =>
                                    setValues({ ...values, modelEndpoint: val })
                                }
                            />
                            <HeartbeatButton
                                api={values.modelEndpoint ?? ''}
                                apiFormat={(s) => s}
                                headers={
                                    template.features.useKey
                                        ? {
                                              [template.request.authHeader]:
                                                  template.request.authPrefix + values.key,
                                          }
                                        : {}
                                }
                                callback={handleGetModelList}
                            />
                        </View>
                    )}

                    {template.features.useKey && (
                        <ThemedTextInput
                            secureTextEntry
                            label="API Key"
                            value={values.key}
                            onChangeText={(val: string) => setValues({ ...values, key: val })}
                        />
                    )}

                    {template.features.useModel && (
                        <View style={{ rowGap: 4 }}>
                            <Text style={styles.title}>Model</Text>

                            {modelListLoading && (
                                <Text style={styles.hintText}>Loading models...</Text>
                            )}
                            {modelListError && (
                                <Text style={[styles.hintText, { color: color.error._500 }]}>
                                    {modelListError}
                                </Text>
                            )}

                            <View
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    columnGap: 8,
                                }}>
                                {!template.features.multipleModels ? (
                                    <DropdownSheet
                                        containerStyle={{ flex: 1 }}
                                        selected={values.model}
                                        data={modelList}
                                        labelExtractor={(v) =>
                                            getNestedValue(v, template.model.nameParser)
                                        }
                                        onChangeValue={(item) =>
                                            setValues({ ...values, model: item })
                                        }
                                        search={modelList.length > 10}
                                        modalTitle="Select Model"
                                    />
                                ) : (
                                    <MultiDropdownSheet
                                        containerStyle={{ flex: 1 }}
                                        selected={values?.model ?? []}
                                        data={modelList}
                                        labelExtractor={(v) =>
                                            getNestedValue(v, template.model.nameParser)
                                        }
                                        onChangeValue={(item) =>
                                            setValues({ ...values, model: item })
                                        }
                                        search={modelList.length > 10}
                                        modalTitle="Select Model"
                                    />
                                )}
                                <ThemedButton
                                    onPress={handleGetModelList}
                                    iconName="reload1"
                                    iconSize={18}
                                    variant="secondary"
                                />
                            </View>
                        </View>
                    )}

                    {template.features.useFirstMessage && (
                        <View>
                            <ThemedTextInput
                                label="First Message"
                                value={values.firstMessage}
                                onChangeText={(val: string) =>
                                    setValues({ ...values, firstMessage: val })
                                }
                            />
                            <Text style={styles.hintText}>
                                Default first message sent to Claude
                            </Text>
                        </View>
                    )}

                    {template.features.usePrefill && (
                        <View>
                            <ThemedTextInput
                                label="Prefill"
                                value={values.prefill}
                                onChangeText={(val: string) =>
                                    setValues({ ...values, prefill: val })
                                }
                            />
                            <Text style={styles.hintText}>Prefill before model response</Text>
                        </View>
                    )}

                    <ThemedButton
                        buttonStyle={{ marginTop: 8 }}
                        label="Save Changes"
                        onPress={() => {
                            editValue(values, index)
                            close()
                        }}
                    />
                </Animated.View>
            </ScrollView>
        </Modal>
    )
}

export default EditAPIModal

const useStyles = () => {
    const { color, spacing, borderRadius } = Theme.useTheme()
    return StyleSheet.create({
        mainContainer: {
            marginVertical: spacing.xl,
            paddingVertical: spacing.xl2,
            paddingHorizontal: spacing.xl,
            borderTopLeftRadius: borderRadius.xl,
            borderTopRightRadius: borderRadius.xl,
            minHeight: '70%',
            backgroundColor: color.neutral._100,
        },
        scrollContainer: {
            flexGrow: 1,
            justifyContent: 'center',
        },
        title: {
            color: color.text._100,
        },
        hintText: {
            marginTop: spacing.s,
            color: color.text._400,
        },
    })
}

/**
 * Safely retrieves a nested value from an object by dot-separated path.
 */
const getNestedValue = (obj: any, path: string) => {
    if (!path) return obj
    const keys = path.split('.')
    const value = keys.reduce((acc, key) => acc?.[key], obj)
    return value ?? null
}
