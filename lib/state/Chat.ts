// lib/state/Chat.ts

import { db as database } from '@db' // 'db' is now imported as 'database'
import { Tokenizer } from '@lib/engine/Tokenizer'
import { replaceMacros } from '@lib/utils/Macros'
import { convertToFormatInstruct } from '@lib/utils/TextFormat'
import { chatEntries, chats, ChatSwipe, chatSwipes, CompletionTimings } from 'db/schema'
import { and, count, desc, eq, getTableColumns, like } from 'drizzle-orm'
import * as Notifications from 'expo-notifications'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

import { Characters } from './Characters'
import { Logger } from './Logger'
import { AppSettings } from '../constants/GlobalValues'
import { mmkv } from '../storage/MMKV'

export interface ChatSwipeState extends ChatSwipe {
    token_count?: number
    regen_cache?: string
}

export type ChatEntry = {
    id: number
    chat_id: number
    name: string
    is_user: boolean
    order: number
    swipe_id: number
    swipes: ChatSwipeState[]
}

export type ChatData = {
    id: number
    create_date: Date
    character_id: number
    user_id: number | null
    name: string
    messages: ChatEntry[]
}

export interface ChatState {
    data: ChatData | undefined
    buffer: OutputBuffer
    load: (chatId: number) => Promise<void>
    delete: (chatId: number) => Promise<void>
    addEntry: (name: string, is_user: boolean, message: string) => Promise<number | void>
    updateEntry: (
        index: number,
        message: string,
        options?: {
            updateFinished?: boolean
            updateStarted?: boolean
            verifySwipeId?: number
            timings?: CompletionTimings
            resetTimings?: boolean
        }
    ) => Promise<void>
    deleteEntry: (index: number) => Promise<void>
    reset: () => void
    swipe: (index: number, direction: number) => Promise<boolean>
    addSwipe: (index: number, message?: string) => Promise<number | void>
    getTokenCount: (index: number) => number
    setBuffer: (data: OutputBuffer) => void
    insertBuffer: (data: string) => void
    updateFromBuffer: (cachedSwipeId?: number) => Promise<void>
    insertLastToBuffer: () => void
    setRegenCache: () => void
    getRegenCache: () => string
    resetRegenCache: () => void
    stopGenerating: () => void
    startGenerating: (swipeId: number) => void
}

type InferenceStateType = {
    abortFunction: () => void | Promise<void>
    nowGenerating: boolean
    currentSwipeId?: number
    startGenerating: (swipeId: number) => void
    stopGenerating: () => void
    setAbort: (fn: () => void | Promise<void>) => void
}

type OutputBuffer = {
    data: string
    timings?: CompletionTimings
    error?: string
}

type ChatSwipeUpdated = Pick<ChatSwipe, 'swipe' | 'id'> & Partial<Omit<ChatSwipe, 'swipe' | 'id'>>

// TODO: Functionalize and move elsewhere
export const sendGenerateCompleteNotification = async () => {
    const showMessage = mmkv.getBoolean(AppSettings.ShowNotificationText)

    const notificationTitle = showMessage
        ? (Characters.useCharacterCard.getState().card?.name ?? '')
        : 'Response Complete'

    const notificationText = showMessage
        ? Chats.useChatState.getState().buffer?.data?.trim()
        : 'ChatterUI has finished a response.'

    Notifications.setNotificationHandler({
        handleNotification: async () => ({
            shouldShowAlert: false,
            shouldPlaySound: false,
            shouldSetBadge: false,
        }),
    })

    Notifications.scheduleNotificationAsync({
        content: {
            title: notificationTitle,
            body: notificationText,
            sound: !!mmkv.getBoolean(AppSettings.PlayNotificationSound),
            vibrate: mmkv.getBoolean(AppSettings.VibrateNotification) ? [250, 125, 250] : undefined,
            badge: 0,
        },
        trigger: null,
    })
    Notifications.setBadgeCountAsync(0)
}

