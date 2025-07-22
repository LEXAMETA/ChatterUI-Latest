// app/screens/ChatMenu/ChatWindow/ChatModelName.tsx

import { Ionicons } from '@expo/vector-icons'
import { useLlama, LlamaState } from '@lib/engine/Local/LlamaLocal' // Import LlamaState for typing
import { Theme } from '@lib/theme/ThemeManager'
import { useRouter } from 'expo-router'
import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'

const ChatModelName = () => {
    // Use typed selector for currentChatModel from Zustand store
    const model = useLlama((state: LlamaState) => state.currentChatModel)
    const { color, spacing, borderRadius } = Theme.useTheme()
    const router = useRouter()

    return (
        <View
            style={{
                marginVertical: spacing.s,
                marginHorizontal: spacing.xl,
                backgroundColor: color.neutral._200,
                borderRadius: borderRadius.m,
                paddingHorizontal: spacing.xl,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
            }}>
            <Text
                numberOfLines={1}
                style={{
                    overflow: 'hidden',
                    flex: 1,
                    color: model ? color.primary._700 : color.text._400,
                }}
                accessibilityLabel={model ? `Current model: ${model.name}` : 'No model loaded'}>
                {model ? model.name : 'No Model Loaded'}
            </Text>
            <TouchableOpacity
                onPress={() => router.push('/screens/ModelManager')}
                style={{ paddingLeft: spacing.xl2, paddingVertical: spacing.m }}
                accessibilityRole="button"
                accessibilityHint="Navigate to Model Manager screen">
                <Ionicons name="caret-forward" color={color.primary._500} size={18} />
            </TouchableOpacity>
        </View>
    )
}

export default ChatModelName
