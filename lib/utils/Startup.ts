import { Model } from '@lib/engine/Local/Model'
import { useAppModeState } from '@lib/state/AppMode'
import { Instructs } from '@lib/state/Instructs'
import { SamplersManager } from '@lib/state/SamplerState'
import { useTTSState } from '@lib/state/TTS'
import { getCpuFeatures } from 'cui-llama.rn'
import { DeviceType, getDeviceTypeAsync } from 'expo-device'
import {
    deleteAsync,
    documentDirectory,
    makeDirectoryAsync,
    readAsStringAsync,
    readDirectoryAsync,
} from 'expo-file-system'
import { router } from 'expo-router'
import { setBackgroundColorAsync } from 'expo-system-ui'
import { z } from 'zod'

import { AppDirectory } from './File'
import { lockScreenOrientation } from './Screen'
import { AppSettings, AppSettingsDefault, Global } from '../constants/GlobalValues'
import { useLlama } from '../engine/Local/LlamaLocal' // useLlama for state management
import { Characters } from '../state/Characters'
import { Chats } from '../state/Chat'
import { useEngineData } from '../state/EngineData' // <--- Added this import, assuming it's missing if you're not seeing it from previous outputs
import { Logger } from '../state/Logger'
import { mmkv } from '../storage/MMKV'
import { Theme } from '../theme/ThemeManager'

export const loadChatOnInit = async (): Promise<void> => {
    try {
        if (!mmkv.getBoolean(AppSettings.ChatOnStartup)) return
        const newestChat = await Chats.db.query.chatNewest()
        if (!newestChat) return
        await Characters.useCharacterCard.getState().setCard(newestChat.character_id)
        await Chats.useChatState.getState().load(newestChat.id)
        router.push('/screens/ChatMenu')
    } catch (error) {
        Logger.error('Failed to load chat on init: ' + (error as Error).message)
    }
}

const setAppDefaultSettings = (): void => {
    Object.keys(AppSettingsDefault).forEach((item) => {
        if (mmkv.getBoolean(item) !== undefined) return

        if (item === AppSettings.UnlockOrientation) {
            getDeviceTypeAsync()
                .then((result) => {
                    mmkv.set(item, result === DeviceType.TABLET)
                })
                .catch((err) => {
                    Logger.error('Failed to get device type: ' + err.message)
                })
        } else {
            mmkv.set(item, AppSettingsDefault[item as AppSettings])
        }
    })
}

const createDefaultCard = async (): Promise<void> => {
    try {
        if (!mmkv.getBoolean(AppSettings.CreateDefaultCard)) return
        const existingCards = await Characters.db.query.cardList('character')
        if (existingCards.length === 0) {
            await Characters.createDefaultCard()
        }
        mmkv.set(AppSettings.CreateDefaultCard, false)
    } catch (error) {
        Logger.error('Failed to create default card: ' + (error as Error).message)
    }
}

const setCPUFeatures = async (): Promise<void> => {
    try {
        if (mmkv.getString(Global.CpuFeatures)) return
        const features = getCpuFeatures()
        mmkv.set(Global.CpuFeatures, JSON.stringify(features))
    } catch (error) {
        Logger.error('Failed to set CPU features: ' + (error as Error).message)
    }
}

const migrateModelData_0_7_10_to_0_8_0 = (): void => {
    const oldDef = `localmodel`
    try {
        const modelRaw = mmkv.getString(oldDef)
        if (modelRaw) JSON.parse(modelRaw)
    } catch {
        Logger.warn('Model could not be parsed, resetting')
        mmkv.delete(oldDef)
    }
}

const migrateModelData_0_8_4_to_0_8_5 = (): void => {
    const oldDef = `localmodel`
    try {
        const modelData = mmkv.getString(oldDef)
        if (!modelData) return
        const data = JSON.parse(modelData)
        if (!data) return
        mmkv.delete(oldDef)

        // Fix: Changed back to useEngineData as 'setLastModelLoaded' is on that store
        useEngineData.getState().setLastModelLoaded(data)
    } catch (error) {
        Logger.error('Failed migrating model data from 0.8.4 to 0.8.5: ' + (error as Error).message)
    }
}

const migrateTTSData_0_8_5_to_0_8_6 = (): void => {
    try {
        if (mmkv.getBoolean('ttsauto')) {
            mmkv.delete('ttsauto')
            useTTSState.getState().setAuto(true)
        }
        if (mmkv.getBoolean('ttsenable')) {
            mmkv.delete('ttsenable')
            useTTSState.getState().setEnabled(true)
        }
        const speakerData = mmkv.getString('ttsspeaker')
        if (!speakerData) return

        mmkv.delete('ttsspeaker')
        try {
            const voiceData = JSON.parse(speakerData)
            const voiceSchema = z.object({
                identifier: z.string(),
                name: z.string(),
                quality: z.enum(['Default', 'Enhanced']),
                language: z.string(),
            })
            const result = voiceSchema.safeParse(voiceData)
            if (result.success) {
                useTTSState.getState().setVoice(voiceData)
            } else {
                throw new Error('Schema validation failed')
            }
        } catch {
            Logger.error('Failed to migrate voice from 0.8.5 to 0.8.6 due to schema validation')
        }
    } catch (error) {
        Logger.error('Failed migrating TTS data from 0.8.5 to 0.8.6: ' + (error as Error).message)
    }
}