export const useInference = create<InferenceStateType>((set, get) => ({
    abortFunction: () => {
        get().stopGenerating()
    },
    nowGenerating: false,
    currentSwipeId: undefined,
    startGenerating: (swipeId: number) =>
        set((state) => ({ ...state, currentSwipeId: swipeId, nowGenerating: true })),
    stopGenerating: () => {
        set((state) => ({ ...state, nowGenerating: false, currentSwipeId: undefined }))
        if (mmkv.getBoolean(AppSettings.NotifyOnComplete)) sendGenerateCompleteNotification()
    },
    setAbort: (fn) => {
        set((state) => ({
            ...state,
            abortFunction: async () => {
                await fn()
            },
        }))
    },
}))

// Start of the 'Chats' namespace
export namespace Chats {
    export const useChatState = create<ChatState>((set, get: () => ChatState) => ({
        data: undefined,
        buffer: { data: '' },

        startGenerating: (swipeId: number) => {
            // No longer `Chats.useInference` because `useInference` is a top-level export
            useInference.getState().startGenerating(swipeId)
        },

        stopGenerating: async () => {
            const cachedSwipeId = useInference.getState().currentSwipeId
            Logger.info(`Saving Chat`)
            await get().updateFromBuffer(cachedSwipeId)
            useInference.getState().stopGenerating()
            get().setBuffer({ data: '' })
        },

        load: async (chatId: number) => {
            // Correctly reference `db` from `Chats.db.query.chat`
            const data = await Chats.db.query.chat(chatId) // <-- Fix
            if (data?.user_id && mmkv.getBoolean(AppSettings.AutoLoadUser)) {
                const userID = Characters.useUserCard.getState().id
                if (userID !== data.user_id) {
                    Logger.info('Autoloading User with ID: ' + data.user_id)
                    await Characters.useUserCard.getState().setCard(data.user_id)
                    const name = Characters.useUserCard.getState().card?.name
                    if (name) {
                        Logger.infoToast('Loading User : ' + name)
                    }
                }
            }

            set((state) => ({
                ...state,
                // Ensure messages is always an array if data exists
                data: data ? { ...data, messages: data.messages ?? [] } : undefined,
            }))
        },

        delete: async (chatId: number) => {
            // Correctly reference `db` from `Chats.db.mutate.deleteChat`
            await Chats.db.mutate.deleteChat(chatId) // <-- Fix
            if (get().data?.id === chatId) get().reset()
        },

        reset: () =>
            set((state) => ({
                ...state,
                data: undefined,
            })),

        addEntry: async (name, is_user, message) => {
            const messages = get().data?.messages
            const chatId = get().data?.id
            if (!messages || !chatId) return
            // Ensure messages.length - 1 is valid before accessing. `messages.length > 0` already does this.
            // TS2532: Object is possibly 'undefined'.
            // Fix: Added a type assertion `as ChatEntry` to assure TypeScript that `messages[messages.length - 1]` is indeed a ChatEntry.
            const order = messages.length > 0 ? (messages[messages.length - 1] as ChatEntry).order + 1 : 0

            // Correctly reference `db` from `Chats.db.mutate.createEntry`
            const entry = await Chats.db.mutate.createEntry(chatId, name, is_user, order, message) // <-- Fix
            if (entry) messages.push(entry)
            set((state) => ({
                ...state,
                data: state.data ? { ...state.data, messages: messages } : state.data,
            }))
            return entry?.swipes?.[0]?.id
        },

        deleteEntry: async (index) => {
            const messages = get().data?.messages
            if (!messages) return
            const entryToDelete = messages[index]
            if (!entryToDelete) {
                Logger.warn(`deleteEntry: No message at index ${index}`)
                return
            }

            // Correctly reference `db` from `Chats.db.mutate.deleteChatEntry`
            await Chats.db.mutate.deleteChatEntry(entryToDelete.id) // <-- Fix
            set((state) => {
                if (!state.data) return state
                return {
                    ...state,
                    data: {
                        ...state.data,
                        messages: messages.filter((_, i) => i !== index),
                    },
                }
            })
        },

        updateEntry: async (index, message, options = {}) => {
            const { verifySwipeId, updateFinished, updateStarted, timings, resetTimings } = options
            const messages = get().data?.messages
            if (!messages) return

            const currentEntry = messages[index]
            if (!currentEntry) {
                Logger.warn(`updateEntry: No chat entry at index ${index}`)
                return
            }

            const currentSwipe = currentEntry.swipes[currentEntry.swipe_id]
            if (!currentSwipe) {
                Logger.error(`updateEntry: No current swipe found for entry at index ${index}`)
                return
            }

            let chatSwipeId = currentSwipe.id
            let updateState = true

            if (verifySwipeId) {
                updateState = verifySwipeId === chatSwipeId
                if (!updateState) {
                    chatSwipeId = verifySwipeId
                }
            }

            // `chatSwipeId` can be a number or undefined.
            // If it's undefined, it's a problem, so ensure it's a number.
            if (typeof chatSwipeId !== 'number') { // Changed from `!chatSwipeId`
                Logger.error(`updateEntry: Invalid chatSwipeId for index ${index}`)
                return
            }

            const date = new Date()

            const updatedSwipe: ChatSwipeUpdated = {
                id: chatSwipeId, // Now guaranteed to be a number
                swipe: message,
                gen_finished: updateFinished ? date : undefined,
                gen_started: updateStarted ? date : undefined,
                timings: resetTimings ? null : timings ?? undefined,
            }

            // Correctly reference `db` from `Chats.db.mutate.updateChatSwipe`
            await Chats.db.mutate.updateChatSwipe(updatedSwipe) // <-- Fix

            if (!updateState) return

            currentSwipe.swipe = message
            currentSwipe.token_count = undefined
            if (updateFinished) currentSwipe.gen_finished = date
            if (updateStarted) currentSwipe.gen_started = date
            if (timings) currentSwipe.timings = timings
            if (resetTimings) currentSwipe.timings = null

            currentEntry.swipes[currentEntry.swipe_id] = currentSwipe

            set((state) => ({
                ...state,
                data: state.data ? { ...state.data, messages: messages } : state.data,
            }))
        },

        swipe: async (index, direction) => {
            const messages = get().data?.messages
            if (!messages) return false
            const entry = messages[index]
            if (!entry) {
                Logger.warn(`swipe: No chat entry at index ${index}`)
                return false
            }
            const swipe_id = entry.swipe_id
            const target = swipe_id + direction
            const limit = entry.swipes.length - 1
            if (target < 0) return false
            if (target > limit) return true

            entry.swipe_id = target

            set((state) => ({
                ...state,
                data: state.data ? { ...state.data, messages: messages } : state.data,
            }))

            // Correctly reference `db` from `Chats.db.mutate.updateEntrySwipeId`
            await Chats.db.mutate.updateEntrySwipeId(entry.id, target) // <-- Fix

            return false
        },

        addSwipe: async (index, message = '') => {
            const messages = get().data?.messages
            if (!messages) return
            const entry = messages[index]
            if (!entry) {
                Logger.warn(`addSwipe: No chat entry at index ${index}`)
                return
            }
            // Correctly reference `db` from `Chats.db.mutate.createSwipe`
            const swipe = await Chats.db.mutate.createSwipe(entry.id, message) // <-- Fix
            if (swipe) entry.swipes.push(swipe)

            // Update swipe_id to new swipe
            const newSwipeId = entry.swipes.length - 1
            // Correctly reference `db` from `Chats.db.mutate.updateEntrySwipeId`
            await Chats.db.mutate.updateEntrySwipeId(entry.id, newSwipeId) // <-- Fix
            entry.swipe_id = newSwipeId

            set((state) => ({
                ...state,
                data: state.data ? { ...state.data, messages: messages } : state.data,
            }))

            return swipe?.id
        },

        getTokenCount: (index) => {
            const messages = get().data?.messages
            if (!messages) return 0
            const entry = messages[index]
            if (!entry) {
                Logger.warn(`getTokenCount: No chat entry at index ${index}`)
                return 0
            }
            const currentSwipe = entry.swipes[entry.swipe_id]
            if (!currentSwipe) {
                // If currentSwipe is undefined, return 0 and log a warning
                Logger.warn(`getTokenCount: No current swipe found for entry at index ${index}.`)
                return 0
            }

            if (currentSwipe.token_count) return currentSwipe.token_count

            const tokenizer = Tokenizer.getTokenizer()
            const token_count = tokenizer(currentSwipe.swipe)
            currentSwipe.token_count = token_count

            set((state) => ({
                ...state,
                data: state.data ? { ...state.data, messages: messages } : state.data,
            }))
            return token_count
        },

        setBuffer: (newBuffer) =>
            set((state) => ({
                ...state,
                buffer: newBuffer,
            })),

        insertBuffer: (data) =>
            set((state) => ({
                ...state,
                buffer: { ...state.buffer, data: state.buffer.data + data },
            })),

        updateFromBuffer: async (cachedSwipeId) => {
            const NO_VALID_ENTRY = -1
            const messages = get().data?.messages
            const buffer = get().buffer

            const lastIndex = messages?.length ? messages.length - 1 : undefined

            let targetSwipeId: number;
            if (lastIndex !== undefined && messages) {
                // Use a non-null assertion (!) here because we've checked `messages[lastIndex]` in the condition.
                // TypeScript can sometimes be overly cautious with array indexing even after length checks.
                const lastMessage = messages[lastIndex]!; // Assure TypeScript that lastMessage is defined
                targetSwipeId = lastMessage.swipes[lastMessage.swipe_id]?.id ?? cachedSwipeId ?? NO_VALID_ENTRY;
            } else {
                targetSwipeId = cachedSwipeId ?? NO_VALID_ENTRY;
            }


            if (targetSwipeId === NO_VALID_ENTRY) {
                Logger.error('Attempted to insert to buffer, but no valid entry or swipeId was found!')
                return
            }

            const updatedSwipe: ChatSwipeUpdated = {
                id: targetSwipeId, // Now guaranteed to be a number due to the `if (targetSwipeId === NO_VALID_ENTRY)` check.
                swipe: buffer.data,
                timings: buffer.timings,
            }

            // If there are no messages, or the last index is invalid, directly update the swipe
            if (lastIndex === undefined || lastIndex < 0) { // lastIndex could be -1 if messages is empty
                // Correctly reference `db` from `Chats.db.mutate.updateChatSwipe`
                await Chats.db.mutate.updateChatSwipe(updatedSwipe) // <-- Fix
            } else {
                // Otherwise, update the existing entry using the `updateEntry` function
                await get().updateEntry(lastIndex, buffer.data, {
                    updateFinished: true,
                    verifySwipeId: cachedSwipeId,
                    timings: buffer.timings,
                })
            }
        },

        insertLastToBuffer: () => {
            const messages = get().data?.messages
            if (!messages || messages.length === 0) return
            const lastMessage = messages[messages.length - 1] // Guaranteed to be ChatEntry here

            // TS18048: 'lastMessage' is possibly 'undefined'.
            // Fix: Add a check for `lastMessage` to ensure it's not undefined before accessing `swipes`.
            // While `messages.length === 0` handles the array being empty, if somehow `messages[messages.length - 1]` was truly undefined,
            // this check makes it explicit.
            if (!lastMessage) {
                Logger.warn('insertLastToBuffer: No last message found despite array length check.')
                return;
            }
            // `lastMessage.swipes[lastMessage.swipe_id]` can still be undefined if swipe_id is out of bounds
            const lastSwipe = lastMessage.swipes[lastMessage.swipe_id] // Access safely with optional chaining on lastSwipe
            set((state) => ({
                ...state,
                buffer: { ...state.buffer, data: lastSwipe?.swipe ?? '' },
            }))
        },

        setRegenCache: () => {
            const messages = get().data?.messages
            const message = messages?.[messages.length - 1]
            if (!messages || !message) return
            const currentSwipe = message.swipes[message.swipe_id]
            if (!currentSwipe) {
                Logger.warn('setRegenCache: Swipe not found for last entry.')
                return
            }
            currentSwipe.regen_cache = currentSwipe.swipe
            messages[messages.length - 1] = message
            set((state) => ({
                ...state,
                data: state.data ? { ...state.data, messages: messages } : state.data,
            }))
        },

        getRegenCache: () => {
            const messages = get().data?.messages
            const message = messages?.[messages.length - 1]
            if (!messages || !message) return ''
            const currentSwipe = message.swipes[message.swipe_id]
            if (!currentSwipe) {
                Logger.warn('getRegenCache: Swipe not found for last entry.')
                return ''
            }
            return currentSwipe.regen_cache ?? ''
        },

        resetRegenCache: () => {
            const messages = get().data?.messages
            const message = messages?.[messages.length - 1]
            if (!messages || !message) return
            const currentSwipe = message.swipes[message.swipe_id]
            if (!currentSwipe) {
                Logger.warn('resetRegenCache: Swipe not found for last entry.')
                return
            }
            currentSwipe.regen_cache = ''
            messages[messages.length - 1] = message
            set((state) => ({
                ...state,
                data: state.data ? { ...state.data, messages: messages } : state.data,
            }))
        },
    }))

