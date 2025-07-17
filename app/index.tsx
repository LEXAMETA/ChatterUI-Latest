import HeaderTitle from '@components/views/HeaderTitle'
import { db } from '@db'
import { AntDesign } from '@expo/vector-icons'
import { AppSettings } from '@lib/constants/GlobalValues'
import { useLlama, type LlamaState } from '@lib/engine/Local/LlamaLocal'
import { useEngineData, type EngineDataState } from '@lib/state/EngineData' // Corrected import path
import useLocalAuth from '@lib/hooks/LocalAuth'
import { Logger } from '@lib/state/Logger'
import { useMMKVBoolean } from '@storage/MMKV';
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

  // --- FIX START ---
  // Get currentChatModel, loadCurrentChatModel, setLoadProgress from useLlama
  const { currentChatModel, loadCurrentChatModel, setLoadProgress } = useLlama(
    (state: LlamaState) => ({
      // lastModel is NOT on LlamaState, so remove it from here
      currentChatModel: state.currentChatModel,
      loadCurrentChatModel: state.loadCurrentChatModel,
      setLoadProgress: state.setLoadProgress,
    })
  )

  // Get lastModelLoaded from useEngineData
  const { lastModelLoaded } = useEngineData(
    (state: EngineDataState) => ({
      lastModelLoaded: state.lastModelLoaded, // <--- Correctly access from EngineDataState
    })
  );
  // --- FIX END ---

  useEffect(() => {
    const initApp = async () => {
      if (!success || !authorized) {
        // Don't proceed until migration and auth succeed
        return
      }

      startupApp()

      // Use lastModelLoaded from useEngineData, and rename variable for consistency if desired
      if (autoLoadLocal && lastModelLoaded && !currentChatModel) { // Use lastModelLoaded here
        Logger.info('Attempting to auto-load last used model...')
        setLoadProgress(0)
        try {
          const loadSuccess = await loadCurrentChatModel(lastModelLoaded) // Pass lastModelLoaded here
          if (loadSuccess) {
            Logger.infoToast(`Auto-loaded "${lastModelLoaded.name}".`)
          } else {
            Logger.errorToast(`Failed to auto-load "${lastModelLoaded.name}".`)
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

    // Add lastModelLoaded to the dependency array of useEffect
    initApp()
  }, [success, authorized, autoLoadLocal, lastModelLoaded, currentChatModel, loadCurrentChatModel, setLoadProgress])

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
