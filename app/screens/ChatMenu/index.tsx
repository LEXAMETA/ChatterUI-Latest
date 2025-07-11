import { SectionTitle } from '@components/text/SectionTitle'
import { tcpClientInstance, sendMockPrompt, Request, Response } from '@lib/tcp-client'
import { useTheme } from '@lib/theme/ThemeManager'
import { Picker } from '@react-native-picker/picker'
import React, { useState, useEffect, useRef } from 'react'
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

// Import local components using your existing alias structure

// Import your TcpClient and the mock for web builds

// Mock Peer and LoRA data for development (if not coming from a real discovery)
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
    const { colors, spacing } = useTheme()
    const [availablePeers, setAvailablePeers] = useState<Peer[]>(mockPeers)
    const [selectedPeerIp, setSelectedPeerIp] = useState<string>(mockPeers[0]?.ip || '')
    const [selectedLoRA, setSelectedLoRA] = useState<string>(mockLoRAs[0] || '')
    const [swarmChatPrompt, setSwarmChatPrompt] = useState<string>('')
    const [swarmChatResponse, setSwarmChatResponse] = useState<string[]>([])
    const [isSending, setIsSending] = useState<boolean>(false)
    const [tcpConnectionStatus, setTcpConnectionStatus] = useState<
        'Connected' | 'Connecting...' | 'Disconnected' | 'Error'
    >('Disconnected')

    const scrollViewRef = useRef<ScrollView>(null) // Ref for auto-scrolling

    useEffect(() => {
        // Set up TCP client status callback
        tcpClientInstance.setStatusCallback(setTcpConnectionStatus)

        // Initial connection attempt if a peer is selected
        if (selectedPeerIp) {
            const peer = availablePeers.find((p) => p.ip === selectedPeerIp)
            if (peer) {
                tcpClientInstance.connect(peer.ip, 8080) // Assuming port 8080 for now
            }
        }

        // Clean up on unmount
        return () => {
            tcpClientInstance.disconnect()
            tcpClientInstance.setStatusCallback(null) // Clear callback
        }
    }, [selectedPeerIp, availablePeers]) // Depend on selectedPeerIp and availablePeers

    // Auto-scroll effect
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
    }

    const handleRefreshPeers = async () => {
        // Implement mock peer refresh logic here if needed
        // For now, it's static, but you could add a timeout and simulate changes
        console.log('Refreshing mock peers...')
        // Example: Simulate some peers dropping or new ones appearing
        const updatedPeers = mockPeers.filter((p) => Math.random() > 0.1) // 10% chance a peer 'drops'
        setAvailablePeers(updatedPeers)
        if (!updatedPeers.some((p) => p.ip === selectedPeerIp) && updatedPeers.length > 0) {
            setSelectedPeerIp(updatedPeers[0].ip) // Select a new default if current drops
        }
    }

    const handleSwarmChatSend = async () => {
        if (!swarmChatPrompt.trim()) return

        const currentPeer = availablePeers.find((p) => p.ip === selectedPeerIp)
        if (!currentPeer) {
            Alert.alert('Send Error', 'Please select a peer before sending a message.')
            return
        }

        // Check connection status before sending
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

            // Use the actual TcpClient for APK builds
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
            // Explicitly type error as any
            setSwarmChatResponse((prev) => [...prev, `AI Error: ${error.message}`])
            console.error('Swarm chat send error:', error)
            Alert.alert('Send Failed', `Could not get AI response: ${error.message}`)
        } finally {
            setIsSending(false)
        }
    }

    // Helper for displaying connection status with color
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

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
            <ScrollView ref={scrollViewRef} style={{ flex: 1, padding: spacing.m }}>
                <SectionTitle title="Swarm AI Chat" />

                <View style={styles.pickerRow}>
                    <Text style={{ color: colors.text, marginRight: spacing.s }}>Select Peer:</Text>
                    <Picker
                        selectedValue={selectedPeerIp}
                        onValueChange={(itemValue: string) => {
                            // Explicitly type itemValue as string
                            setSelectedPeerIp(itemValue)
                        }}
                        style={styles.pickerStyle}
                        itemStyle={{ height: 50 }}>
                        {availablePeers.length === 0 && (
                            <Picker.Item label="No Peers Found" value="" />
                        )}
                        {availablePeers.map(
                            (
                                peer // Use parentheses for consistency
                            ) => (
                                <Picker.Item
                                    key={peer.ip}
                                    label={`${peer.model} (${peer.ip}) Load: ${(peer.load * 100).toFixed(0)}% ${peer.lastSeen === Math.max(...availablePeers.map((p) => p.lastSeen || 0)) ? '[Best]' : ''}`}
                                    value={peer.ip}
                                />
                            )
                        )}
                    </Picker>
                </View>

                <View style={styles.buttonRow}>
                    <Button
                        title="Connect"
                        onPress={handleConnect}
                        disabled={tcpConnectionStatus === 'Connected' || isSending}
                        color={colors.primary}
                    />
                    <Button
                        title="Disconnect"
                        onPress={handleDisconnect}
                        disabled={tcpConnectionStatus === 'Disconnected' || isSending}
                        color={colors.destructive}
                    />
                    <Button
                        title="Refresh Peers"
                        onPress={handleRefreshPeers}
                        disabled={isSending}
                        color={colors.primary}
                    />
                </View>

                <Text style={{ color: colors.text, marginBottom: spacing.m }}>
                    Connection Status:{' '}
                    <Text style={{ color: getConnectionStatusColor(), fontWeight: 'bold' }}>
                        {tcpConnectionStatus}
                    </Text>
                    {tcpConnectionStatus === 'Connecting...' && (
                        <ActivityIndicator
                            size="small"
                            color={colors.text}
                            style={{ marginLeft: spacing.s }}
                        />
                    )}
                </Text>

                <View style={{ marginBottom: spacing.m }}>
                    <Text style={{ color: colors.text }}>Select LoRA:</Text>
                    <Picker
                        selectedValue={selectedLoRA}
                        onValueChange={(itemValue: string) => setSelectedLoRA(itemValue)} // Explicitly type itemValue as string
                        style={styles.pickerStyle}
                        itemStyle={{ height: 50 }}>
                        {mockLoRAs.map(
                            (
                                lora // Use parentheses for consistency
                            ) => (
                                <Picker.Item key={lora} label={lora} value={lora} />
                            )
                        )}
                    </Picker>
                </View>

                <View style={styles.chatOutputContainer}>
                    <ScrollView>
                        {swarmChatResponse.map((msg, index) => (
                            <Text key={index} style={{ color: colors.text }}>
                                {msg}
                            </Text>
                        ))}
                    </ScrollView>
                </View>

                <TextInput
                    style={styles.textInput}
                    placeholder="Type your message..."
                    placeholderTextColor={colors.textSecondary}
                    value={swarmChatPrompt}
                    onChangeText={setSwarmChatPrompt}
                    onSubmitEditing={handleSwarmChatSend}
                    editable={!isSending}
                />
                <Button
                    title={isSending ? 'Sending...' : 'Send to Swarm AI'}
                    onPress={handleSwarmChatSend}
                    disabled={isSending || !selectedPeerIp}
                    color={colors.primary}
                />
            </ScrollView>
        </SafeAreaView>
    )
}