    // This `db` namespace is what you need to reference inside `useChatState`
    export namespace db {
        export namespace query {
            export const chat = async (chatId: number): Promise<ChatData | undefined> => {
                const chat = await database.query.chats.findFirst({
                    where: eq(chats.id, chatId),
                    with: {
                        messages: {
                            orderBy: chatEntries.order,
                            with: {
                                swipes: true,
                            },
                        },
                    },
                })
                if (chat) {
                    return { ...chat, messages: chat.messages || [] }
                }
                return undefined
            }

            export const chatNewestId = async (charId: number): Promise<number | undefined> => {
                const result = await database.query.chats.findFirst({
                    orderBy: desc(chats.last_modified),
                    where: eq(chats.character_id, charId),
                })
                return result?.id
            }

            export const chatNewest = async () => {
                const result = await database.query.chats.findFirst({
                    orderBy: desc(chats.last_modified),
                })
                return result
            }

            export const chatList = async (charId: number) => {
                const result = await database
                    .select({
                        ...getTableColumns(chats),
                        entryCount: count(chatEntries.id),
                    })
                    .from(chats)
                    .leftJoin(chatEntries, eq(chats.id, chatEntries.chat_id))
                    .groupBy(chats.id)
                    .where(eq(chats.character_id, charId))
                return result
            }

