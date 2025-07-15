// lib/hooks/usePeerDiscovery.ts

import { useEffect, useState, useRef } from 'react'
import { Platform, PermissionsAndroid, Alert } from 'react-native'
import WiFiP2P from 'react-native-wifi-p2p'

import { Logger } from '../state/Logger'

// Define the structure for a discovered peer's information that we care about
export interface DiscoveredPeerInfo {
    deviceAddress: string // MAC address or unique identifier from WiFi Direct
    deviceName: string // Friendly name of the device
    // You'll need a way to get the actual IP and AI capabilities.
    // This might involve establishing a temporary connection and running a small discovery protocol over TCP.
    // For now, we'll just track the basic WiFi Direct peer info.
    isConnected: boolean // True if currently connected via P2P group
    isGroupOwner: boolean // True if this device is the P2P group owner
    status: string // WiFi Direct status (e.g., 'CONNECTED', 'AVAILABLE', 'INVITED', 'FAILED', 'UNAVAILABLE')
    // Add more fields as you define your peer-to-peer info exchange protocol
    ipAddress?: string // This will be crucial later, and obtained after group formation
    model?: string // e.g., 'llama-3-8b'
    load?: number // e.g., 0.1 (0-1.0)
    lastSeen?: number // Timestamp
}

export type PeerDiscoveryStatus =
    | 'Idle'
    | 'Initializing'
    | 'Permissions Required'
    | 'Scanning'
    | 'Connecting'
    | 'Connected'
    | 'Error'

