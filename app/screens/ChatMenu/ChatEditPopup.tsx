import Alert from '@components/views/Alert'
import PopupMenu, { PopupMenuHandle } from '@components/views/PopupMenu' // FIX: Changed MenuRef to PopupMenuHandle
import TextBoxModal from '@components/views/TextBoxModal'
import { Characters } from '@lib/state/Characters' // FIX: Changed '=>' to 'from'
import { Chats } from '@lib/state/Chat'
import { Logger } from '@lib/state/Logger'
import { saveStringToDownload } from '@lib/utils/File'
import React, { useState } from 'react'
import { RefObject } from 'react' // FIX: Import RefObject
import { View } from 'react-native'

type ChatEditPopupProps = {
    item: Awaited<ReturnType<typeof Chats.db.query.chatListQuery>>[0]
}

const ChatEditPopup: React.FC<ChatEditPopupProps> = ({ item }) => {
    const [showRename, setShowRename] = useState<boolean>(false)

    const { charName, charId } = Characters.useCharacterCard((state) => ({
        charId: state.id,
        charName: state.card?.name ?? 'Unknown',
    }))

    const { userId, userName } = Characters.useUserCard((state) => ({
        userId: state.id,
        userName: state.card?.name,
    }))

    const { deleteChat, loadChat, chatId, unloadChat } = Chats.useChat()

    // FIX: Changed parameter type to RefObject<PopupMenuHandle>
    const handleDeleteChat = (menuRef: RefObject<PopupMenuHandle>) => {
        Alert.alert({
            title: `Delete Chat`,
            description: `Are you sure you want to delete '${item.name}'? This cannot be undone.`,
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Delete Chat',
                    onPress: async () => {
                        await deleteChat(item.id)
                        if (charId && chatId === item.id) {
                            const returnedChatId = await Chats.db.query.chatNewestId(charId)
                            // Renamed `chatId` to `newChatId` to avoid shadowing the outer `chatId` constant
                            const newChatId = returnedChatId
                                ? returnedChatId
                                : await Chats.db.mutate.createChat(charId)
                            newChatId && (await loadChat(newChatId))
                        } else if (item.id === chatId) {
                            Logger.errorToast(`Something went wrong with creating a default chat`)
                            unloadChat()
                        }
                        menuRef.current?.close() // This should now be correct
                    },
                    type: 'warning',
                },
            ],
        })
    }

    // FIX: Changed parameter type to RefObject<PopupMenuHandle>
    const handleCloneChat = (menuRef: RefObject<PopupMenuHandle>) => {
        Alert.alert({
            title: `Clone Chat`,
            description: `Are you sure you want to clone '${item.name}'?`,
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Clone Chat',
                    onPress: async () => {
                        await Chats.db.mutate.cloneChat(item.id)
                        menuRef.current?.close() // This should now be correct
                    },
                },
            ],
        })
    }

    // FIX: Changed parameter type to RefObject<PopupMenuHandle>
    const handleExportChat = async (menuRef: RefObject<PopupMenuHandle>) => {
        const name = `Chatlogs-${charName}-${item.id}.json`.replaceAll(' ', '_')
        await saveStringToDownload(JSON.stringify(await Chats.db.query.chat(item.id)), name, 'utf8')
        menuRef.current?.close() // This should now be correct
        Logger.infoToast(`File: ${name} saved to downloads!`)
    }

    const handleLinkUser = async () => {
        if (userId === item.user_id) return
        if (!userId) {
            Logger.errorToast('No current User')
            return
        }
        await Chats.db.mutate.updateUser(item.id, userId)
        Logger.errorToast(`Linked to User: ${userName}`)
    }

    return (
        <View>
            <TextBoxModal
                booleans={[showRename, setShowRename]}
                onConfirm={async (text) => {
                    await Chats.db.mutate.renameChat(item.id, text)
                }}
                textCheck={(text) => text.length === 0}
                defaultValue={item.name}
            />
            <PopupMenu
                icon="edit"
                options={[
                    {
                        label: 'Rename',
                        icon: 'edit',
                        // FIX: Changed parameter type to RefObject<PopupMenuHandle> and accessed .current
                        onPress: (menuRef: RefObject<PopupMenuHandle>) => {
                            setShowRename(true)
                            menuRef.current?.close()
                        },
                    },
                    {
                        label: 'Export',
                        icon: 'download',
                        onPress: handleExportChat, // handleExportChat is already correctly typed
                    },
                    {
                        label: 'Clone',
                        icon: 'copy1',
                        onPress: handleCloneChat, // handleCloneChat is already correctly typed
                    },
                    {
                        label: 'Link User',
                        icon: 'user',
                        onPress: handleLinkUser, // This handler doesn't use menuRef
                    },
                    {
                        label: 'Delete',
                        icon: 'delete',
                        warning: true,
                        onPress: handleDeleteChat, // handleDeleteChat is already correctly typed
                    },
                ]}
            />
        </View>
    )
}

export default ChatEditPopup