            export const chatListQuery = (charId: number) => {
                return database
                    .select({
                        ...getTableColumns(chats),
                        entryCount: count(chatEntries.id),
                    })
                    .from(chats)
                    .leftJoin(chatEntries, eq(chats.id, chatEntries.chat_id))
                    .groupBy(chats.id)
                    .where(eq(chats.character_id, charId))
                    .orderBy(desc(chats.last_modified))
            }

            export const chatExists = async (chatId: number) => {
                return await database.query.chats.findFirst({ where: eq(chats.id, chatId) })
            }

            export const searchChat = async (query: string, charId: number) => {
                return await database
                    .select({
                        swipeId: chatSwipes.id,
                        chatId: chatEntries.chat_id,
                        chatName: chats.name,
                        swipe: chatSwipes.swipe,
                        sendDate: chatSwipes.send_date,
                    })
                    .from(chatSwipes)
                    .innerJoin(chatEntries, eq(chatSwipes.entry_id, chatEntries.id))
                    .innerJoin(chats, eq(chatEntries.chat_id, chats.id))
                    .where(
                        and(like(chatSwipes.swipe, `%${query}%`), eq(chats.character_id, charId))
                    )
                    .limit(999)
            }
        }
        export namespace mutate {
            export const createChat = async (charId: number) => {
                const card = await Characters.db.query.card(charId)
                if (!card) {
                    Logger.error('Character does not exist!')
                    return
                }
                const userId = Characters.useUserCard.getState().id
                const charName = card.name ?? ''

                return await database.transaction(async (tx) => {
                    if (!card) {
                        Logger.error('Transaction failed: Character card is missing.')
                        return
                    }
                    const newChatInsertResult = await tx
                        .insert(chats)
                        .values({
                            character_id: charId,
                            user_id: userId ?? null,
                        })
                        .returning({ chatId: chats.id })

                    const chatId = newChatInsertResult[0]?.chatId
                    if (!chatId) {
                        Logger.error('Failed to create chat: chatId is undefined.')
                        return
                    }

                    if (!mmkv.getBoolean(AppSettings.CreateFirstMes)) return chatId

                    const entryInsertResult = await tx
                        .insert(chatEntries)
                        .values({
                            chat_id: chatId,
                            is_user: false,
                            name: card.name ?? '',
                            order: 0,
                        })
                        .returning({ entryId: chatEntries.id })
                    const entryId = entryInsertResult[0]?.entryId
                    if (!entryId) {
                        Logger.error('Failed to create chat entry: entryId is undefined.')
                        return
                    }

                    await tx.insert(chatSwipes).values({
                        entry_id: entryId,
                        swipe: convertToFormatInstruct(replaceMacros(card.first_mes ?? '')),
                    })

                    card.alternate_greetings?.forEach(async (data) => {
                        await tx.insert(chatSwipes).values({
                            entry_id: entryId,
                            swipe: convertToFormatInstruct(replaceMacros(data.greeting)),
                        })
                    })
                    await Characters.db.mutate.updateModified(charId)
                    return chatId
                })
            }

