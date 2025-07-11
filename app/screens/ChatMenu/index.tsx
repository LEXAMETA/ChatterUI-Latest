import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Button, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../lib/theme/ThemeManager';
import { SectionTitle } from '../../app/components/text/SectionTitle';

// Import your TcpClient and the mock for web builds
import { tcpClientInstance, sendMockPrompt, Request, Response } from '../../../lib/tcp-client';

// Mock Peer and LoRA data for development (if not coming from a real discovery)
interface Peer {
  ip: string;
  model: string;
  load: number;
  lastSeen: number;
}

const mockPeers: Peer[] = [
  { ip: '192.168.1.100', model: 'llama-3-8b', load: 0.1, lastSeen: Date.now() - 5000 },
  { ip: '192.168.1.101', model: 'mixtral-8x7b', load: 0.5, lastSeen: Date.now() - 1000 },
  { ip: '192.168.1.102', model: 'qwen3', load: 0.2, lastSeen: Date.now() - 2000 },
];

const mockLoRAs = ['default', 'anime-style', 'fantasy-lore'];

const ChatMenu = () => {
  const { colors } = useTheme();
  const [availablePeers, setAvailablePeers] = useState<Peer[]>(mockPeers);
  const [selectedPeerIp, setSelectedPeerIp] = useState<string>(mockPeers[0]?.ip || '');
  const [selectedLoRA, setSelectedLoRA] = useState<string>(mockLoRAs[0] || '');
  const [swarmChatPrompt, setSwarmChatPrompt] = useState<string>('');
  const [swarmChatResponse, setSwarmChatResponse] = useState<string[]>([]);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [tcpConnectionStatus, setTcpConnectionStatus] = useState<'Connected' | 'Connecting...' | 'Disconnected' | 'Error'>('Disconnected');

  const scrollViewRef = useRef<ScrollView>(null); // Ref for auto-scrolling

  useEffect(() => {
    // Set up TCP client status callback
    tcpClientInstance.setStatusCallback(setTcpConnectionStatus);

    // Initial connection attempt if a peer is selected
    if (selectedPeerIp) {
      const peer = availablePeers.find(p => p.ip === selectedPeerIp);
      if (peer) {
        tcpClientInstance.connect(peer.ip, 8080); // Assuming port 8080 for now
      }
    }

    // Clean up on unmount
    return () => {
      tcpClientInstance.disconnect();
      tcpClientInstance.setStatusCallback(null); // Clear callback
    };
  }, [selectedPeerIp, availablePeers]);

  // Auto-scroll effect
  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [swarmChatResponse]);

  const handleConnect = async () => {
    const peer = availablePeers.find(p => p.ip === selectedPeerIp);
    if (peer) {
      await tcpClientInstance.connect(peer.ip, 8080);
    } else {
      Alert.alert("Connection Error", "No peer selected or found.");
    }
  };

  const handleDisconnect = () => {
    tcpClientInstance.disconnect();
  };

  const handleRefreshPeers = async () => {
    // Implement mock peer refresh logic here if needed
    // For now, it's static, but you could add a timeout and simulate changes
    console.log("Refreshing mock peers...");
    // Example: Simulate some peers dropping or new ones appearing
    const updatedPeers = mockPeers.filter(p => Math.random() > 0.1); // 10% chance a peer 'drops'
    setAvailablePeers(updatedPeers);
    if (!updatedPeers.some(p => p.ip === selectedPeerIp) && updatedPeers.length > 0) {
      setSelectedPeerIp(updatedPeers[0].ip); // Select a new default if current drops
    }
  };

  const handleSwarmChatSend = async () => {
    if (!swarmChatPrompt.trim()) return;

    const currentPeer = availablePeers.find(p => p.ip === selectedPeerIp);
    if (!currentPeer) {
      Alert.alert("Send Error", "Please select a peer before sending a message.");
      return;
    }

    // Check connection status before sending
    if (tcpConnectionStatus !== 'Connected') {
      setSwarmChatResponse(prev => [...prev, `Error: Not connected to ${currentPeer.ip}. Current status: ${tcpConnectionStatus}.`]);
      Alert.alert("Connection Required", `Please ensure TCP client is connected to ${currentPeer.ip}. Current status: ${tcpConnectionStatus}.`);
      return;
    }

    const message = `You: ${swarmChatPrompt}`;
    setSwarmChatResponse(prev => [...prev, message]);
    setSwarmChatPrompt('');

    setIsSending(true);
    try {
      const requestPayload: Request = {
        type: 'prompt',
        model: currentPeer.model,
        prompt: swarmChatPrompt,
        lora: selectedLoRA || undefined
      };

      // Use the actual TcpClient for APK builds
      // For web/Vercel preview, `sendMockPrompt` is automatically picked due to platform check
      const response = await (
        (process.env.EXPO_PUBLIC_BUILD_TARGET === 'web' || !tcpClientInstance.socket)
        ? sendMockPrompt(requestPayload)
        : tcpClientInstance.send(requestPayload)
      );

      if (response.status === 'success' && response.output) {
        setSwarmChatResponse(prev => [...prev, `AI (${currentPeer.model} @ ${currentPeer.ip}): ${response.output}`]);
      } else if (response.status === 'error' && response.error) {
        setSwarmChatResponse(prev => [...prev, `AI Error (${currentPeer.model} @ ${currentPeer.ip}): ${response.error}`]);
        Alert.alert("AI Response Error", `Peer responded with an error: ${response.error}`);
      } else {
        setSwarmChatResponse(prev => [...prev, `AI Response: Unexpected format`]);
        Alert.alert("AI Response Error", `Peer responded with an unexpected format.`);
      }

    } catch (error: any) {
      setSwarmChatResponse(prev => [...prev, `AI Error: ${error.message}`]);
      console.error('Swarm chat send error:', error);
      Alert.alert("Send Failed", `Could not get AI response: ${error.message}`);
    } finally {
      setIsSending(false);
    }
  };

  // Helper for displaying connection status with color
  const getConnectionStatusColor = () => {
    switch (tcpConnectionStatus) {
      case 'Connected': return 'green';
      case 'Connecting...': return 'orange';
      case 'Disconnected': return 'gray';
      case 'Error': return 'red';
      default: return 'gray';
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView ref={scrollViewRef} style={{ flex: 1, padding: 10 }}>
        <SectionTitle title="Swarm AI Chat" />

        <View style={{ marginBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: colors.text, marginRight: 10 }}>Select Peer:</Text>
          <Picker
            selectedValue={selectedPeerIp}
            onValueChange={(itemValue) => {
              setSelectedPeerIp(itemValue);
            }}
            style={{ flex: 1, color: colors.text, height: 50 }}
            itemStyle={{ height: 50 }}
          >
            {availablePeers.length === 0 && <Picker.Item label="No Peers Found" value="" />}
            {availablePeers.map(peer => (
              <Picker.Item
                key={peer.ip}
                label={`${peer.model} (${peer.ip}) Load: ${(peer.load * 100).toFixed(0)}% ${peer.lastSeen === Math.max(...availablePeers.map(p => p.lastSeen || 0)) ? '[Best]' : ''}`}
                value={peer.ip}
              />
            ))}
          </Picker>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 }}>
          <Button title="Connect" onPress={handleConnect} disabled={tcpConnectionStatus === 'Connected' || isSending} color={colors.primary} />
          <Button title="Disconnect" onPress={handleDisconnect} disabled={tcpConnectionStatus === 'Disconnected' || isSending} color={colors.destructive} />
          <Button title="Refresh Peers" onPress={handleRefreshPeers} disabled={isSending} color={colors.primary} />
        </View>

        <Text style={{ color: colors.text, marginBottom: 10 }}>
            Connection Status: <Text style={{ color: getConnectionStatusColor(), fontWeight: 'bold' }}>{tcpConnectionStatus}</Text>
            {tcpConnectionStatus === 'Connecting...' && <ActivityIndicator size="small" color={colors.text} style={{ marginLeft: 5 }} />}
        </Text>

        <View style={{ marginBottom: 10 }}>
          <Text style={{ color: colors.text }}>Select LoRA:</Text>
          <Picker
            selectedValue={selectedLoRA}
            onValueChange={(itemValue) => setSelectedLoRA(itemValue)}
            style={{ color: colors.text, height: 50 }}
            itemStyle={{ height: 50 }}
          >
            {mockLoRAs.map(lora => (
              <Picker.Item key={lora} label={lora} value={lora} />
            ))}
          </Picker>
        </View>

        <View style={{ height: 200, borderColor: colors.border, borderWidth: 1, padding: 10, marginBottom: 10, borderRadius: 5 }}>
          <ScrollView>
            {swarmChatResponse.map((msg, index) => (
              <Text key={index} style={{ color: colors.text }}>{msg}</Text>
            ))}
          </ScrollView>
        </View>

        <TextInput
          style={{
            height: 50,
            borderColor: colors.border,
            borderWidth: 1,
            marginBottom: 10,
            paddingHorizontal: 10,
            color: colors.text,
            backgroundColor: colors.card,
            borderRadius: 5,
          }}
          placeholder="Type your message..."
          placeholderTextColor={colors.textSecondary}
          value={swarmChatPrompt}
          onChangeText={setSwarmChatPrompt}
          onSubmitEditing={handleSwarmChatSend}
          editable={!isSending}
        />
        <Button
          title={isSending ? "Sending..." : "Send to Swarm AI"}
          onPress={handleSwarmChatSend}
          disabled={isSending || !selectedPeerIp}
          color={colors.primary}
        />
      </ScrollView>
    </SafeAreaView>
  );
};

export default ChatMenu;
