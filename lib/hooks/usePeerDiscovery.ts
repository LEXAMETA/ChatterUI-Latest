// lib/hooks/usePeerDiscovery.ts

import { useEffect, useState, useRef } from 'react'
import { Platform, PermissionsAndroid, Alert } from 'react-native'
// @ts-ignore
import WiFiP2PModule from 'react-native-wifi-p2p' // cast to any to avoid TS errors

import { Logger } from '../state/Logger'
const WiFiP2P = WiFiP2PModule as any

// Discovered peer info interface
export interface DiscoveredPeerInfo {
    deviceAddress: string
    deviceName: string
    isConnected: boolean
    isGroupOwner: boolean
    status: string
    ipAddress?: string
    model?: string
    load?: number
    lastSeen?: number
}

export type PeerDiscoveryStatus =
    | 'Idle'
    | 'Initializing'
    | 'Permissions Required'
    | 'Scanning'
    | 'Connecting'
    | 'Connected'
    | 'Disconnected'
    | 'Error'

export const usePeerDiscovery = () => {
    const [peers, setPeers] = useState<DiscoveredPeerInfo[]>([])
    const [discoveryStatus, setDiscoveryStatus] = useState<PeerDiscoveryStatus>('Initializing')
    const [groupInfo, setGroupInfo] = useState<any>(null)
    const isScanningRef = useRef(false)

    // Request Android permissions, typed granted to avoid TS7053 errors
    const requestPermissions = async (): Promise<boolean> => {
        if (Platform.OS === 'android') {
            try {
                const granted: { [key: string]: 'granted' | 'denied' | 'never_ask_again' } =
                    await PermissionsAndroid.requestMultiple([
                        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                        PermissionsAndroid.PERMISSIONS.CHANGE_WIFI_STATE,
                        PermissionsAndroid.PERMISSIONS.ACCESS_WIFI_STATE,
                        (PermissionsAndroid.PERMISSIONS as any).NEARBY_WIFI_DEVICES, // Android 13+
                    ])

                const allGranted =
                    granted['android.permission.ACCESS_FINE_LOCATION'] ===
                        PermissionsAndroid.RESULTS.GRANTED &&
                    granted['android.permission.CHANGE_WIFI_STATE'] ===
                        PermissionsAndroid.RESULTS.GRANTED &&
                    granted['android.permission.ACCESS_WIFI_STATE'] ===
                        PermissionsAndroid.RESULTS.GRANTED &&
                    (Platform.Version < 33 ||
                        granted['android.permission.NEARBY_WIFI_DEVICES'] ===
                            PermissionsAndroid.RESULTS.GRANTED)

                if (allGranted) {
                    Logger.info('All necessary WiFi P2P permissions granted.')
                    return true
                } else {
                    Logger.warn('One or more WiFi P2P permissions denied.')
                    Alert.alert(
                        'Permissions Required',
                        'Please grant all necessary permissions for WiFi Direct functionality.'
                    )
                    setDiscoveryStatus('Permissions Required')
                    return false
                }
            } catch (err: any) {
                Logger.error('Error requesting WiFi P2P permissions:', err)
                setDiscoveryStatus('Error')
                return false
            }
        }
        return true
    }

    // Initialize WiFi P2P module and add listeners
    const initP2P = async () => {
        if (Platform.OS === 'android') {
            const hasPermissions = await requestPermissions()
            if (!hasPermissions) return

            try {
                await WiFiP2P.init()
                Logger.info('WiFi P2P initialized successfully.')
                setDiscoveryStatus('Idle')
                addP2PListeners()
            } catch (err: any) {
                Logger.error('Failed to initialize WiFi P2P:', err)
                setDiscoveryStatus('Error')
            }
        } else {
            Logger.warn('WiFi P2P is Android-only. Not supported on iOS.')
            setDiscoveryStatus('Error')
        }
    }

    const startDiscovery = async () => {
        if (Platform.OS !== 'android' || isScanningRef.current) return
        setDiscoveryStatus('Scanning')
        isScanningRef.current = true
        Logger.info('Starting WiFi P2P discovery...')
        try {
            await WiFiP2P.discoverPeers()
            Logger.info('WiFi P2P discovery started.')
        } catch (err: any) {
            Logger.error('Failed to start WiFi P2P discovery:', err)
            setDiscoveryStatus('Error')
        }
    }

    const stopDiscovery = async () => {
        if (Platform.OS !== 'android' || !isScanningRef.current) return
        try {
            await WiFiP2P.stopPeerDiscovery()
            Logger.info('WiFi P2P discovery stopped.')
        } catch (err: any) {
            Logger.error('Failed to stop WiFi P2P discovery:', err)
        } finally {
            setDiscoveryStatus('Idle')
            isScanningRef.current = false
        }
    }

    const addP2PListeners = () => {
        WiFiP2P.on('peersUpdated', (devices: any[]) => {
            Logger.info(`Discovered ${devices.length} WiFi P2P peers.`)
            const newPeers: DiscoveredPeerInfo[] = devices.map((d) => ({
                deviceAddress: d.deviceAddress,
                deviceName: d.deviceName,
                isConnected: d.status === 0,
                isGroupOwner: false,
                status: getP2PStatusText(d.status),
            }))
            setPeers(newPeers)
            setDiscoveryStatus('Scanning')
        })

        WiFiP2P.on('connectionInfoUpdated', (info: any) => {
            Logger.info('WiFi P2P Connection Info Updated:', JSON.stringify(info))
            setGroupInfo(info)
            if (info.groupFormed) {
                setDiscoveryStatus('Connected')
                const localIp = info.isGroupOwner ? '192.168.49.1' : info.groupOwnerAddress
                Logger.info(`Local IP in P2P group: ${localIp}`)
                setPeers((prev) =>
                    prev.map((p) => ({
                        ...p,
                        ipAddress:
                            p.deviceAddress === info.groupOwnerAddress && !info.isGroupOwner
                                ? info.groupOwnerAddress
                                : p.deviceAddress === info.deviceAddress && info.isGroupOwner
                                  ? '192.168.49.1'
                                  : p.ipAddress,
                        isConnected: info.groupFormed,
                        isGroupOwner: info.isGroupOwner,
                    }))
                )
            } else {
                setDiscoveryStatus('Idle')
                setGroupInfo(null)
                setPeers((prev) =>
                    prev.map((p) => ({
                        ...p,
                        ipAddress: undefined,
                        isConnected: false,
                        isGroupOwner: false,
                    }))
                )
            }
        })

        WiFiP2P.on('thisDeviceChanged', (device: any) => {
            Logger.info('This Device Info Changed:', JSON.stringify(device))
            // Track this device info if needed
        })

        WiFiP2P.on('disconnect', () => {
            Logger.info('WiFi P2P Disconnected.')
            setDiscoveryStatus('Disconnected')
            setGroupInfo(null)
            setPeers([])
        })
    }

    const getP2PStatusText = (status: number) => {
        switch (status) {
            case 0:
                return 'CONNECTED'
            case 1:
                return 'INVITED'
            case 2:
                return 'FAILED'
            case 3:
                return 'AVAILABLE'
            case 4:
                return 'UNAVAILABLE'
            default:
                return 'UNKNOWN'
        }
    }

    useEffect(() => {
        initP2P()
        return () => {
            // If library supports removing all listeners:
            if (WiFiP2P.removeListeners) {
                WiFiP2P.removeListeners()
            }
            stopDiscovery()
            if (groupInfo?.groupFormed) {
                WiFiP2P.removeGroup().catch((e: any) =>
                    Logger.error('Failed to remove P2P group on unmount:', e)
                )
            }
            Logger.info('WiFi P2P cleanup on unmount.')
        }
    }, [])

    return {
        peers,
        discoveryStatus,
        groupInfo,
        startDiscovery,
        stopDiscovery,
        requestPermissions,
        connectToPeer: async (peer: DiscoveredPeerInfo) => {
            if (Platform.OS !== 'android') {
                Alert.alert('Not Supported', 'WiFi Direct connection is only supported on Android.')
                return
            }
            setDiscoveryStatus('Connecting')
            Logger.info(`Connecting to peer ${peer.deviceName} (${peer.deviceAddress})`)
            try {
                await WiFiP2P.connect(peer.deviceAddress)
                Logger.info('Connection request sent.')
            } catch (e: any) {
                Logger.error(`Failed to connect to peer ${peer.deviceName}:`, e)
                setDiscoveryStatus('Error')
                Alert.alert(
                    'Connection Failed',
                    `Could not connect to ${peer.deviceName}: ${e.message}`
                )
            }
        },
        removeGroup: async () => {
            if (Platform.OS !== 'android') return
            try {
                await WiFiP2P.removeGroup()
                Logger.info('P2P Group removed.')
                setGroupInfo(null)
                setDiscoveryStatus('Idle')
                setPeers((prev) =>
                    prev.map((p) => ({
                        ...p,
                        ipAddress: undefined,
                        isConnected: false,
                        isGroupOwner: false,
                    }))
                )
            } catch (e: any) {
                Logger.error('Failed to remove P2P group:', e)
                Alert.alert('Group Removal Failed', `Could not remove P2P group: ${e.message}`)
            }
        },
    }
}