            export const updateChatModified = async (chatID: number) => {
                const chat = await database.query.chats.findFirst({ where: eq(chats.id, chatID) })
                if (chat?.character_id) {
                    await Characters.db.mutate.updateModified(chat.character_id)
                }
                await database
                    .update(chats)
                    .set({ last_modified: Date.now() })
                    .where(eq(chats.id, chatID))
            }

            export const createEntry = async (
                chatId: number,
                name: string,
                isUser: boolean,
                order: number,
                message: string
            ) => {
                const entryInsertResult = await database
                    .insert(chatEntries)
                    .values({
                        chat_id: chatId,
                        name: name,
                        is_user: isUser,
                        order: order,
                    })
                    .returning({ entryId: chatEntries.id })
                const entryId = entryInsertResult[0]?.entryId
                if (!entryId) {
                    Logger.error('Failed to create entry: entryId is undefined.')
                    return // Ensure a return if entryId is not found
                }

                await database
                    .insert(chatSwipes)
                    .values({ swipe: replaceMacros(message), entry_id: entryId })
                const entry = await database.query.chatEntries.findFirst({
                    where: eq(chatEntries.id, entryId),
                    with: { swipes: true },
                })
                await updateChatModified(chatId)
                return entry
            }

            export const updateEntryModified = async (entryId: number) => {
                const entry = await database.query.chatEntries.findFirst({
                    where: eq(chatEntries.id, entryId),
                })
                if (entry?.chat_id) {
                    await updateChatModified(entry.chat_id)
                }
            }

