import Alert from '@components/views/Alert'
import PopupMenu, { PopupMenuHandle } from '@components/views/PopupMenu' // updated import
import { CharInfo, Characters } from '@lib/state/Characters'
import { useRouter } from 'expo-router'
import React, { RefObject } from 'react' // Import RefObject

type CharacterEditPopupProps = {
    characterInfo: CharInfo
    nowLoading: boolean
    setNowLoading: (b: boolean) => void
}

const CharacterEditPopup: React.FC<CharacterEditPopupProps> = ({
    characterInfo,
    setNowLoading,
    nowLoading,
}) => {
    const router = useRouter()

    const { setCurrentCard } = Characters.useCharacterCard((state) => ({
        setCurrentCard: state.setCard,
    }))

    // FIX: Changed parameter type to RefObject<PopupMenuHandle>
    const deleteCard = (menuRef: RefObject<PopupMenuHandle>) => {
        Alert.alert({
            title: 'Delete Character',
            description: `Are you sure you want to delete '${characterInfo.name}'? This cannot be undone.`,
            buttons: [
                {
                    label: 'Cancel',
                },
                {
                    label: 'Delete Character',
                    onPress: async () => {
                        Characters.db.mutate.deleteCard(characterInfo.id ?? -1)
                        menuRef.current?.close() // FIX: Access .current
                    },
                    type: 'warning',
                },
            ],
        })
    }

    // FIX: Changed parameter type to RefObject<PopupMenuHandle>
    const cloneCard = (menuRef: RefObject<PopupMenuHandle>) => {
        Alert.alert({
            title: 'Clone Character',
            description: `Are you sure you want to clone '${characterInfo.name}'?`,
            buttons: [
                {
                    label: 'Cancel',
                },
                {
                    label: 'Clone Character',
                    onPress: async () => {
                        setNowLoading(true)
                        await Characters.db.mutate.duplicateCard(characterInfo.id)
                        menuRef.current?.close() // FIX: Access .current
                        setNowLoading(false)
                    },
                },
            ],
        })
    }

    // FIX: Changed parameter type to RefObject<PopupMenuHandle>
    const editCharacter = async (menuRef: RefObject<PopupMenuHandle>) => {
        if (nowLoading) return
        setNowLoading(true)
        await setCurrentCard(characterInfo.id)
        setNowLoading(false)
        menuRef.current?.close() // FIX: Access .current
        router.push('/CharacterEditor')
    }

    return (
        <PopupMenu
            style={{ paddingHorizontal: 8 }}
            disabled={nowLoading}
            icon="edit"
            options={[
                { label: 'Edit', icon: 'edit', onPress: editCharacter },
                { label: 'Clone', icon: 'copy1', onPress: cloneCard },
                { label: 'Delete', icon: 'delete', onPress: deleteCard, warning: true },
            ]}
        />
    )
}

export default CharacterEditPopup
