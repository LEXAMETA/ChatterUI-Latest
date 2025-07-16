import HeaderTitle from '@components/views/HeaderTitle'
import { db } from '@db'
import { AntDesign } from '@expo/vector-icons'
import { AppSettings } from '@lib/constants/GlobalValues'
import { Llama } from '@lib/engine/Local/LlamaLocal'
import useLocalAuth from '@lib/hooks/LocalAuth'
import { Logger } from '@lib/state/Logger'
import { useMMKVBoolean } from '@lib/storage/MMKV'
import { Theme } from '@lib/theme/ThemeManager'
import { loadChatOnInit, startupApp } from '@lib/utils/Startup'
import CharacterMenu from '@screens/CharacterMenu'
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator'
import { SplashScreen, Link } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import migrations from '../db/migrations/migrations'

SplashScreen.preventAutoHideAsync()

const Home = () => {
  const { color } = Theme.useTheme()
  const styles = useStyles()
  const { success, error } = useMigrations(db, migrations)
  const { authorized, retry } = useLocalAuth()
  const [appReady, setAppReady] = useState(false)

  const [autoLoadLocal] = useMMKVBoolean(AppSettings.AutoLoadLocal)
  const { lastModel, currentChatModel, loadCurrentChatModel, setLoadProgress } = Llama.useLlama(
    (state) => ({
      lastModel: state.lastModel,
      currentChatModel: state.currentChatModel,
      loadCurrentChatModel: state.loadCurrentChatModel,
      setLoadProgress: state.setLoadProgress,
    })
  )

  useEffect(() => {
    const initApp = async () => {
      if (!success || !authorized) {
        // Don't proceed until migration and auth succeed
        return
      }

      startupApp()

      if (autoLoadLocal && lastModel && !currentChatModel) {
        Logger.info('Attempting to auto-load last used model...')
        setLoadProgress(0)
        try {
          const loadSuccess = await loadCurrentChatModel(lastModel)
          if (loadSuccess) {
            Logger.infoToast(`Auto-loaded "${lastModel.name}".`)
          } else {
            Logger.errorToast(`Failed to auto-load "${lastModel.name}".`)
          }
        } catch (err: any) {
          Logger.errorToast(`Error during auto-load: ${err.message}`)
          console.error('Auto-load error:', err)
        }
      }

      loadChatOnInit()

      setAppReady(true)
      SplashScreen.hideAsync()
    }

    initApp()
  }, [success, authorized, autoLoadLocal, lastModel, currentChatModel, loadCurrentChatModel, setLoadProgress])

  if (error)
    return (
      <View style={styles.centeredContainer}>
        <HeaderTitle />
        <Text style={styles.title}>Database Migration Failed!</Text>
      </View>
    )

  if (!authorized)
    return (
      <View style={[styles.centeredContainer, { rowGap: 60 }]}>
        <HeaderTitle />
        <AntDesign name="lock" size={120} style={{ marginBottom: 12 }} color={color.text._500} />
        <Text style={styles.title}>Authentication Required</Text>
        <TouchableOpacity onPress={retry} style={styles.button}>
          <Text style={styles.buttonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    )

  if (!appReady) {
    return (
      <View style={styles.centeredContainer}>
        <HeaderTitle />
        <Text style={styles.title}>Loading App...</Text>
      </View>
    )
  }

  return <CharacterMenu />
}

export default Home

const useStyles = () => {
  const { color, spacing, fontSize, borderWidth } = Theme.useTheme()
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: color.neutral._100, // Changed from color.background._100
      alignItems: 'center',
      justifyContent: 'center',
    },
    centeredContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    title: {
      color: color.text._300,
      fontSize: fontSize.m, // Changed from fontSize.md
    },
    buttonText: {
      color: color.text._100,
    },
    button: {
      paddingVertical: spacing.l,
      paddingHorizontal: spacing.xl2,
      columnGap: spacing.m,
      borderRadius: spacing.xl2,
      borderWidth: borderWidth.m,
      borderColor: color.primary._500,
    },
    link: {
      marginTop: spacing.m,
      color: color.primary._500,
      fontSize: fontSize.m,
    },
  })
}
