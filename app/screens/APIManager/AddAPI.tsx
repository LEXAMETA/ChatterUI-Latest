import HeartbeatButton from '@components/buttons/HeartbeatButton'
import ThemedButton from '@components/buttons/ThemedButton'
import DropdownSheet from '@components/input/DropdownSheet'
import MultiDropdownSheet from '@components/input/MultiDropdownSheet'
import ThemedTextInput from '@components/input/ThemedTextInput'
import { CLAUDE_VERSION } from '@lib/constants/GlobalValues'
import { APIConfiguration } from '@lib/engine/API/APIBuilder.types'
import { APIManagerValue, APIState } from '@lib/engine/API/APIManagerState'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'
import { Stack, useRouter } from 'expo-router'
import React, { useEffect, useState, useCallback } from 'react' // <--- Add useCallback
import { ScrollView, StyleSheet, Text, View } from 'react-native'

const AddAPI = () => {
    const styles = useStyles()
    const router = useRouter()
    const { addValue, getTemplates } = APIState.useAPIState((state) => ({
        getTemplates: state.getTemplates,
        addValue: state.addValue,
    }))

    const [template, setTemplate] = useState<APIConfiguration | undefined>(getTemplates()[0])

    const [values, setValues] = useState<APIManagerValue>(
        template
            ? {
                  ...template.defaultValues,
                  configName: template.name,
                  friendlyName: 'New API',
                  active: true,
              }
            : {
                  friendlyName: 'New API',
                  active: true,
                  configName: 'Default',
                  endpoint: '',
                  modelEndpoint: '',
                  key: '',
                  model: undefined,
                  firstMessage: '',
                  prefill: '',
              }
    )

    const [modelList, setModelList] = useState<any[]>([])

    // Wrap handleGetModelList in useCallback
    const handleGetModelList = useCallback(async () => {
        if (!template) {
            Logger.errorToast('No template selected')
            return
        }
        if (!template.features.useModel) return

        const auth: any = {}
        if (template.features.useKey) {
            // These dependencies (template.request.authHeader, template.request.authPrefix, values.key, template.name, CLAUDE_VERSION)
            // are now implicitly part of useCallback's dependencies due to its closure over the component's scope.
            auth[template.request.authHeader] = template.request.authPrefix + values.key
            if (template.name === 'Claude') {
                auth['anthropic-version'] = CLAUDE_VERSION
            }
        }

        try {
            const result = await fetch(values.modelEndpoint, { headers: { ...auth } }) // values.modelEndpoint is a dependency
            const data = await result.json()
            if (result.status !== 200) {
                Logger.error(`Could not retrieve models: ${data?.error?.message}`)
                return
            }
            const models = getNestedValue(data, template.model.modelListParser) // template.model.modelListParser is a dependency
            if (!Array.isArray(models)) {
                Logger.warn('Could not parse models!')
                Logger.error(
                    models === undefined
                        ? 'Models resulted in undefined value'
                        : 'Models resulted in a non-array value; modelListParser likely incorrect.'
                )
                return
            }
            setModelList(models) // setModelList is a dependency
        } catch (e) {
            Logger.error(`Failed to fetch model list: ${String(e)}`) // Logger is a dependency
        }
    }, [
        template, // template is already in the useEffect, and now in useCallback
        values.key, // Add values.key
        values.modelEndpoint, // Add values.modelEndpoint
        // Although getNestedValue, CLAUDE_VERSION, Logger are not directly state/props,
        // if they are truly stable (e.g., constants, or pure functions defined outside the component),
        // they don't *strictly* need to be in `useCallback`'s deps for stability,
        // but ESLint often prefers them there if used.
        // However, for compiler purposes, the critical ones are `values` and `template` derivatives.
        // `getNestedValue` is a pure function, so it's fine outside deps.
        // `Logger` is an object from a module, generally stable.
        // `CLAUDE_VERSION` is a constant, stable.
    ])

    useEffect(() => {
        // Remove the eslint-disable-next-line comment
        handleGetModelList()
    }, [handleGetModelList]) // Now depend on the stable handleGetModelList

    // ... (rest of your component code)

    return (
        <View style={styles.mainContainer}>
            <Stack.Screen options={{ title: 'Add Connection' }} />
            <ScrollView
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ rowGap: 16, paddingBottom: 24 }}>
                <DropdownSheet
                    style={{ marginBottom: 8 }}
                    data={getTemplates()}
                    labelExtractor={(t) => t.name}
                    selected={template}
                    onChangeValue={(item) => {
                        setTemplate(item)
                        setModelList([])
                        setValues({
                            ...item.defaultValues,
                            friendlyName: values.friendlyName, // Make sure `values.friendlyName` is intended here
                            active: true,
                            configName: item.name,
                            model: undefined,
                        })
                    }}
                    modalTitle="Select Connection Type"
                    search
                />

                <ThemedTextInput
                    label="Friendly Name"
                    value={values.friendlyName}
                    onChangeText={(value) => setValues({ ...values, friendlyName: value })}
                />

                {template?.ui.editableCompletionPath && (
                    <View>
                        <ThemedTextInput
                            label="Completion URL"
                            value={values.endpoint}
                            onChangeText={(value) => setValues({ ...values, endpoint: value })}
                        />
                        <Text style={styles.hintText}>Note: Use full URL path</Text>
                    </View>
                )}

                {template?.ui.editableModelPath && (
                    <View>
                        <ThemedTextInput
                            label="Model URL"
                            value={values.modelEndpoint}
                            onChangeText={(value) => setValues({ ...values, modelEndpoint: value })}
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
                            callback={handleGetModelList} // This is good, it uses the stable callback
                        />
                    </View>
                )}

                {template?.features.useKey && (
                    <ThemedTextInput
                        label="API Key"
                        secureTextEntry
                        value={values.key}
                        onChangeText={(value) => setValues({ ...values, key: value })}
                    />
                )}

                {template?.features.useModel && (
                    <View>
                        <Text style={styles.title}>Model</Text>
                        <View
                            style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                columnGap: 8,
                                marginTop: 8,
                            }}>
                            {!template.features.multipleModels && (
                                <DropdownSheet
                                    containerStyle={{ flex: 1 }}
                                    selected={values.model}
                                    data={modelList}
                                    labelExtractor={(value) =>
                                        getNestedValue(value, template.model.nameParser)
                                    }
                                    onChangeValue={(item) => setValues({ ...values, model: item })}
                                    search={modelList.length > 10}
                                    modalTitle="Select Model"
                                />
                            )}
                            {template.features.multipleModels && (
                                <MultiDropdownSheet
                                    containerStyle={{ flex: 1 }}
                                    selected={values?.model ?? []}
                                    data={modelList}
                                    labelExtractor={(value) =>
                                        getNestedValue(value, template.model.nameParser)
                                    }
                                    onChangeValue={(item) => setValues({ ...values, model: item })}
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

                {template?.features.useFirstMessage && (
                    <View>
                        <ThemedTextInput
                            label="First Message"
                            value={values.firstMessage}
                            onChangeText={(value) => setValues({ ...values, firstMessage: value })}
                        />
                        <Text style={styles.hintText}>Default first message sent to Claude</Text>
                    </View>
                )}
                {template?.features.usePrefill && (
                    <View>
                        <ThemedTextInput
                            label="Prefill"
                            value={values.prefill}
                            onChangeText={(value) => setValues({ ...values, prefill: value })}
                        />
                        <Text style={styles.hintText}>Prefill before model response</Text>
                    </View>
                )}
            </ScrollView>
            <ThemedButton
                label="Create API"
                onPress={() => {
                    addValue(values)
                    router.back()
                }}
            />
        </View>
    )
}

export default AddAPI

const useStyles = () => {
    const { color, spacing } = Theme.useTheme()
    return StyleSheet.create({
        mainContainer: {
            marginVertical: spacing.xl,
            paddingVertical: spacing.xl,
            paddingHorizontal: spacing.xl,
            flex: 1,
        },

        title: {
            paddingTop: spacing.m,
            color: color.text._100,
            fontSize: spacing.xl,
        },

        hintText: {
            marginTop: spacing.s,
            color: color.text._400,
        },

        modelInfo: {
            borderRadius: spacing.m,
            backgroundColor: color.neutral._200,
            flex: 1,
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.l,
            paddingBottom: spacing.xl2,
        },
    })
}

const getNestedValue = (obj: any, path: string) => {
    if (path === '') return obj
    const keys = path.split('.')
    const value = keys.reduce((acc, key) => acc?.[key], obj)
    return value ?? null
}
