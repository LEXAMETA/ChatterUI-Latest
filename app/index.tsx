// app/index.tsx (Refined useEffect for auto-load)

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

// Prevent native splash screen from auto-hiding until App is ready
SplashScreen.preventAutoHideAsync()

const Home = () => {
    const { color } = Theme.useTheme()
    const styles = useStyles()
    const { success, error } = useMigrations(db, migrations)
    const { authorized, retry } = useLocalAuth()
    const [appReady, setAppReady] = useState(false) // New state to track overall app readiness

    const [autoLoadLocal] = useMMKVBoolean(AppSettings.AutoLoadLocal)
    const { lastModel, currentChatModel, loadCurrentChatModel, setLoadProgress } = Llama.useLlama(
        (state) => ({
            lastModel: state.lastModel,
            currentChatModel: state.currentChatModel,
            loadCurrentChatModel: state.loadCurrentChatModel,
            setLoadProgress: state.setLoadProgress,
        })
    )

    // Combined startup effect for migrations, authentication, and auto-load
    useEffect(() => {
        const initApp = async () => {
            // Wait for migrations and authentication
            if (!success || !authorized) {
                // If not ready, don't proceed with app startup or auto-load
                // and keep splash screen visible.
                return
            }

            // Perform initial app setup tasks (e.g., loading app-wide configs)
            startupApp() // This is your existing startupApp utility

            // Auto-load last model if enabled and no model loaded yet
            if (autoLoadLocal && lastModel && !currentChatModel) {
                Logger.info('Attempting to auto-load last used model...')
                setLoadProgress(0) // Reset progress if you have a startup progress bar
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

            // Load chat (if needed, consider if this is separate from auto-load model)
            // If loadChatOnInit does more than just model loading, keep it.
            // If it also loads the model, you might need to adjust it to prevent double-loading.
            // For now, let's assume it handles other chat-related setup.
            loadChatOnInit()

            // After all core startup logic is done, set app ready and hide splash screen
            setAppReady(true)
            SplashScreen.hideAsync()
        }

        initApp()
    }, [
        success,
        authorized,
        autoLoadLocal,
        lastModel,
        currentChatModel,
        loadCurrentChatModel,
        setLoadProgress,
    ]) // Depend on all relevant states

    // Rest of your component rendering logic remains the same
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

    // Use appReady state to determine when to render main content
    if (!appReady) {
        // Or render a custom loading indicator here
        return (
            <View style={styles.centeredContainer}>
                <HeaderTitle />
                <Text style={styles.title}>Loading App...</Text>
            </View>
        )
    }

    // Once app is ready, decide what to render (e.g., CharacterMenu or other default screen)
    // Assuming CharacterMenu is your main entry point after startup.
    return <CharacterMenu />

    /*
  // If you prefer to show navigation links instead of CharacterMenu immediately:
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
  */
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