            export const createSwipe = async (entryId: number, message: string) => {
                const swipeInsertResult = await database
                    .insert(chatSwipes)
                    .values({
                        entry_id: entryId,
                        swipe: replaceMacros(message),
                    })
                    .returning({ swipeId: chatSwipes.id })
                const swipeId = swipeInsertResult[0]?.swipeId
                if (!swipeId) {
                    Logger.error('Failed to create swipe: swipeId is undefined.')
                    return // Ensure a return if swipeId is not found
                }

                await updateEntryModified(entryId)
                return await database.query.chatSwipes.findFirst({
                    where: eq(chatSwipes.id, swipeId),
                })
            }

            export const updateEntrySwipeId = async (entryId: number, swipeId: number) => {
                await updateEntryModified(entryId)
                await database
                    .update(chatEntries)
                    .set({ swipe_id: swipeId })
                    .where(eq(chatEntries.id, entryId))
            }

            export const updateChatSwipe = async (chatSwipe: ChatSwipeUpdated) => {
                await database
                    .update(chatSwipes)
                    .set(chatSwipe)
                    .where(eq(chatSwipes.id, chatSwipe.id))
                const swipe = await database.query.chatSwipes.findFirst({
                    where: eq(chatSwipes.id, chatSwipe.id),
                })
                if (swipe?.entry_id) updateEntryModified(swipe.entry_id)
            }

            export const deleteChat = async (chatId: number) => {
                await updateChatModified(chatId)
                await database.delete(chats).where(eq(chats.id, chatId))
            }

            export const deleteChatEntry = async (entryId: number) => {
                await updateEntryModified(entryId)
                await database.delete(chatEntries).where(eq(chatEntries.id, entryId))
            }

