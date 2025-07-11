const IS_DEV = process.env.APP_VARIANT === 'development'

module.exports = {
    expo: {
        name: IS_DEV ? 'ChatterUI-Latest (DEV)' : 'ChatterUI-Latest',
        newArchEnabled: true,
        slug: 'chatterui-latest',
        version: '0.1.0',
        orientation: 'default',
        icon: './assets/images/icon.png',
        scheme: 'chattcp-test',
        userInterfaceStyle: 'automatic',
        assetBundlePatterns: ['**/*'],
        ios: {
            icon: {
                dark: './assets/images/ios-dark.png',
                light: './assets/images/ios-light.png',
                tinted: './assets/images/icon.png',
            },
            supportsTablet: true,
            package: IS_DEV ? 'ChatterUI-Latest.test' : 'ChatterUI-Latest.test',
            bundleIdentifier: IS_DEV ? 'ChatterUI-Latest.test' : 'ChatterUI-Latest.test',
        },
        android: {
            adaptiveIcon: {
                foregroundImage: './assets/images/adaptive-icon-foreground.png',
                backgroundImage: './assets/images/adaptive-icon-background.png',
                monochromeImage: './assets/images/adaptive-icon-foreground.png',
                backgroundColor: '#000',
            },
            package: IS_DEV ? 'ChatterUI-Latest.test' : 'ChatterUI-Latest.test',
            userInterfaceStyle: 'dark',
            permissions: [
                'android.permission.FOREGROUND_SERVICE',
                'android.permission.WAKE_LOCK',
                'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
            ],
        },
        web: {
            bundler: 'metro',
            output: 'static',
            favicon: './assets/images/adaptive-icon.png',
        },
        plugins: [
            [
                'expo-asset',
                {
                    assets: ['./assets/models/aibot.png', './assets/models/llama3tokenizer.gguf'],
                },
            ],
            [
                'expo-build-properties',
                {
                    android: {
                        largeHeap: true,
                        usesCleartextTraffic: true,
                        enableProguardInReleaseBuilds: true,
                        enableShrinkResourcesInReleaseBuilds: true,
                        useLegacyPackaging: true,
                        extraProguardRules: '-keep class com.rnllama.** { *; }',
                    },
                },
            ],
            [
                'expo-splash-screen',
                {
                    backgroundColor: '#000000',
                    image: './assets/images/adaptive-icon.png',
                    imageWidth: 200,
                },
            ],
            [
                'expo-notifications',
                {
                    icon: './assets/images/notification.png',
                },
            ],
            [
                './expo-build-plugins/androidattributes.plugin.js',
                {
                    'android:largeHeap': true,
                },
            ],
            'expo-localization',
            'expo-router',
            'expo-sqlite',
            './expo-build-plugins/bgactions.plugin.js',
            './expo-build-plugins/copyjni.plugin.js',
            './expo-build-plugins/usercert.plugin.js',
        ],
        experiments: {
            typedRoutes: true,
        },
        extra: {
            router: {
                origin: false,
            },
            eas: {
                projectId: '97c3263e-6c06-4869-8669-a571aaa37c5b',
            },
            // --- ADD THIS NEW LINE ---
            EXPO_PUBLIC_BUILD_TARGET: process.env.EXPO_PUBLIC_BUILD_TARGET || 'native',
        },
    },
}
