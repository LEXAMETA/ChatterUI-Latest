import SectionTitle from '@components/text/SectionTitle'
import { Llama } from '@lib/engine/Local/LlamaLocal'
import { usePeerDiscovery, DiscoveredPeerInfo } from '@lib/hooks/usePeerDiscovery'
import { initRagSystem, useGlobalRAGSystem, knowledgeBaseData } from '@lib/rag/ragSystem'
import { Logger } from '@lib/state/Logger'
import { tcpClientInstance, sendMockPrompt, Request, Response } from '@lib/tcp-client'
import { Theme } from '@lib/theme/ThemeManager'
import { Picker } from '@react-native-picker/picker'
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
    View,
    Text,
    TextInput,
    Button,
    Alert,
    ScrollView,
    ActivityIndicator,
    StyleSheet,
    Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface UsablePeer {
    ip: string
    model: string
    load: number
    lastSeen: number
    deviceName?: string
    deviceAddress?: string
    isConnected?: boolean
}

const mockLoRAs = ['default', 'anime-style', 'fantasy-lore']

const ChatMenu = () => {
    const { color, spacing, borderWidth, borderRadius } = Theme.useTheme()

    // Peer discovery hook
    const {
        peers: discoveredWifiDirectPeers,
        discoveryStatus,
        groupInfo,
        startDiscovery,
        stopDiscovery,
        requestPermissions,
        connectToPeer,
        removeGroup,
    } = usePeerDiscovery()

    // TCP swarm state
    const [availablePeers, setAvailablePeers] = useState<UsablePeer[]>([])
    const [selectedPeerIp, setSelectedPeerIp] = useState<string>('local')
    const [selectedLoRA, setSelectedLoRA] = useState<string>(mockLoRAs[0])
    const [tcpConnectionStatus, setTcpConnectionStatus] = useState<
        'Connected' | 'Connecting...' | 'Disconnected' | 'Error'
    >('Disconnected')

    // Chat state
    const [swarmChatPrompt, setSwarmChatPrompt] = useState<string>('')
    const [swarmChatResponse, setSwarmChatResponse] = useState<string[]>([])
    const [isSending, setIsSending] = useState<boolean>(false)

    // RAG system
    const { rag, loading: isRagLoading, error: ragError } = useGlobalRAGSystem()

    const scrollViewRef = useRef<ScrollView>(null)

    // Initialize RAG system on mount
    useEffect(() => {
        const loadRag = async () => {
            try {
                await initRagSystem(knowledgeBaseData)
                Logger.info('RAG System initialized successfully.')
            } catch (error: any) {
                Logger.error('Failed to initialize RAG System:', error)
                Alert.alert('Model Load Error', `Failed to initialize RAG system: ${error.message}`)
            }
        }
        loadRag()
    }, [])

    // WiFi Direct discovery management
    useEffect(() => {
        const setupDiscovery = async () => {
            if (Platform.OS === 'android') {
                const hasPerms = await requestPermissions()
                if (hasPerms) {
                    await startDiscovery()
                }
            }
        }
        setupDiscovery()
        return () => {
            stopDiscovery()
            removeGroup()
        }
    }, [])

    // Update availablePeers from discovered WiFi Direct peers and group info
    useEffect(() => {
        Logger.debug(`Discovered WiFi Direct peers: ${discoveredWifiDirectPeers.length}`)
        Logger.debug(`Group Info: ${JSON.stringify(groupInfo)}`)

        const updatedUsablePeers: UsablePeer[] = []

        discoveredWifiDirectPeers.forEach((p) => {
            let peerIp: string | undefined
            let isPeerConnected = false

            if (groupInfo?.groupFormed) {
                if (groupInfo.isGroupOwner) {
                    const client = groupInfo.clients?.find(
                        (c: any) => c.deviceAddress === p.deviceAddress
                    )
                    if (client) {
                        peerIp = client.ipAddress
                        isPeerConnected = true
                    }
                } else {
                    if (p.deviceAddress === groupInfo.groupOwnerAddress) {
                        peerIp = groupInfo.groupOwnerAddress
                        isPeerConnected = true
                    }
                }
            }

            if (peerIp) {
                updatedUsablePeers.push({
                    ip: peerIp,
                    model: `unknown-model-${p.deviceName?.substring(0, 5) ?? 'peer'}`,
                    load: Math.random() * 0.5,
                    lastSeen: Date.now(),
                    deviceName: p.deviceName,
                    deviceAddress: p.deviceAddress,
                    isConnected: isPeerConnected,
                })
            }
        })

        setAvailablePeers(updatedUsablePeers)

        if (
            selectedPeerIp !== 'local' &&
            !updatedUsablePeers.some((p) => p.ip === selectedPeerIp)
        ) {
            setSelectedPeerIp(updatedUsablePeers[0]?.ip || 'local')
        }
    }, [discoveredWifiDirectPeers, groupInfo])

    // TCP Client connection management
    useEffect(() => {
        tcpClientInstance.setStatusCallback(setTcpConnectionStatus)

        if (selectedPeerIp && selectedPeerIp !== 'local') {
            const peer = availablePeers.find((p) => p.ip === selectedPeerIp)
            if (peer?.ip) {
                tcpClientInstance.connect(peer.ip, 8080).catch((e) => {
                    Logger.error('TCP connect error:', e)
                })
            }
        } else {
            tcpClientInstance.disconnect()
        }

        return () => {
            tcpClientInstance.disconnect()
            tcpClientInstance.setStatusCallback(() => setTcpConnectionStatus('Disconnected'))
            setTcpConnectionStatus('Disconnected')
        }
    }, [selectedPeerIp, availablePeers])

    // Auto-scroll chat on new messages
    useEffect(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true })
    }, [swarmChatResponse])

    // Handlers
    const handleConnect = useCallback(async () => {
        const peerToConnect = discoveredWifiDirectPeers.find(
            (p) => p.deviceAddress === selectedPeerIp
        )
        if (peerToConnect) {
            await connectToPeer(peerToConnect)
        } else {
            Alert.alert('Connection Error', 'No WiFi Direct peer selected or found.')
        }
    }, [selectedPeerIp, discoveredWifiDirectPeers, connectToPeer])

    const handleDisconnect = useCallback(() => {
        tcpClientInstance.disconnect()
        setTcpConnectionStatus('Disconnected')
        removeGroup()
    }, [removeGroup])

    const handleRefreshPeers = useCallback(async () => {
        Logger.info('Refreshing WiFi Direct peers...')
        if (Platform.OS === 'android') {
            const hasPerms = await requestPermissions()
            if (hasPerms) {
                await startDiscovery()
            }
        } else {
            Alert.alert('Not Supported', 'Peer discovery is only supported on Android.')
        }
    }, [requestPermissions, startDiscovery])

    // Main chat send handler
    const handleSwarmChatSend = async () => {
        if (!swarmChatPrompt.trim()) return

        if (selectedPeerIp === 'local') {
            setIsSending(true)
            setSwarmChatResponse((prev) => [...prev, `You: ${swarmChatPrompt}`])
            setSwarmChatPrompt('')

            try {
                let finalResponseOutput = ''
                const { currentChatContext, currentChatModel } = Llama.useLlama.getState()

                if (rag && !isRagLoading && !ragError) {
                    Logger.info('[ChatMenu] Initiating RAG query...')
                    const ragGeneratedContent = await rag.generate(swarmChatPrompt)
                    Logger.info('[ChatMenu] RAG generated content:', ragGeneratedContent)

                    if (currentChatContext && currentChatModel) {
                        const finalPrompt = `
Context from knowledge base (derived by RAG system):
${ragGeneratedContent}

Based on the above context, answer the following user question:
User: ${swarmChatPrompt}
AI:
`.trim()

                        Logger.info(
                            '[ChatMenu] Sending final prompt to Main Chat Model:',
                            finalPrompt
                        )

                        await currentChatContext.completion({
                            prompt: finalPrompt,
                            onToken: (token: string) => {
                                finalResponseOutput += token
                            },
                        })

                        setSwarmChatResponse((prev) => [
                            ...prev,
                            `AI (Local): ${finalResponseOutput}`,
                        ])
                    } else {
                        throw new Error(
                            'Local AI (Main Chat Model) is not active. Please load it via settings or ensure auto-load is enabled.'
                        )
                    }
                } else if (ragError) {
                    throw new Error(`RAG System Error: ${ragError}`)
                } else {
                    if (currentChatContext && currentChatModel) {
                        Logger.warn(
                            '[ChatMenu] RAG System not ready. Falling back to direct Main Chat Model.'
                        )
                        const result = await currentChatContext.completion({
                            prompt: swarmChatPrompt,
                            stream: false,
                        })
                        finalResponseOutput = result.text
                        setSwarmChatResponse((prev) => [
                            ...prev,
                            `AI (Local, No RAG): ${finalResponseOutput}`,
                        ])
                    } else {
                        throw new Error('Local AI (Main Chat Model) not loaded.')
                    }
                }
            } catch (error: any) {
                setSwarmChatResponse((prev) => [...prev, `AI Error: ${error.message}`])
                Logger.error('AI generation error:', error)
                Alert.alert('AI Generation Failed', `Could not get AI response: ${error.message}`)
            } finally {
                setIsSending(false)
            }
        } else {
            const currentPeer = availablePeers.find((p) => p.ip === selectedPeerIp)
            if (!currentPeer) {
                Alert.alert('Send Error', 'Please select a peer before sending a message.')
                return
            }

            if (tcpConnectionStatus !== 'Connected') {
                setSwarmChatResponse((prev) => [
                    ...prev,
                    `Error: Not connected to ${currentPeer.ip}. Current status: ${tcpConnectionStatus}.`,
                ])
                Alert.alert(
                    'Connection Required',
                    `Please ensure TCP client is connected to ${currentPeer.ip}. Current status: ${tcpConnectionStatus}.`
                )
                return
            }

            setSwarmChatResponse((prev) => [...prev, `You: ${swarmChatPrompt}`])
            setSwarmChatPrompt('')
            setIsSending(true)

            try {
                const requestPayload: Request = {
                    type: 'prompt',
                    model: currentPeer.model,
                    prompt: swarmChatPrompt,
                    lora: selectedLoRA || undefined,
                }

                const response: Response =
                    process.env.EXPO_PUBLIC_BUILD_TARGET === 'web' || !tcpClientInstance.socket
                        ? await sendMockPrompt(requestPayload)
                        : await tcpClientInstance.send(requestPayload)

                if (response.status === 'success' && response.output) {
                    setSwarmChatResponse((prev) => [
                        ...prev,
                        `AI (${currentPeer.model} @ ${currentPeer.ip}): ${response.output}`,
                    ])
                } else if (response.status === 'error' && response.error) {
                    setSwarmChatResponse((prev) => [
                        ...prev,
                        `AI Error (${currentPeer.model} @ ${currentPeer.ip}): ${response.error}`,
                    ])
                    Alert.alert(
                        'AI Response Error',
                        `Peer responded with an error: ${response.error}`
                    )
                } else {
                    setSwarmChatResponse((prev) => [...prev, `AI Response: Unexpected format`])
                    Alert.alert('AI Response Error', `Peer responded with an unexpected format.`)
                }
            } catch (error: any) {
                setSwarmChatResponse((prev) => [...prev, `AI Error: ${error.message}`])
                Logger.error('Swarm chat send error:', error)
                Alert.alert('Send Failed', `Could not get AI response: ${error.message}`)
            } finally {
                setIsSending(false)
            }
        }
    }

    // UI Helpers
    const getConnectionStatusColor = () => {
        switch (tcpConnectionStatus) {
            case 'Connected':
                return 'green'
            case 'Connecting...':
                return 'orange'
            case 'Disconnected':
                return 'gray'
            case 'Error':
                return 'red'
            default:
                return 'gray'
        }
    }

    // Label helper to show usable and raw peers info
    const getPeerLabel = (peer: UsablePeer | DiscoveredPeerInfo) => {
        if ('model' in peer) {
            return `${peer.deviceName ?? peer.deviceAddress} (${peer.model}) Load: ${(peer.load! * 100).toFixed(0)}% ${
                peer.isConnected ? '[Connected]' : ''
            }`
        } else {
            return `${peer.deviceName ?? peer.deviceAddress} - Status: ${peer.status} ${
                peer.isConnected ? '[Group Member]' : ''
            }`
        }
    }

    const styles = useMemo(
        () =>
            StyleSheet.create({
                pickerRow: {
                    marginBottom: spacing.m,
                    flexDirection: 'row',
                    alignItems: 'center',
                },
                pickerStyle: {
                    flex: 1,
                    color: color.text._900,
                    height: 50,
                },
                buttonRow: {
                    flexDirection: 'row',
                    justifyContent: 'space-around',
                    marginBottom: spacing.m,
                },
                chatOutputContainer: {
                    height: 200,
                    borderColor: color.neutral._500,
                    borderWidth: borderWidth.s,
                    padding: spacing.m,
                    marginBottom: spacing.m,
                    borderRadius: borderRadius.s,
                },
                textInput: {
                    height: 50,
                    borderColor: color.neutral._500,
                    borderWidth: borderWidth.s,
                    marginBottom: spacing.m,
                    paddingHorizontal: spacing.m,
                    color: color.text._900,
                    backgroundColor: color.neutral._100,
                    borderRadius: borderRadius.s,
                },
            }),
        [color, spacing, borderWidth, borderRadius]
    )

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: color.neutral._100 }}>
            <ScrollView ref={scrollViewRef} style={{ flex: 1, padding: spacing.m }}>
                <SectionTitle>Swarm AI Chat</SectionTitle>

                {/* Discovery Status */}
                {Platform.OS === 'android' && (
                    <Text style={{ color: color.text._900, marginBottom: spacing.s }}>
                        Discovery Status:{' '}
                        <Text
                            style={{
                                fontWeight: 'bold',
                                color: discoveryStatus === 'Error' ? 'red' : color.text._900,
                            }}>
                            {discoveryStatus}
                        </Text>
                        {discoveryStatus === 'Scanning' && (
                            <ActivityIndicator
                                size="small"
                                color={color.text._900}
                                style={{ marginLeft: spacing.s }}
                            />
                        )}
                    </Text>
                )}

                {/* Peer Selection */}
                <View style={styles.pickerRow}>
                    <Text style={{ color: color.text._900, marginRight: spacing.s }}>
                        Select Peer:
                    </Text>
                    <Picker
                        selectedValue={selectedPeerIp}
                        onValueChange={(itemValue: string) => setSelectedPeerIp(itemValue)}
                        style={styles.pickerStyle}
                        itemStyle={{ height: 50 }}>
                        <Picker.Item label="Local RAG + Main Chat Model" value="local" />
                        {availablePeers.length === 0 && (
                            <Picker.Item label="No AI Peers Found" value="" />
                        )}
                        {availablePeers.map((peer) => (
                            <Picker.Item key={peer.ip} label={getPeerLabel(peer)} value={peer.ip} />
                        ))}
                        {discoveredWifiDirectPeers.map((peer) => {
                            if (
                                !availablePeers.some(
                                    (ap) => ap.deviceAddress === peer.deviceAddress
                                )
                            ) {
                                return (
                                    <Picker.Item
                                        key={peer.deviceAddress}
                                        label={`[WiFi Direct Raw] ${getPeerLabel(peer)}`}
                                        value={peer.deviceAddress}
                                    />
                                )
                            }
                            return null
                        })}
                    </Picker>
                </View>

                {/* TCP Connection Buttons */}
                {selectedPeerIp !== 'local' && (
                    <View style={styles.buttonRow}>
                        <Button
                            title="Connect P2P"
                            onPress={handleConnect}
                            disabled={
                                discoveryStatus !== 'Idle' &&
                                discoveryStatus !== 'Scanning' &&
                                discoveryStatus !== 'Connected' &&
                                isSending
                            }
                            color={color.primary._500}
                        />
                        <Button
                            title="Disconnect P2P"
                            onPress={handleDisconnect}
                            disabled={!groupInfo?.groupFormed || isSending}
                            color={color.error._500}
                        />
                        <Button
                            title="Refresh Peers"
                            onPress={handleRefreshPeers}
                            disabled={isSending}
                            color={color.primary._500}
                        />
                    </View>
                )}

                {/* TCP Connection Status */}
                {selectedPeerIp !== 'local' && (
                    <Text style={{ color: color.text._900, marginBottom: spacing.m }}>
                        TCP Connection Status:{' '}
                        <Text style={{ color: getConnectionStatusColor(), fontWeight: 'bold' }}>
                            {tcpConnectionStatus}
                        </Text>
                        {tcpConnectionStatus === 'Connecting...' && (
                            <ActivityIndicator
                                size="small"
                                color={color.text._900}
                                style={{ marginLeft: spacing.s }}
                            />
                        )}
                    </Text>
                )}

                {/* LoRA Selection */}
                {selectedPeerIp !== 'local' && (
                    <View style={{ marginBottom: spacing.m }}>
                        <Text style={{ color: color.text._900 }}>Select LoRA:</Text>
                        <Picker
                            selectedValue={selectedLoRA}
                            onValueChange={(itemValue: string) => setSelectedLoRA(itemValue)}
                            style={styles.pickerStyle}
                            itemStyle={{ height: 50 }}>
                            {mockLoRAs.map((lora) => (
                                <Picker.Item key={lora} label={lora} value={lora} />
                            ))}
                        </Picker>
                    </View>
                )}

                {/* Chat Output */}
                <View style={styles.chatOutputContainer}>
                    <ScrollView>
                        {swarmChatResponse.map((msg, index) => (
                            <Text key={index} style={{ color: color.text._900 }}>
                                {msg}
                            </Text>
                        ))}
                    </ScrollView>
                </View>

                {/* Input and Send Button */}
                <TextInput
                    style={styles.textInput}
                    placeholder="Type your message..."
                    placeholderTextColor={color.text._500}
                    value={swarmChatPrompt}
                    onChangeText={setSwarmChatPrompt}
                    onSubmitEditing={handleSwarmChatSend}
                    editable={!isSending}
                />
                <Button
                    title={
                        isSending
                            ? 'Sending...'
                            : selectedPeerIp === 'local'
                              ? 'Send to Local AI'
                              : 'Send to Swarm AI'
                    }
                    onPress={handleSwarmChatSend}
                    disabled={isSending || !selectedPeerIp}
                    color={color.primary._500}
                />
            </ScrollView>
        </SafeAreaView>
    )
}

export default ChatMenu
