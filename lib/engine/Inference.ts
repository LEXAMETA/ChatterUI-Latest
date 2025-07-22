import { useAppModeState } from '@lib/state/AppMode'
import { Chats, useInference } from '@lib/state/Chat'
import BackgroundService from 'react-native-background-actions'

import { Characters } from '../state/Characters'
import { Logger } from '../state/Logger'
import { buildAndSendRequest } from './API/APIBuilder'
import { localInference } from './LocalInference'

export const regenerateResponse = async (swipeId: number, regenCache: boolean = true) => {
    const charName = Characters.useCharacterCard.getState().card?.name
    // Ensure messagesLength is at least 0. If messages is empty, messagesLength will be 0.
    const messagesLength = Chats.useChatState.getState()?.data?.messages?.length ?? 0
    // message can correctly be undefined if messagesLength is 0
    const message = Chats.useChatState.getState()?.data?.messages?.[messagesLength - 1]

    Logger.info('Regenerate Response' + (regenCache ? '' : ' , Resetting Message'))

    // First, handle the case where the last message is a user message
    if (message?.is_user) {
        await Chats.useChatState.getState().addEntry(charName ?? '', true, '')
    }
    // Now handle cases where it's not a user message, or there are no messages (messagesLength <= 0)
    // The condition `messagesLength && messagesLength !== 1` means:
    // - If messagesLength is 0, it's false.
    // - If messagesLength is 1, it means the *only* message is at index 0. If that's a user message, it's handled above.
    //   If it's not a user message (e.g., first bot response), we might still want to regenerate.
    //   Let's adjust this to ensure we have a valid `message` to work with for regeneration.
    else if (message && messagesLength > 0) {
        // Ensure 'message' exists and there are messages
        let replacement = ''

        if (regenCache) {
            // Now that 'message' is guaranteed to be defined within this block,
            // we can safely access its properties, using optional chaining for 'swipes'
            // and then checking if the specific swipe entry exists.
            const swipeEntry = message.swipes?.[message.swipe_id]

            if (swipeEntry) {
                replacement = swipeEntry.regen_cache ?? ''
            } else {
                // This branch means regenCache was true, but the swipe data was missing or invalid.
                // In this case, we still need to reset the regen cache.
                Chats.useChatState.getState().resetRegenCache()
                Logger.warn('Regen cache requested but specific swipe data missing or invalid.')
            }
        } else {
            // If regenCache is false, always reset the cache
            Chats.useChatState.getState().resetRegenCache()
        }

        if (replacement) {
            Chats.useChatState.getState().setBuffer({ data: replacement })
        }
        await Chats.useChatState.getState().updateEntry(messagesLength - 1, replacement, {
            updateFinished: true,
            updateStarted: true,
            resetTimings: true,
        })
    }
    await generateResponse(swipeId)
}

export const continueResponse = async (swipeId: number) => {
    Logger.info(`Continuing Response`)
    Chats.useChatState.getState().setRegenCache()
    Chats.useChatState.getState().insertLastToBuffer()
    await generateResponse(swipeId)
}

const completionTaskOptions = {
    taskName: 'chatterui_completion_task',
    taskTitle: 'Running completion...',
    taskDesc: 'ChatterUI is running a completion task',
    taskIcon: {
        name: 'ic_launcher',
        type: 'mipmap',
    },
    color: '#403737',
    linkingURI: 'chatterui://',
    progressBar: {
        max: 1,
        value: 0,
        indeterminate: true,
    },
}

export const generateResponse = async (swipeId: number) => {
    if (useInference.getState().nowGenerating) {
        Logger.infoToast('Generation already in progress')
        return
    }
    Chats.useChatState.getState().startGenerating(swipeId)
    Logger.info(`Obtaining response.`)
    const data = performance.now()
    const appMode = useAppModeState.getState().appMode

    if (appMode === 'local') {
        await BackgroundService.start(localInference, completionTaskOptions)
    } else {
        await BackgroundService.start(buildAndSendRequest, completionTaskOptions)
    }

    Logger.debug(`Time taken for generateResponse(): ${(performance.now() - data).toFixed(2)}ms`)
}
