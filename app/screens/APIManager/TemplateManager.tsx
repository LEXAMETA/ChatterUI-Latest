// app/screens/APIManager/TemplateManager.tsx

import React from 'react'
import ThemedButton from '@components/buttons/ThemedButton'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { APIState } from '@lib/engine/API/APIManagerState'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'
import { getDocumentAsync } from 'expo-document-picker'
import { readAsStringAsync } from 'expo-file-system'
import { Stack } from 'expo-router'
import { FlatList, Text, View } from 'react-native'

import TemplateItem from './TemplateItem'

const TemplateManager = () => {
  // eslint-disable-next-line react-compiler/react-compiler
  'use no memo'
  const { templates, addTemplate } = APIState.useAPIState((state) => ({
    templates: state.customTemplates,
    addTemplate: state.addTemplate,
  }))

  const { color, spacing } = Theme.useTheme()

  const handleAddTemplate = async () => {
    try {
      const result = await getDocumentAsync()
      if (result.canceled) return

      // Defensive check for uri
      const uri = result.assets?.[0]?.uri
      if (!uri) {
        Logger.errorToast('No file selected or file URI missing')
        return
      }

      const data = await readAsStringAsync(uri, { encoding: 'utf8' })
      try {
        const jsonData = JSON.parse(data)
        addTemplate(jsonData)
      } catch (e) {
        Logger.errorToast('Failed to Import: Invalid JSON')
      }
    } catch (error) {
      Logger.errorToast('Failed to Import Template')
      console.error('Template import error:', error)
    }
  }

  return (
    <View
      style={{
        paddingTop: spacing.xl,
        paddingHorizontal: spacing.xl,
        paddingBottom: spacing.xl2,
        flex: 1,
      }}
    >
      <Stack.Screen options={{ title: 'Template Manager' }} />
      {templates.length > 0 ? (
        <FlatList
          contentContainerStyle={{ rowGap: 4 }}
          data={templates}
          keyExtractor={(item) => item.name}
          renderItem={({ item, index }) => <TemplateItem item={item} index={index} />}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons
            name="file-question-outline"
            size={64}
            color={color.text._700}
          />
          <Text
            style={{
              color: color.text._400,
              fontStyle: 'italic',
              marginTop: spacing.l,
            }}
          >
            No Custom Templates Added
          </Text>
        </View>
      )}

      <ThemedButton onPress={handleAddTemplate} label="Add Template" />
    </View>
  )
}

export default TemplateManager
