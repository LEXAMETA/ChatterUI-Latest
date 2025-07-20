// app/screens/AppSettingsMenu/DatabaseSettings.tsx

import React from 'react'
import { Text, View } from 'react-native'
import ThemedButton from '@components/buttons/ThemedButton'
import SectionTitle from '@components/text/SectionTitle'
import Alert from '@components/views/Alert'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'
import { localDownload } from '@vali98/react-native-fs'
import appConfig from 'app.config'
import { reloadAppAsync } from 'expo'
import { getDocumentAsync } from 'expo-document-picker'
import { copyAsync, deleteAsync, documentDirectory } from 'expo-file-system'

const appVersion = appConfig.expo.version

const exportDB = async (notify: boolean = true) => {
  try {
    await localDownload(`${documentDirectory}/SQLite/db.db`.replace('file://', ''))
    if (notify) Logger.infoToast('Download Successful!')
  } catch (e) {
    Logger.errorToast('Failed to copy database: ' + e)
  }
}

const importDB = async (uri: string, name: string) => {
  const copyDB = async () => {
    try {
      await exportDB(false)
      await deleteAsync(`${documentDirectory}SQLite/db.db`).catch(() => {
        Logger.debug('Database already deleted before copying.')
      })
      await copyAsync({
        from: uri,
        to: `${documentDirectory}SQLite/db.db`,
      })
      Logger.info('Copy Successful, Restarting now.')
      await reloadAppAsync()
    } catch (e) {
      Logger.errorToast(`Failed to import database: ${e}`)
    }
  }

  const dbAppVersion = name.split('-')?.[0]
  if (dbAppVersion !== appVersion) {
    Alert.alert({
      title: `WARNING: Different Version`,
      description: `The imported database has app version (${dbAppVersion}) different from installed version (${appVersion}).\n\nImporting it may corrupt your data. It's recommended to use the same app version.`,
      buttons: [
        { label: 'Cancel' },
        { label: 'Import Anyways', onPress: copyDB, type: 'warning' },
      ],
    })
  } else {
    copyDB()
  }
}

const DatabaseSettings = () => {
  const { color, spacing } = Theme.useTheme()

  const handleImportPress = async () => {
    try {
      const result = await getDocumentAsync({ type: ['application/*'] })
      if (result.canceled) return

      // Filter for defined assets and take the first safe one
      const asset = result.assets?.filter(Boolean)[0]
      if (!asset || !asset.uri || !asset.name) {
        Logger.errorToast('Selected file is invalid.')
        return
      }

      Alert.alert({
        title: 'Import Database',
        description: 'Are you sure you want to import this database? This will overwrite the current one!\n\nA backup will automatically be downloaded.\n\nThe app will restart automatically.',
        buttons: [
          { label: 'Cancel' },
          {
            label: 'Import',
            onPress: () => importDB(asset.uri, asset.name),
            type: 'warning',
          },
        ],
      })
    } catch (error) {
      Logger.errorToast('Failed to import database.')
      console.error('Import database error:', error)
    }
  }

  return (
    <View style={{ rowGap: 8 }}>
      <SectionTitle>Database Management</SectionTitle>

      <Text
        style={{
          color: color.text._500,
          paddingBottom: spacing.xs,
          marginBottom: spacing.m,
        }}
      >
        WARNING: only import if you are certain it&apos;s from the same version!
      </Text>

      <ThemedButton
        label="Export Database"
        variant="secondary"
        onPress={() => {
          Alert.alert({
            title: 'Export Database',
            description:
              'Are you sure you want to export the database file?\n\nIt will automatically be downloaded to your device\'s Downloads folder.',
            buttons: [
              { label: 'Cancel' },
              { label: 'Export Database', onPress: exportDB },
            ],
          })
        }}
      />

      <ThemedButton label="Import Database" variant="secondary" onPress={handleImportPress} />
    </View>
  )
}

export default DatabaseSettings