// ... (imports and component code above)

const styles = StyleSheet.create({
    pickerRow: {
        marginBottom: spacing.m, // Changed from 10 (now 8, which is allowed)
        flexDirection: 'row',
        alignItems: 'center',
    },
    pickerStyle: {
        flex: 1,
        color: 'white', // Ensure text color is visible against various backgrounds
        height: 50, // Keep absolute height
    },
    buttonRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginBottom: spacing.m, // Changed from 10 (now 8, which is allowed)
    },
    chatOutputContainer: {
        height: 200, // Keep absolute height
        borderColor: 'gray', // Use literal string or derive from theme
        borderWidth: 1,
        padding: spacing.m, // Changed from 10 (now 8, which is allowed)
        marginBottom: spacing.m, // Changed from 10 (now 8, which is allowed)
        borderRadius: borderRadius.s, // Changed from 5 (now 4, which is allowed)
    },
    textInput: {
        height: 50, // Keep absolute height
        borderColor: 'gray', // Use literal string or derive from theme
        borderWidth: 1,
        marginBottom: spacing.m, // Changed from 10 (now 8, which is allowed)
        paddingHorizontal: spacing.m, // Changed from 10 (now 8, which is allowed)
        color: 'white', // Ensure text color is visible
        backgroundColor: 'black', // Ensure background is visible
        borderRadius: borderRadius.s, // Changed from 5 (now 4, which is allowed)
    },
})

export default ChatMenu
