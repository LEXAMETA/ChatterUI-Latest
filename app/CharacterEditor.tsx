import DropdownSheet from '@components/input/DropdownSheet'
import ThemedCheckbox from '@components/input/ThemedCheckbox'
import ThemedSlider from '@components/input/ThemedSlider'
import ThemedTextInput from '@components/input/ThemedTextInput'
import Alert from '@components/views/Alert'
import FadeDownView from '@components/views/FadeDownView'
import HeaderButton from '@components/views/HeaderButton'
import HeaderTitle from '@components/views/HeaderTitle'
import PopupMenu from '@components/views/PopupMenu'
import TextBoxModal from '@components/views/TextBoxModal'
import { Samplers } from '@lib/constants/SamplerData'
import { APISampler } from '@lib/engine/API/APIBuilder.types'
import { APIState as APIStateNew } from '@lib/engine/API/APIManagerState'
import { localSamplerData } from '@lib/engine/LocalInference'
import { useAppMode } from '@lib/state/AppMode'
import { Logger } from '@lib/state/Logger'
import { SamplersManager } from '@lib/state/SamplerState'
import { Theme } from '@lib/theme/ThemeManager'
import { saveStringToDownload } from '@lib/utils/File'
import { useState } from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'

const SamplerMenu = () => {
    const styles = useStyles()
    const { spacing } = Theme.useTheme()
    const { appMode } = useAppMode()
    const [showNewSampler, setShowNewSampler] = useState<boolean>(false)

    const {
        addSamplerConfig,
        deleteSamplerConfig,
        changeConfig,
        updateCurrentConfig,
        currentConfigIndex,
        currentConfig, // This is `SamplerConfig | undefined`
        configList,
    } = SamplersManager.useSamplers()

    const { apiValues, activeIndex, getTemplates } = APIStateNew.useAPIState((state) => ({
        apiValues: state.values,
        activeIndex: state.activeIndex,
        getTemplates: state.getTemplates,
    }))

    const getSamplerList = (): APISampler[] => {
        if (appMode === 'local') return localSamplerData
        if (activeIndex !== -1) {
            // TS2532: Object is possibly 'undefined'. (on apiValues[activeIndex])
            // Added check for `apiValues[activeIndex]` before accessing `configName`.
            const currentApiConfig = apiValues[activeIndex]
            if (!currentApiConfig) return [] // Guard against undefined config

            const template = getTemplates().find(
                (item) => item.name === currentApiConfig.configName
            )
            if (!template) return []
            return template.request.samplerFields
        }
        return []
    }

    const handleExportSampler = () => {
        // TS18048: 'currentConfig' is possibly 'undefined'.
        // Added check for `currentConfig`
        if (!currentConfig) {
            Logger.errorToast('No sampler configuration to export.')
            return
        }
        saveStringToDownload(
            JSON.stringify(currentConfig.data),
            `${currentConfig.name}.json`,
            'utf8'
        ).then(() => {
            Logger.infoToast('Downloaded Sampler Configuration!')
        })
    }

    const handleImportSampler = () => {
        //TODO : Implement
        Logger.errorToast('Importing Not Implemented')
    }

    const handleDeleteSampler = () => {
        // TS18048: 'currentConfig' is possibly 'undefined'.
        // Added check for `currentConfig`
        if (!currentConfig) {
            Logger.errorToast(`No sampler configuration selected to delete.`)
            return false
        }
        if (configList.length === 1) {
            Logger.errorToast(`Cannot Delete Last Configuration`)
            return false
        }

        Alert.alert({
            title: `Delete Sampler`,
            // TS18048: 'currentConfig' is possibly 'undefined'.
            // Used optional chaining and nullish coalescing for display text.
            description: `Are you sure you want to delete '${currentConfig?.name ?? 'this config'}'?`,
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Delete Sampler',
                    onPress: async () => {
                        deleteSamplerConfig(currentConfigIndex)
                    },
                    type: 'warning',
                },
            ],
        })
        return true
    }

    const headerRight = () => (
        <PopupMenu
            icon="setting"
            iconSize={24}
            placement="bottom"
            options={[
                {
                    label: 'Create Sampler',
                    icon: 'addfile',
                    onPress: (menu) => {
                        setShowNewSampler(true)
                        menu.current?.close()
                    },
                },
                {
                    label: 'Export Sampler',
                    icon: 'download',
                    onPress: (menu) => {
                        handleExportSampler()
                        menu.current?.close()
                    },
                },
                /*{
                    label: 'Import Sampler',
                    icon: 'upload',
                    onPress: (menu) => {
                        handleImportSampler()
                        menu.current?.close()
                    },
                },*/
                {
                    label: 'Delete Sampler',
                    icon: 'delete',
                    onPress: (menu) => {
                        if (handleDeleteSampler()) menu.current?.close()
                    },
                    warning: true,
                },
            ]}
        />
    )

    return (
        <FadeDownView style={{ flex: 1 }}>
            <TextBoxModal
                booleans={[showNewSampler, setShowNewSampler]}
                onConfirm={(text: string) => {
                    if (text === '') {
                        Logger.errorToast(`Sampler name cannot be empty`)
                        return
                    }

                    // TS18048: 'currentConfig' is possibly 'undefined'.
                    // Added check for `currentConfig` before trying to use its `data`.
                    // Also, ensure `item.name` is compared to `text` not `currentConfig.name`
                    for (const item of configList)
                        if (item.name === text) {
                            Logger.errorToast(`Sampler name already exists.`)
                            return
                        }
                    // TS18048: 'currentConfig' is possibly 'undefined'.
                    // Added check for `currentConfig`
                    if (currentConfig) {
                        addSamplerConfig({ name: text, data: currentConfig.data })
                    } else {
                        Logger.errorToast(
                            'Cannot add sampler: No current configuration to copy data from.'
                        )
                    }
                }}
            />

            <HeaderTitle title="Samplers" />
            <HeaderButton headerRight={headerRight} />

            <DropdownSheet
                containerStyle={{ marginHorizontal: spacing.xl, paddingVertical: spacing.m }}
                selected={currentConfig} // `currentConfig` can be `undefined`, which `selected` prop should handle.
                data={configList}
                onChangeValue={(item) => {
                    // TS18048: 'currentConfig' is possibly 'undefined'.
                    // Added check for `currentConfig`
                    if (currentConfig && item.name === currentConfig.name) return
                    changeConfig(configList.indexOf(item))
                }}
                labelExtractor={(item) => item.name}
            />

            <ScrollView contentContainerStyle={styles.scrollContainer}>
                {/* TS18048: 'currentConfig' is possibly 'undefined'. */}
                {currentConfig && // Render content only if currentConfig is defined
                    getSamplerList().map((item, index) => {
                        const samplerItem = Samplers?.[item.samplerID] // Optional chaining for Samplers
                        if (!samplerItem)
                            return (
                                <Text key={item.samplerID} style={styles.unsupported}>
                                    Sampler ID {`[${item.samplerID}]`} Not Supported
                                </Text>
                            )
                        switch (samplerItem.inputType) {
                            case 'slider':
                                return (
                                    (samplerItem.values.type === 'float' ||
                                        samplerItem.values.type === 'integer') && (
                                        <ThemedSlider
                                            key={item.samplerID}
                                            // TS2532: Object is possibly 'undefined'. (on currentConfig.data)
                                            // currentConfig is guaranteed by the outer `currentConfig &&`
                                            // But `currentConfig.data` might be implicitly `any` or `Record<string, any>`
                                            // which makes indexing unsafe without assertion or type refinement.
                                            // Added `as number` assertion, assuming it's correct from context.
                                            value={
                                                currentConfig.data[samplerItem.internalID] as number
                                            }
                                            onValueChange={(value) => {
                                                updateCurrentConfig({
                                                    ...currentConfig,
                                                    data: {
                                                        ...currentConfig.data,
                                                        [samplerItem.internalID]: value,
                                                    },
                                                })
                                            }}
                                            label={samplerItem.friendlyName}
                                            min={samplerItem.values.min}
                                            max={samplerItem.values.max}
                                            step={samplerItem.values.step}
                                            precision={samplerItem.values.precision ?? 2}
                                        />
                                    )
                                )
                            case 'checkbox':
                                return (
                                    <ThemedCheckbox
                                        // TS2532: Object is possibly 'undefined'. (on currentConfig.data)
                                        // Added `as boolean` assertion.
                                        value={currentConfig.data[item.samplerID] as boolean}
                                        key={item.samplerID}
                                        onChangeValue={(b) => {
                                            updateCurrentConfig({
                                                ...currentConfig,
                                                data: {
                                                    ...currentConfig.data,
                                                    [samplerItem.internalID]: b,
                                                },
                                            })
                                        }}
                                        label={samplerItem.friendlyName}
                                    />
                                )
                            case 'textinput':
                                return (
                                    <ThemedTextInput
                                        key={item.samplerID}
                                        // TS2532: Object is possibly 'undefined'. (on currentConfig.data)
                                        // Added `as string` assertion.
                                        value={currentConfig.data[item.samplerID] as string}
                                        onChangeText={(text) => {
                                            updateCurrentConfig({
                                                ...currentConfig,
                                                data: {
                                                    ...currentConfig.data,
                                                    [item.samplerID]: text,
                                                },
                                            })
                                        }}
                                        label={samplerItem.friendlyName}
                                    />
                                )
                            //case 'custom':
                            default:
                                return (
                                    <Text key={item.samplerID} style={styles.warningText}>
                                        Invalid Sampler Field!
                                    </Text>
                                )
                        }
                    })}
            </ScrollView>
        </FadeDownView>
    )
}

export default SamplerMenu

const useStyles = () => {
    const { color, spacing } = Theme.useTheme()
    return StyleSheet.create({
        scrollContainer: {
            paddingHorizontal: spacing.xl,
            paddingVertical: spacing.xl2,
            rowGap: spacing.xl,
        },

        dropdownContainer: {
            marginHorizontal: spacing.xl,
        },

        button: {
            padding: spacing.s,
            borderRadius: spacing.s,
            marginLeft: spacing.m,
        },

        warningText: {
            color: color.text._100,
            backgroundColor: color.error._500,
            padding: spacing.m,
            margin: spacing.xl,
            borderRadius: spacing.m,
        },

        unsupported: {
            color: color.text._400,
            textAlign: 'center',
            paddingVertical: spacing.m,
            marginVertical: spacing.m,
            borderRadius: spacing.m,
        },
    })
}
