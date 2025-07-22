import DropdownSheet from '@components/input/DropdownSheet'
import ThemedCheckbox from '@components/input/ThemedCheckbox'
import ThemedSlider from '@components/input/ThemedSlider'
import ThemedTextInput from '@components/input/ThemedTextInput'
import Alert from '@components/views/Alert'
import FadeDownView from '@components/views/FadeDownView'
import HeaderButton from '@components/views/HeaderButton'
import HeaderTitle from '@components/views/HeaderTitle'
import PopupMenu, { PopupMenuHandle } from '@components/views/PopupMenu' // import PopupMenuHandle here
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
import React, { useState } from 'react' // Ensure React is imported
import { RefObject } from 'react' // Import RefObject
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
        currentConfig,
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
            const currentApiValue = apiValues[activeIndex]
            if (!currentApiValue) {
                console.warn('API value at activeIndex is undefined.')
                return []
            }
            const template = getTemplates().find((item) => item.name === currentApiValue.configName)
            if (!template) return []
            return template.request.samplerFields
        }
        return []
    }

    const handleExportSampler = () => {
        if (!currentConfig) {
            Logger.errorToast('No sampler configuration selected to export.')
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
        Logger.errorToast('Importing Not Implemented')
    }

    const handleDeleteSampler = () => {
        if (configList.length === 1) {
            Logger.errorToast('Cannot Delete Last Configuration')
            return false
        }
        if (!currentConfig) {
            Logger.errorToast('No sampler configuration selected to delete.')
            return false
        }

        Alert.alert({
            title: 'Delete Sampler',
            description: `Are you sure you want to delete '${currentConfig.name}'?`,
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
                    onPress: (menuRef: RefObject<PopupMenuHandle>) => {
                        // FIX: Changed parameter type
                        setShowNewSampler(true)
                        menuRef.current?.close() // FIX: Access .current
                    },
                },
                {
                    label: 'Export Sampler',
                    icon: 'download',
                    onPress: (menuRef: RefObject<PopupMenuHandle>) => {
                        // FIX: Changed parameter type
                        handleExportSampler()
                        menuRef.current?.close() // FIX: Access .current
                    },
                },
                /*
        {
          label: 'Import Sampler',
          icon: 'upload',
          onPress: (menuRef: RefObject<PopupMenuHandle>) => { // FIX: Changed parameter type
            handleImportSampler()
            menuRef.current?.close() // FIX: Access .current
          },
        },
        */
                {
                    label: 'Delete Sampler',
                    icon: 'delete',
                    onPress: (menuRef: RefObject<PopupMenuHandle>) => {
                        // FIX: Changed parameter type
                        if (handleDeleteSampler()) menuRef.current?.close() // FIX: Access .current
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
                        Logger.errorToast('Sampler name cannot be empty')
                        return
                    }
                    for (const item of configList) {
                        if (item.name === text) {
                            Logger.errorToast('Sampler name already exists.')
                            return
                        }
                    }
                    if (!currentConfig) {
                        Logger.errorToast(
                            'Cannot add new sampler: current configuration is not loaded.'
                        )
                        return
                    }
                    addSamplerConfig({ name: text, data: currentConfig.data })
                }}
            />
            <HeaderTitle title="Samplers" />
            <HeaderButton headerRight={headerRight} />

            {currentConfig && (
                <DropdownSheet
                    containerStyle={{ marginHorizontal: spacing.xl, paddingVertical: spacing.m }}
                    selected={currentConfig}
                    data={configList}
                    onChangeValue={(item) => {
                        if (item.name === currentConfig.name) return
                        changeConfig(configList.indexOf(item))
                    }}
                    labelExtractor={(item) => item.name}
                />
            )}

            <ScrollView contentContainerStyle={styles.scrollContainer}>
                {currentConfig &&
                    getSamplerList().map((item) => {
                        const samplerItem = Samplers?.[item.samplerID]
                        if (!samplerItem)
                            return (
                                <Text style={styles.unsupported} key={item.samplerID}>
                                    Sampler ID {`[${item.samplerID}]`} Not Supported
                                </Text>
                            )
                        switch (samplerItem.inputType) {
                            case 'slider':
                                if (
                                    samplerItem.values.type === 'float' ||
                                    samplerItem.values.type === 'integer'
                                ) {
                                    return (
                                        <ThemedSlider
                                            key={item.samplerID}
                                            value={
                                                currentConfig.data[samplerItem.internalID] as number
                                            }
                                            onValueChange={(value) =>
                                                updateCurrentConfig({
                                                    ...currentConfig,
                                                    data: {
                                                        ...currentConfig.data,
                                                        [samplerItem.internalID]: value,
                                                    },
                                                })
                                            }
                                            label={samplerItem.friendlyName}
                                            min={samplerItem.values.min}
                                            max={samplerItem.values.max}
                                            step={samplerItem.values.step}
                                            precision={samplerItem.values.precision ?? 2}
                                        />
                                    )
                                }
                                return null
                            case 'checkbox':
                                return (
                                    <ThemedCheckbox
                                        key={item.samplerID}
                                        value={currentConfig.data[item.samplerID] as boolean}
                                        onChangeValue={(b) =>
                                            updateCurrentConfig({
                                                ...currentConfig,
                                                data: {
                                                    ...currentConfig.data,
                                                    [samplerItem.internalID]: b,
                                                },
                                            })
                                        }
                                        label={samplerItem.friendlyName}
                                    />
                                )
                            case 'textinput':
                                return (
                                    <ThemedTextInput
                                        key={item.samplerID}
                                        value={currentConfig.data[item.samplerID] as string}
                                        onChangeText={(text) =>
                                            updateCurrentConfig({
                                                ...currentConfig,
                                                data: {
                                                    ...currentConfig.data,
                                                    [item.samplerID]: text,
                                                },
                                            })
                                        }
                                        label={samplerItem.friendlyName}
                                    />
                                )
                            default:
                                return (
                                    <Text style={styles.warningText} key={item.samplerID}>
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
            backgroundColor: color.neutral._300,
        },
    })
}
