import ThemedButton from '@components/buttons/ThemedButton'
import StringArrayEditor from '@components/input/StringArrayEditor'
import ThemedTextInput from '@components/input/ThemedTextInput'
import Alert from '@components/views/Alert'
import Avatar from '@components/views/Avatar'
import FadeDownView from '@components/views/FadeDownView'
import HeaderTitle from '@components/views/HeaderTitle'
import PopupMenu, { PopupMenuHandle } from '@components/views/PopupMenu'
import { db } from '@db'
import { AntDesign } from '@expo/vector-icons'
import { Tokenizer } from '@lib/engine/Tokenizer'
import { useViewerState } from '@lib/state/AvatarViewer'
import { CharacterCardData, Characters } from '@lib/state/Characters'
import { Chats } from '@lib/state/Chat'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'
import { pickFile, saveStringToDownload } from '@lib/utils/File'
import { usePreventRemove } from '@react-navigation/core'
import AvatarViewer from '@screens/ChatMenu/ChatWindow/AvatarViewer'
import { characterTags, tags } from 'db/schema'
import { count, eq } from 'drizzle-orm'
import { useLiveQuery } from 'drizzle-orm/expo-sqlite'
import { useNavigation, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useShallow } from 'zustand/react/shallow'

const CharacterEditor = () => {
    const styles = useStyles()
    const { color, spacing } = Theme.useTheme()
    const router = useRouter()
    const navigation = useNavigation()

    const data = useLiveQuery(
        db
            .select({
                tag: tags.tag,
                id: tags.id,
                tagCount: count(characterTags.tag_id),
            })
            .from(tags)
            .leftJoin(characterTags, eq(characterTags.tag_id, tags.id))
            .groupBy(tags.id)
    )

    const { currentCard, setCurrentCard, charId, charName, unloadCharacter } =
        Characters.useCharacterCard(
            useShallow((state) => ({
                charId: state.id,
                currentCard: state.card,
                setCurrentCard: state.setCard,
                charName: state.card?.name,
                unloadCharacter: state.unloadCard,
            }))
        )

    const getTokenCount = Tokenizer.useDefaultTokenizer((state) => state.getTokenCount)
    const [characterCard, setCharacterCard] = useState<CharacterCardData | undefined>(currentCard)
    const { chat, unloadChat } = Chats.useChat()

    const setShowViewer = useViewerState((state) => state.setShow)
    const [edited, setEdited] = useState(false)
    const [altSwipeIndex, setAltSwipeIndex] = useState(0)

    // Clamp altSwipeIndex whenever greetings length changes to avoid out-of-bounds
    useEffect(() => {
        if (characterCard) {
            const length = characterCard.alternate_greetings.length
            if (length === 0) {
                setAltSwipeIndex(0)
            } else if (altSwipeIndex >= length) {
                setAltSwipeIndex(length - 1)
            }
        }
    }, [characterCard?.alternate_greetings.length, altSwipeIndex])

    const setCharacterCardEdited = (card: CharacterCardData) => {
        if (!edited) setEdited(true)
        setCharacterCard(card)
    }

    usePreventRemove(edited, ({ data }) => {
        Alert.alert({
            title: `Unsaved Changes`,
            description: `You have unsaved changes, leaving now will discard your progress.`,
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Save',
                    onPress: async () => {
                        await handleSaveCard()
                        navigation.dispatch(data.action)
                    },
                },
                {
                    label: 'Discard Changes',
                    onPress: () => {
                        navigation.dispatch(data.action)
                    },
                    type: 'warning',
                },
            ],
        })
    })

    const handleSaveCard = async () => {
        if (characterCard && charId)
            return Characters.db.mutate.updateCard(characterCard, charId).then(() => {
                setCurrentCard(charId)
                setEdited(false)
                Logger.infoToast('Card Saved!')
            })
    }

    const handleDeleteCard = () => {
        Alert.alert({
            title: `Delete Character`,
            description: `Are you sure you want to delete '${charName}'? This cannot be undone.`,
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Delete Character',
                    onPress: () => {
                        Characters.db.mutate.deleteCard(charId ?? -1)
                        unloadCharacter()
                        unloadChat()
                        Logger.info(`Deleted character: ${charName}`)
                        router.dismissAll()
                    },
                    type: 'warning',
                },
            ],
        })
    }

    useEffect(() => {
        return () => {
            if (!chat) unloadCharacter()
        }
    }, [])

    const handleDeleteImage = () => {
        Alert.alert({
            title: `Delete Image`,
            description: `Are you sure you want to delete this image? This cannot be undone.`,
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Delete Image',
                    onPress: () => {
                        if (characterCard) Characters.deleteImage(characterCard.image_id)
                    },
                    type: 'warning',
                },
            ],
        })
    }

    const handleImportImage = async () => {
        const result = await pickFile('image/*', true)
        if (!result || !charId) return
        Characters.useCharacterCard.getState().updateImage(result.uri)
    }

    const handleExportCard = () => {
        if (!characterCard) {
            Logger.errorToast('No character card to export.')
            return
        }
        saveStringToDownload(
            JSON.stringify(characterCard),
            `${characterCard.name}.json`,
            'utf8'
        ).then(() => {
            Logger.infoToast('Downloaded Character Card!')
        })
    }

    const handleAddAltMessage = async () => {
        if (!charId || !characterCard) return
        const id = await Characters.db.mutate.addAltGreeting(charId)
        await setCurrentCard(charId)

        const greetings = [
            ...(characterCard?.alternate_greetings ?? []),
            { id: id, greeting: '', character_id: charId },
        ]
        setCharacterCardEdited({ ...characterCard, alternate_greetings: greetings })
        if (characterCard.alternate_greetings.length !== 0) {
            setAltSwipeIndex(altSwipeIndex + 1)
        }
    }

    const deleteAltMessageRoutine = async () => {
        const id = characterCard?.alternate_greetings?.[altSwipeIndex]?.id
        if (!id || !charId) {
            Logger.errorToast('Error deleting swipe')
            return
        }
        await Characters.db.mutate.deleteAltGreeting(id)
        await setCurrentCard(charId)
        const greetings = [...(characterCard?.alternate_greetings ?? [])].filter(
            (item) => item.id !== id
        )
        setAltSwipeIndex(0)
        setCharacterCardEdited({ ...characterCard, alternate_greetings: greetings })
    }

    const handleDeleteAltMessage = async () => {
        Alert.alert({
            title: `Delete Alternate Message`,
            description: `Are you sure you want to delete this alternate message? This cannot be undone.`,
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Delete',
                    onPress: async () => {
                        await deleteAltMessageRoutine()
                    },
                    type: 'warning',
                },
            ],
        })
    }

    return (
        <FadeDownView style={styles.mainContainer}>
            <HeaderTitle title="Edit Character" />
            <AvatarViewer editorButton={false} />
            {characterCard && (
                <ScrollView
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="always"
                    contentContainerStyle={{ rowGap: 16, paddingBottom: 24 }}>
                    <View style={styles.characterHeader}>
                        <PopupMenu
                            placement="right"
                            options={[
                                {
                                    label: 'Change Image',
                                    icon: 'picture',
                                    onPress: (menuRef: RefObject<PopupMenuHandle>) => {
                                        menuRef.current?.close()
                                        handleImportImage()
                                    },
                                },
                                {
                                    label: 'View Image',
                                    icon: 'search1',
                                    onPress: (menuRef: RefObject<PopupMenuHandle>) => {
                                        menuRef.current?.close()
                                        setShowViewer(true)
                                    },
                                },
                                {
                                    label: 'Delete Image',
                                    icon: 'delete',
                                    onPress: (menuRef: RefObject<PopupMenuHandle>) => {
                                        menuRef.current?.close()
                                        handleDeleteImage()
                                    },
                                    warning: true,
                                },
                                {
                                    label: 'Export Character',
                                    icon: 'download',
                                    onPress: (menuRef: RefObject<PopupMenuHandle>) => {
                                        menuRef.current?.close()
                                        handleExportCard()
                                    },
                                },
                            ]}>
                            <Avatar
                                targetImage={Characters.getImageDir(currentCard?.image_id ?? -1)}
                                style={styles.avatar}
                            />
                            <AntDesign
                                name="edit"
                                color={color.text._100}
                                style={styles.editHover}
                            />
                        </PopupMenu>

                        <View style={styles.characterHeaderInfo}>
                            <View style={styles.buttonContainer}>
                                <ThemedButton
                                    iconName="delete"
                                    iconSize={20}
                                    variant="critical"
                                    label="Delete"
                                    onPress={handleDeleteCard}
                                />
                                {edited && (
                                    <ThemedButton
                                        iconName="save"
                                        iconSize={20}
                                        label="Save"
                                        onPress={handleSaveCard}
                                    />
                                )}
                            </View>
                            <ThemedTextInput
                                onChangeText={(mes) => {
                                    setCharacterCardEdited({
                                        ...characterCard,
                                        name: mes,
                                    })
                                }}
                                value={characterCard?.name}
                            />
                        </View>
                    </View>

                    <ThemedTextInput
                        scrollEnabled
                        label={`Description Tokens: ${getTokenCount(characterCard?.description ?? '')}`}
                        multiline
                        numberOfLines={8}
                        onChangeText={(mes) => {
                            setCharacterCardEdited({
                                ...characterCard,
                                description: mes,
                            })
                        }}
                        value={characterCard?.description}
                    />

                    <ThemedTextInput
                        label="First Message"
                        multiline
                        onChangeText={(mes) => {
                            setCharacterCardEdited({
                                ...characterCard,
                                first_mes: mes,
                            })
                        }}
                        value={characterCard?.first_mes}
                        numberOfLines={8}
                    />

                    <View
                        style={{
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                        }}>
                        <Text style={{ color: color.text._100 }}>
                            Alternate Greetings
                            {characterCard.alternate_greetings.length !== 0 && (
                                <Text
                                    style={{
                                        color: color.text._100,
                                    }}>
                                    {altSwipeIndex + 1} / {characterCard.alternate_greetings.length}
                                </Text>
                            )}
                        </Text>

                        <View style={{ flexDirection: 'row', columnGap: 32 }}>
                            <TouchableOpacity onPress={handleDeleteAltMessage}>
                                {characterCard.alternate_greetings.length !== 0 && (
                                    <AntDesign color={color.error._400} name="delete" size={20} />
                                )}
                            </TouchableOpacity>
                            {characterCard.alternate_greetings.length > 0 && (
                                <TouchableOpacity
                                    onPress={() =>
                                        setAltSwipeIndex(Math.max(altSwipeIndex - 1, 0))
                                    }>
                                    <AntDesign
                                        color={
                                            altSwipeIndex === 0 ? color.text._700 : color.text._100
                                        }
                                        name="left"
                                        size={20}
                                    />
                                </TouchableOpacity>
                            )}
                            {altSwipeIndex === characterCard.alternate_greetings.length - 1 ||
                            characterCard.alternate_greetings.length === 0 ? (
                                <TouchableOpacity onPress={handleAddAltMessage}>
                                    <AntDesign color={color.text._100} name="plus" size={20} />
                                </TouchableOpacity>
                            ) : (
                                <TouchableOpacity
                                    onPress={() =>
                                        setAltSwipeIndex(
                                            Math.min(
                                                altSwipeIndex + 1,
                                                characterCard.alternate_greetings.length - 1
                                            )
                                        )
                                    }>
                                    <AntDesign color={color.text._100} name="right" size={20} />
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>

                    {characterCard.alternate_greetings.length !== 0 ? (
                        <ThemedTextInput
                            multiline
                            numberOfLines={8}
                            onChangeText={(mes) => {
                                if (!characterCard) {
                                    Logger.errorToast(
                                        'Character card is undefined during text change.'
                                    )
                                    return
                                }
                                const greetings = [...characterCard.alternate_greetings]
                                const greeting = greetings[altSwipeIndex]
                                if (!greeting) {
                                    Logger.errorToast(
                                        'Alternate greeting is undefined at the current index.'
                                    )
                                    return
                                }
                                greeting.greeting = mes
                                setCharacterCardEdited({
                                    ...characterCard,
                                    alternate_greetings: greetings,
                                })
                            }}
                            value={
                                characterCard?.alternate_greetings?.[altSwipeIndex]?.greeting ?? ''
                            }
                        />
                    ) : (
                        <Text
                            style={{
                                borderColor: color.neutral._400,
                                borderWidth: 1,
                                borderRadius: 8,
                                padding: spacing.m,
                                color: color.text._500,
                                fontStyle: 'italic',
                            }}>
                            No Alternate Greetings
                        </Text>
                    )}

                    <ThemedTextInput
                        label="Personality"
                        multiline
                        numberOfLines={2}
                        onChangeText={(mes) => {
                            setCharacterCardEdited({
                                ...characterCard,
                                personality: mes,
                            })
                        }}
                        value={characterCard?.personality}
                    />

                    <ThemedTextInput
                        label="Scenario"
                        multiline
                        onChangeText={(mes) => {
                            setCharacterCardEdited({
                                ...characterCard,
                                scenario: mes,
                            })
                        }}
                        value={characterCard?.scenario}
                        numberOfLines={3}
                    />

                    <ThemedTextInput
                        label="Example Messages"
                        multiline
                        onChangeText={(mes) => {
                            setCharacterCardEdited({
                                ...characterCard,
                                mes_example: mes,
                            })
                        }}
                        value={characterCard?.mes_example}
                        numberOfLines={8}
                    />

                    <StringArrayEditor
                        label="Tags"
                        suggestions={data?.data
                            ?.map((item) => item.tag)
                            .filter((a) => !characterCard?.tags.some((item) => item.tag.tag === a))}
                        showSuggestionsOnEmpty
                        value={characterCard?.tags.map((item) => item.tag.tag) ?? []}
                        setValue={(value) => {
                            if (!characterCard) return
                            const newTags = value
                                .filter((v) => !characterCard.tags.some((a) => a.tag.tag === v))
                                .map((a) => {
                                    const existing = data?.data.filter(
                                        (item) => item.tag === a
                                    )?.[0]
                                    if (existing) {
                                        return { tag_id: existing.id, tag: existing }
                                    }
                                    return { tag_id: -1, tag: { tag: a, id: -1 } }
                                })
                            setCharacterCardEdited({
                                ...characterCard,
                                tags: [
                                    ...characterCard.tags.filter((v) =>
                                        value.some((a) => a === v.tag.tag)
                                    ),
                                    ...newTags,
                                ],
                            })
                        }}
                    />
                </ScrollView>
            )}
        </FadeDownView>
    )
}

const useStyles = () => {
    const { color, spacing } = Theme.useTheme()
    return StyleSheet.create({
        mainContainer: {
            flex: 1,
        },
        characterHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            padding: spacing.m,
        },
        avatar: {
            width: 80,
            height: 80,
            borderRadius: 40,
        },
        editHover: {
            position: 'absolute',
            bottom: 0,
            right: 0,
            backgroundColor: color.neutral._100,
            borderRadius: 12,
            padding: 4,
        },
        characterHeaderInfo: {
            flex: 1,
            marginLeft: spacing.m,
        },
        buttonContainer: {
            flexDirection: 'row',
            justifyContent: 'flex-end',
            marginBottom: spacing.s,
        },
    })
}

export default CharacterEditor
