import SectionTitle from '@components/text/SectionTitle'
import { tcpClientInstance, sendMockPrompt, Request, Response } from '@lib/tcp-client'
import { Theme } from '@lib/theme/ThemeManager'
import { Picker } from '@react-native-picker/picker'
import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
    View,
    Text,
    TextInput,
    Button,
    Alert,
    ScrollView,
    ActivityIndicator,
    StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Peer {
    ip: string
    model: string
    load: number
    lastSeen: number
}

const mockPeers: Peer[] = [
    { ip: '192.168.1.100', model: 'llama-3-8b', load: 0.1, lastSeen: Date.now() - 5000 },
    { ip: '192.168.1.101', model: 'mixtral-8x7b', load: 0.5, lastSeen: Date.now() - 1000 },
    { ip: '192.168.1.102', model: 'qwen3', load: 0.2, lastSeen: Date.now() - 2000 },
]

const mockLoRAs = ['default', 'anime-style', 'fantasy-lore']

const ChatMenu = () => {
    const { color, spacing, borderWidth, borderRadius } = Theme.useTheme()

    const [availablePeers, setAvailablePeers] = useState<Peer[]>(mockPeers)
    const [selectedPeerIp, setSelectedPeerIp] = useState<string>(mockPeers[0]?.ip || '')
    const [selectedLoRA, setSelectedLoRA] = useState<string>(mockLoRAs[0] || '')
    const [swarmChatPrompt, setSwarmChatPrompt] = useState<string>('')
    const [swarmChatResponse, setSwarmChatResponse] = useState<string[]>([])
    const [isSending, setIsSending] = useState<boolean>(false)
    const [tcpConnectionStatus, setTcpConnectionStatus] = useState<
        'Connected' | 'Connecting...' | 'Disconnected' | 'Error'
    >('Disconnected')

    const scrollViewRef = useRef<ScrollView>(null)

    useEffect(() => {
        tcpClientInstance.setStatusCallback(setTcpConnectionStatus)

        if (selectedPeerIp) {
            const peer = availablePeers.find((p) => p.ip === selectedPeerIp)
            if (peer) {
                tcpClientInstance.connect(peer.ip, 8080)
            }
        }

        return () => {
            tcpClientInstance.disconnect()
            // Replace null with a callback that sets status to 'Disconnected'
            tcpClientInstance.setStatusCallback(() => setTcpConnectionStatus('Disconnected'))
            setTcpConnectionStatus('Disconnected')
        }
    }, [selectedPeerIp, availablePeers])

    useEffect(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true })
    }, [swarmChatResponse])

    const handleConnect = async () => {
        const peer = availablePeers.find((p) => p.ip === selectedPeerIp)
        if (peer) {
            await tcpClientInstance.connect(peer.ip, 8080)
        } else {
            Alert.alert('Connection Error', 'No peer selected or found.')
        }
    }

    const handleDisconnect = () => {
        tcpClientInstance.disconnect()
        setTcpConnectionStatus('Disconnected')
    }

    const handleRefreshPeers = async () => {
        console.log('Refreshing mock peers...')
        const updatedPeers = mockPeers.filter((p) => Math.random() > 0.1)
        setAvailablePeers(updatedPeers)
        if (!updatedPeers.some((p) => p.ip === selectedPeerIp) && updatedPeers.length > 0) {
            setSelectedPeerIp(updatedPeers[0].ip)
        }
    }

    const handleSwarmChatSend = async () => {
        if (!swarmChatPrompt.trim()) return

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

        const message = `You: ${swarmChatPrompt}`
        setSwarmChatResponse((prev) => [...prev, message])
        setSwarmChatPrompt('')

        setIsSending(true)
        try {
            const requestPayload: Request = {
                type: 'prompt',
                model: currentPeer.model,
                prompt: swarmChatPrompt,
                lora: selectedLoRA || undefined,
            }

            const response = await (process.env.EXPO_PUBLIC_BUILD_TARGET === 'web' ||
            !tcpClientInstance.socket
                ? sendMockPrompt(requestPayload)
                : tcpClientInstance.send(requestPayload))

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
                Alert.alert('AI Response Error', `Peer responded with an error: ${response.error}`)
            } else {
                setSwarmChatResponse((prev) => [...prev, `AI Response: Unexpected format`])
                Alert.alert('AI Response Error', `Peer responded with an unexpected format.`)
            }
        } catch (error: any) {
            setSwarmChatResponse((prev) => [...prev, `AI Error: ${error.message}`])
            console.error('Swarm chat send error:', error)
            Alert.alert('Send Failed', `Could not get AI response: ${error.message}`)
        } finally {
            setIsSending(false)
        }
    }

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
                    color: color.text._900, // fixed
                    height: 50,
                },
                buttonRow: {
                    flexDirection: 'row',
                    justifyContent: 'space-around',
                    marginBottom: spacing.m,
                },
                chatOutputContainer: {
                    height: 200,
                    borderColor: color.neutral._500, // fixed
                    borderWidth: borderWidth.s,
                    padding: spacing.m,
                    marginBottom: spacing.m,
                    borderRadius: borderRadius.s,
                },
                textInput: {
                    height: 50,
                    borderColor: color.neutral._500, // fixed
                    borderWidth: borderWidth.s,
                    marginBottom: spacing.m,
                    paddingHorizontal: spacing.m,
                    color: color.text._900, // fixed
                    backgroundColor: color.neutral._100, // fixed
                    borderRadius: borderRadius.s,
                },
            }),
        [color, spacing, borderWidth, borderRadius]
    )

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: color.neutral._100 }}>
            <ScrollView ref={scrollViewRef} style={{ flex: 1, padding: spacing.m }}>
                {/* Fixed SectionTitle usage: use children instead of title prop */}
                <SectionTitle>{'Swarm AI Chat'}</SectionTitle>

                <View style={styles.pickerRow}>
                    <Text style={{ color: color.text._900, marginRight: spacing.s }}>
                        Select Peer:
                    </Text>
                    <Picker
                        selectedValue={selectedPeerIp}
                        onValueChange={(itemValue: string) => setSelectedPeerIp(itemValue)}
                        style={styles.pickerStyle}
                        itemStyle={{ height: 50 }}>
                        {availablePeers.length === 0 && (
                            <Picker.Item label="No Peers Found" value="" />
                        )}
                        {availablePeers.map((peer) => (
                            <Picker.Item
                                key={peer.ip}
                                label={`${peer.model} (${peer.ip}) Load: ${(peer.load * 100).toFixed(0)}% ${
                                    peer.lastSeen ===
                                    Math.max(...availablePeers.map((p) => p.lastSeen || 0))
                                        ? '[Best]'
                                        : ''
                                }`}
                                value={peer.ip}
                            />
                        ))}
                    </Picker>
                </View>

                <View style={styles.buttonRow}>
                    <Button
                        title="Connect"
                        onPress={handleConnect}
                        disabled={tcpConnectionStatus === 'Connected' || isSending}
                        color={color.primary._500} // fixed
                    />
                    <Button
                        title="Disconnect"
                        onPress={handleDisconnect}
                        disabled={tcpConnectionStatus === 'Disconnected' || isSending}
                        color={color.error._500} // fixed
                    />
                    <Button
                        title="Refresh Peers"
                        onPress={handleRefreshPeers}
                        disabled={isSending}
                        color={color.primary._500} // fixed
                    />
                </View>

                <Text style={{ color: color.text._900, marginBottom: spacing.m }}>
                    Connection Status:{' '}
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

                <View style={styles.chatOutputContainer}>
                    <ScrollView>
                        {swarmChatResponse.map((msg, index) => (
                            <Text key={index} style={{ color: color.text._900 }}>
                                {msg}
                            </Text>
                        ))}
                    </ScrollView>
                </View>

                <TextInput
                    style={styles.textInput}
                    placeholder="Type your message..."
                    placeholderTextColor={color.text._500} // fixed
                    value={swarmChatPrompt}
                    onChangeText={setSwarmChatPrompt}
                    onSubmitEditing={handleSwarmChatSend}
                    editable={!isSending}
                />
                <Button
                    title={isSending ? 'Sending...' : 'Send to Swarm AI'}
                    onPress={handleSwarmChatSend}
                    disabled={isSending || !selectedPeerIp}
                    color={color.primary._500} // fixed
                />
            </ScrollView>
        </SafeAreaView>
    )
}

export default ChatMenu
