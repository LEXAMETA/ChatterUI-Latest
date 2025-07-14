import HeaderTitle from '@components/views/HeaderTitle'
import { db } from '@db'
import { AntDesign } from '@expo/vector-icons'
import useLocalAuth from '@lib/hooks/LocalAuth'
import { Theme } from '@lib/theme/ThemeManager'
import { loadChatOnInit, startupApp } from '@lib/utils/Startup'
import CharacterMenu from '@screens/CharacterMenu'
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator'
import { SplashScreen, Link } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import migrations from '../db/migrations/migrations'

import { AppSettings } from '@lib/constants/GlobalValues'
import { Llama } from '@lib/engine/Local/LlamaLocal'
import { useMMKVBoolean } from '@lib/storage/MMKV'
import { Logger } from '@lib/state/Logger'

// Prevent native splash screen from auto-hiding until App is ready
SplashScreen.preventAutoHideAsync()

const Home = () => {
  const { color } = Theme.useTheme()
  const styles = useStyles()
  const { success, error } = useMigrations(db, migrations)
  const { authorized, retry } = useLocalAuth()
  const [firstRender, setFirstRender] = useState(true)

  const [autoLoadLocal] = useMMKVBoolean(AppSettings.AutoLoadLocal)
  const {
    lastModel,
    currentChatModel,
    loadCurrentChatModel,
    setLoadProgress,
  } = Llama.useLlama((state) => ({
    lastModel: state.lastModel,
    currentChatModel: state.currentChatModel,
    loadCurrentChatModel: state.loadCurrentChatModel,
    setLoadProgress: state.setLoadProgress,
  }))

  // Load chat on auth + migration success
  useEffect(() => {
    if (authorized && success) {
      loadChatOnInit()
    }
  }, [authorized, success])

  // Startup routine after migration success
  useEffect(() => {
    if (success) {
      startupApp()
      setFirstRender(false)
    }
  }, [success])

  // Auto-load last model if enabled and no model loaded yet
  useEffect(() => {
    const handleStartupLoad = async () => {
      if (autoLoadLocal && lastModel && !currentChatModel) {
        Logger.info('Attempting to auto-load last used model...')
        setLoadProgress(0)
        try {
          const success = await loadCurrentChatModel(lastModel)
          if (success) {
            Logger.infoToast(`Auto-loaded "${lastModel.name}".`)
          } else {
            Logger.errorToast(`Failed to auto-load "${lastModel.name}".`)
          }
        } catch (error: any) {
          Logger.errorToast(`Error during auto-load: ${error.message}`)
          console.error('Auto-load error:', error)
        }
      }
      SplashScreen.hideAsync()
    }
    handleStartupLoad()
  }, [autoLoadLocal, lastModel, currentChatModel, loadCurrentChatModel, setLoadProgress])

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
        <AntDesign
          name="lock"
          size={120}
          style={{ marginBottom: 12 }}
          color={color.text._500}
        />
        <Text style={styles.title}>Authentication Required</Text>
        <TouchableOpacity onPress={retry} style={styles.button}>
          <Text style={styles.buttonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    )

  if (!firstRender && success) return <CharacterMenu />

  // Default fallback UI with navigation links
  return (
    <View style={styles.container}>
      <HeaderTitle />
      <Link href="/ChatMenu" style={styles.link}>
        Go to Chat
      </Link>
      <Link href="/ModelManager" style={styles.link}>
        Manage Models
      </Link>
    </View>
  )
}

export default Home

const useStyles = () => {
  const { color, spacing, fontSize, borderWidth } = Theme.useTheme()
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: color.background._100,
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
      fontSize: fontSize.xl2,
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
      fontSize: fontSize.md,
    },
  })
}