export const generateDefaultDirectories = async (): Promise<void> => {
    await Promise.all(
        Object.values(AppDirectory).map(async (dir) => {
            try {
                await makeDirectoryAsync(dir)
                Logger.info(
                    // Fix: Added non-null assertion '!' to documentDirectory
                    `Successfully made directory: ${dir.replace(documentDirectory!, '')}`
                )
            } catch {
                // Ignoring mkdir errors silently as before
            }
        })
    )
}

const migratePresets_0_8_3_to_0_8_4 = async (): Promise<void> => {
    const presetDir = `${documentDirectory}presets`
    try {
        const files = await readDirectoryAsync(presetDir)
        if (files.length === 0) return

        await Promise.all(
            files.map(async (item) => {
                try {
                    const dataStr = await readAsStringAsync(`${presetDir}/${item}`)
                    SamplersManager.useSamplerState.getState().addSamplerConfig({
                        data: JSON.parse(dataStr),
                        name: item.replace('.json', ''),
                    })
                } catch (innerError) {
                    Logger.error(
                        `Failed to migrate preset ${item}: ${(innerError as Error).message}`
                    )
                }
            })
        )
        await deleteAsync(presetDir)
    } catch (error) {
        Logger.error('Failed to migrate presets from 0.8.3 to 0.8.4: ' + (error as Error).message)
    }
}

const migrateAppMode_0_8_5_to_0_8_6 = (): void => {
    try {
        const oldKey = 'appmode'
        const oldAppMode = mmkv.getString(oldKey)
        if (!oldAppMode) return

        if (oldAppMode === 'local' || oldAppMode === 'remote') {
            useAppModeState.getState().setAppMode(oldAppMode)
        }
        mmkv.delete(oldKey)
        Logger.warn('Migrated appmode from 0.8.5 to 0.8.6')
    } catch (error) {
        Logger.error('Failed migrating app mode from 0.8.5 to 0.8.6: ' + (error as Error).message)
    }
}

const createDefaultUserData = async (): Promise<void> => {
    try {
        const id = await Characters.db.mutate.createCard('User', 'user')
        Characters.useUserCard.getState().setCard(id)
    } catch (error) {
        Logger.error('Failed creating default user data: ' + (error as Error).message)
    }
}

const setDefaultCharacter = async (): Promise<void> => {
    try {
        const userList = await Characters.db.query.cardList('user')
        if (!userList) {
            Logger.error(
                'User database is Invalid, this should not happen! Please report this occurrence.'
            )
            return
        }
        if (userList.length === 0) {
            Logger.warn('No Users exist, creating default Users')
            await createDefaultUserData()
        } else if (userList.length > 0 && !Characters.useUserCard.getState().card) {
            Characters.useUserCard.getState().setCard(userList[0]!.id) // safe non-null assertion as requested
        }
    } catch (error) {
        Logger.error('Failed to set default character: ' + (error as Error).message)
    }
}

const setDefaultInstruct = (): void => {
    Instructs.db.query
        .instructList()
        .then(async (list) => {
            if (!list) {
                Logger.error(
                    'Instruct database Invalid, this should not happen! Please report this!'
                )
            } else if (list.length === 0) {
                Logger.warn('No Instructs exist, creating default Instruct')
                const id = await Instructs.generateInitialDefaults()
                Instructs.useInstruct.getState().load(id)
            }
        })
        .catch((error) => Logger.error('Failed loading default instructs: ' + error.message))
}

export const startupApp = (): void => {
    console.log('[APP STARTED]: T1APT')

    setAppDefaultSettings()
    generateDefaultDirectories()
    setDefaultCharacter()
    setDefaultInstruct()

    createDefaultCard()
    setCPUFeatures()
    Model.verifyModelList()

    migrateModelData_0_7_10_to_0_8_0()
    migrateModelData_0_8_4_to_0_8_5()
    migratePresets_0_8_3_to_0_8_4()
    migrateTTSData_0_8_5_to_0_8_6()
    migrateAppMode_0_8_5_to_0_8_6()

    lockScreenOrientation()
    setBackgroundColorAsync(Theme.useColorState.getState().color.neutral._100).catch(() => {
        Logger.warn('Failed to set background color on startup')
    })

    Logger.info('Resetting state values for startup.')
}