export const usePeerDiscovery = () => {
    const [peers, setPeers] = useState<DiscoveredPeerInfo[]>([])
    const [discoveryStatus, setDiscoveryStatus] = useState<PeerDiscoveryStatus>('Initializing')
    const [groupInfo, setGroupInfo] = useState<any>(null) // Stores information about the P2P group (e.g., group owner IP)

    const isScanningRef = useRef(false) // To prevent multiple simultaneous scans

    // --- Utility to request permissions ---
    const requestPermissions = async (): Promise<boolean> => {
        if (Platform.OS === 'android') {
            try {
                const granted = await PermissionsAndroid.requestMultiple([
                    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                    PermissionsAndroid.PERMISSIONS.CHANGE_WIFI_STATE,
                    PermissionsAndroid.PERMISSIONS.ACCESS_WIFI_STATE,
                    // For Android 13 (API 33) and above:
                    (PermissionsAndroid.PERMISSIONS as any).NEARBY_WIFI_DEVICES,
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
        return true // Permissions not needed for iOS (or not applicable for WiFi Direct)
    }

    // --- Initialize WiFi P2P ---
    const initP2P = async () => {
        if (Platform.OS === 'android') {
            const hasPermissions = await requestPermissions()
            if (!hasPermissions) return

            try {
                await WiFiP2P.init()
                Logger.info('WiFi P2P initialized successfully.')
                setDiscoveryStatus('Idle')
                // Start listeners for P2P events
                addP2PListeners()
            } catch (err: any) {
                Logger.error('Failed to initialize WiFi P2P:', err)
                setDiscoveryStatus('Error')
            }
        } else {
            // For iOS, WiFi P2P (WiFi Direct) is not directly exposed as a system feature
            // for app-to-app communication in the same way as Android.
            // iOS uses Multipeer Connectivity Framework for similar ad-hoc peer-to-peer.
            // You'll need to decide if you're supporting iOS for swarm or only Android.
            Logger.warn('WiFi P2P is primarily an Android feature. Discovery not available on iOS.')
            setDiscoveryStatus('Error') // Or 'Not Supported'
        }
    }

    // --- Start WiFi Direct Peer Discovery ---
    const startDiscovery = async () => {
        if (Platform.OS !== 'android' || isScanningRef.current) return

        setDiscoveryStatus('Scanning')
        Logger.info('Starting WiFi P2P discovery...')
        isScanningRef.current = true
        try {
            await WiFiP2P.discoverPeers()
            Logger.info('WiFi P2P discovery started.')
        } catch (err: any) {
            Logger.error('Failed to start WiFi P2P discovery:', err)
            setDiscoveryStatus('Error')
        } finally {
            // Discovery runs for a period, it doesn't immediately stop.
            // We might want to set a timeout to reset isScanningRef.current later,
            // or rely on 'peersUpdated' listener to update the list.
            // For now, let's keep it true while discovery process is active.
        }
    }

    // --- Stop WiFi Direct Peer Discovery ---
    const stopDiscovery = async () => {
        if (Platform.OS !== 'android' || !isScanningRef.current) return
        try {
            await WiFiP2P.stopPeerDiscovery()
            Logger.info('WiFi P2P discovery stopped.')
        } catch (err: any) {
            Logger.error('Failed to stop WiFi P2P discovery:', err)
        } finally {
            isScanningRef.current = false
            setDiscoveryStatus('Idle')
        }
    }

    // --- Add WiFi P2P Event Listeners ---
    const addP2PListeners = () => {
        WiFiP2P.on('peersUpdated', (devices: any[]) => {
            Logger.info(`Discovered ${devices.length} WiFi P2P peers.`)
            // Map discovered devices to our DiscoveredPeerInfo interface
            const newPeers: DiscoveredPeerInfo[] = devices.map((d) => ({
                deviceAddress: d.deviceAddress,
                deviceName: d.deviceName,
                isConnected: d.status === 'CONNECTED',
                isGroupOwner: false, // This will be updated after group info is known
                status: getP2PStatusText(d.status),
            }))
            setPeers(newPeers)
            setDiscoveryStatus('Scanning') // Keep status as scanning while peers are updated
        })

        WiFiP2P.on('connectionInfoUpdated', (info: any) => {
            Logger.info('WiFi P2P Connection Info Updated:', JSON.stringify(info, null, 2))
            setGroupInfo(info) // Save group information
            if (info.groupFormed) {
                Logger.info('P2P Group Formed!')
                setDiscoveryStatus('Connected')
                const localIp = info.isGroupOwner ? '192.168.49.1' : info.groupOwnerAddress
                Logger.info(`Local IP in P2P group: ${localIp}`)

                setPeers((prevPeers) =>
                    prevPeers.map((p) => ({
                        ...p,
                        ipAddress:
                            p.deviceAddress === info.groupOwnerAddress && !info.isGroupOwner
                                ? info.groupOwnerAddress
                                : p.deviceAddress === info.deviceAddress && info.isGroupOwner
                                  ? '192.168.49.1' // This device's GO IP
                                  : p.ipAddress, // Keep existing if not the GO or current client
                        isConnected: info.groupFormed,
                        isGroupOwner: info.isGroupOwner,
                    }))
                )
            } else {
                setDiscoveryStatus('Idle')
                Logger.info('P2P Group Disbanded.')
                setGroupInfo(null)
                setPeers((prevPeers) =>
                    prevPeers.map((p) => ({
                        ...p,
                        ipAddress: undefined,
                        isConnected: false,
                        isGroupOwner: false,
                    }))
                )
            }
        })

        WiFiP2P.on('thisDeviceChanged', (device: any) => {
            Logger.info('This Device Info Changed:', JSON.stringify(device, null, 2))
            // You can get this device's own P2P details here
        })

        WiFiP2P.on('disconnect', () => {
            Logger.info('WiFi P2P Disconnected.')
            setDiscoveryStatus('Disconnected')
            setGroupInfo(null)
            setPeers([]) // Clear peers on full disconnect
        })
    }

    // --- Helper to get human-readable status text ---
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

    // --- Main Effect Hook ---
    useEffect(() => {
        initP2P()

        // Clean up on unmount
        return () => {
            // Remove all listeners
            WiFiP2P.removeListeners() // This might not exist, depends on library's API
            // Safer: remove specific listeners if you added them with specific callbacks
            // WiFiP2P.on'peersUpdated'(null); // Check library docs for how to remove specific listeners

            // It's good to stop discovery and remove group if formed
            stopDiscovery()
            if (groupInfo?.groupFormed) {
                WiFiP2P.removeGroup().catch((e) =>
                    Logger.error('Failed to remove P2P group on unmount:', e)
                )
            }
            Logger.info('WiFi P2P cleanup on unmount.')
        }
    }, []) // Empty dependency array means this runs once on mount and cleanup on unmount

    return {
        peers,
        discoveryStatus,
        groupInfo,
        startDiscovery,
        stopDiscovery,
        requestPermissions, // Expose for explicit permission requests if needed
        connectToPeer: async (peer: DiscoveredPeerInfo) => {
            if (Platform.OS !== 'android') {
                Alert.alert('Not Supported', 'WiFi Direct connection is only supported on Android.')
                return
            }
            setDiscoveryStatus('Connecting')
            Logger.info(`Attempting to connect to peer: ${peer.deviceName} (${peer.deviceAddress})`)
            try {
                await WiFiP2P.connect(peer.deviceAddress)
                Logger.info(
                    `Connection request sent to ${peer.deviceName}. Waiting for connectionInfoUpdated event.`
                )
                // Connection success is indicated by 'connectionInfoUpdated' event with groupFormed: true
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
                setPeers((prevPeers) =>
                    prevPeers.map((p) => ({
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