            export const cloneChat = async (chatId: number, limit?: number) => {
                const result = await database.query.chats.findFirst({
                    where: eq(chats.id, chatId),
                    columns: { id: false },
                    with: {
                        messages: {
                            columns: { id: false },
                            orderBy: chatEntries.order,
                            with: {
                                swipes: {
                                    columns: { id: false },
                                },
                            },
                            ...(limit && { limit: limit }),
                        },
                    },
                })
                if (!result) return

                result.last_modified = Date.now()

                const newChatInsertResult = await database
                    .insert(chats)
                    .values(result)
                    .returning({ newChatId: chats.id })

                const newChatId = newChatInsertResult[0]?.newChatId
                if (!newChatId) {
                    Logger.error('Failed to clone chat: newChatId is undefined.')
                    return
                }

                result.messages?.forEach((item) => {
                    item.chat_id = newChatId
                })

                if (!result.messages || result.messages.length === 0) {
                    return newChatId
                }

                const newEntryIds = await database
                    .insert(chatEntries)
                    .values(result.messages)
                    .returning({ newEntryId: chatEntries.id })

                result.messages.forEach((item, index) => {
                    const newEntryIdResult = newEntryIds[index]
                    if (newEntryIdResult) {
                        item.swipes.forEach((item2) => {
                            item2.entry_id = newEntryIdResult.newEntryId
                        })
                    } else {
                        Logger.warn(`cloneChat: No new entry ID found for message at index ${index}.`)
                    }
                })

                const swipes = result.messages.map((item) => item.swipes).flat()

                await database.insert(chatSwipes).values(swipes)

                return newChatId
            }

            export const renameChat = async (chatId: number, name: string) => {
                await database.update(chats).set({ name: name }).where(eq(chats.id, chatId))
            }

            export const updateUser = async (chatId: number, userId: number) => {
                await database.update(chats).set({ user_id: userId }).where(eq(chats.id, chatId))
            }
        }
    }

    export const useEntryData = (index: number) => {
        const entry = useChatState((state) => {
            return state?.data?.messages?.[index] ?? dummyEntry
        })
        return entry
    }

    export const useSwipes = () => {
        const { swipeChat, addSwipe } = Chats.useChatState(
            useShallow((state) => ({
                swipeChat: state.swipe,
                addSwipe: state.addSwipe,
            }))
        )
        return { swipeChat, addSwipe }
    }

    export const useSwipeData = (index: number) => {
        const message = useEntryData(index)

        const swipeIndex = message.swipe_id
        const swipesLength = message.swipes.length

        const currentSwipe = message.swipes[swipeIndex]

        const swipe = currentSwipe
        const swipeText = currentSwipe?.swipe ?? ''
        const swipeId = currentSwipe?.id

        return { swipeId, swipe, swipeText, swipeIndex, swipesLength }
    }

    export const useChat = () => {
        const { loadChat, unloadChat, chat, chatId, deleteChat } = Chats.useChatState(
            useShallow((state) => ({
                loadChat: state.load,
                unloadChat: state.reset,
                chat: state.data,
                chatId: state.data?.id,
                deleteChat: state.delete,
            }))
        )
        return { chat, loadChat, unloadChat, deleteChat, chatId }
    }

    export const useEntry = () => {
        const { addEntry, deleteEntry, updateEntry } = Chats.useChatState(
            useShallow((state) => ({
                addEntry: state.addEntry,
                deleteEntry: state.deleteEntry,
                updateEntry: state.updateEntry,
            }))
        )
        return { addEntry, deleteEntry, updateEntry }
    }

    export const useBuffer = () => {
        const { buffer } = Chats.useChatState(
            useShallow((state) => ({
                buffer: state.buffer,
            }))
        )
        return { buffer }
    }

    export const dummyEntry: ChatEntry = {
        id: 0,
        chat_id: -1,
        name: '',
        is_user: false,
        order: -1,
        swipe_id: 0,
        swipes: [
            {
                id: -1,
                entry_id: -1,
                swipe: '',
                send_date: new Date(),
                gen_started: new Date(),
                gen_finished: new Date(),
                timings: null,
            },
        ],
    }
}
