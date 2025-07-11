import { inflate, deflate } from 'pako' // For ZLIB compression/decompression
import TcpSocket from 'react-native-tcp-socket'

export interface Request {
    type: 'prompt' | 'status' | 'config' // Example types
    model: string
    prompt?: string
    lora?: string
    // Add other fields as your TCP server expects
}

export interface Response {
    status: 'success' | 'error'
    output?: string
    error?: string
    // Add other fields as your TCP server responds
}

export class TcpClient {
    public socket: TcpSocket.Socket | null = null
    private receivedDataBuffer: Uint8Array = new Uint8Array(0)
    private isConnecting: boolean = false
    private currentHost: string = ''
    private currentPort: number = 0
    private connectionStatusCallback:
        | ((status: 'Connected' | 'Connecting...' | 'Disconnected' | 'Error') => void)
        | null = null

    constructor() {
        this.setupListeners()
    }

    // --- Connection Management ---
    public setStatusCallback(
        callback: (status: 'Connected' | 'Connecting...' | 'Disconnected' | 'Error') => void
    ) {
        this.connectionStatusCallback = callback
    }

    private updateStatus(status: 'Connected' | 'Connecting...' | 'Disconnected' | 'Error') {
        if (this.connectionStatusCallback) {
            this.connectionStatusCallback(status)
        }
        console.log(`[TcpClient] Status: ${status}`)
    }

    async connect(host: string, port: number, retries = 3, delay = 1000): Promise<void> {
        if (this.socket && this.socket.readyState === 'open') {
            console.log(`[TcpClient] Already connected to ${this.currentHost}:${this.currentPort}`)
            this.updateStatus('Connected')
            return
        }
        if (this.isConnecting) {
            console.log(`[TcpClient] Already attempting to connect to ${host}:${port}.`)
            return
        }

        this.currentHost = host
        this.currentPort = port
        this.isConnecting = true
        this.updateStatus('Connecting...')
        console.log(`[TcpClient] Attempting to connect to ${host}:${port}...`)

        for (let attempt = 1; attempt <= retries; attempt++) {
            console.log(`[TcpClient] Connection attempt ${attempt} of ${retries}...`)
            try {
                await new Promise<void>((resolve, reject) => {
                    this.socket = TcpSocket.createConnection(
                        {
                            // eslint-disable-next-line object-shorthand
                            host,
                            port,
                            tls: false,
                        },
                        () => {
                            console.log(`[TcpClient] Successfully connected to ${host}:${port}`)
                            this.updateStatus('Connected')
                            this.isConnecting = false
                            resolve()
                        }
                    )

                    this.socket.on('error', (error) => {
                        console.error(
                            `[TcpClient] Connection error on attempt ${attempt} for ${host}:${port}:`,
                            error.message
                        )
                        this.updateStatus('Error') // Temporarily show error, then try again or disconnect
                        this.socket?.destroy() // Ensure socket is closed on error
                        reject(error)
                    })
                    // Ensure other listeners are setup (called once in constructor)
                })
                return // Connection successful
            } catch (error: any) {
                if (attempt === retries) {
                    console.error(
                        `[TcpClient] Failed to connect after ${retries} attempts to ${host}:${port}. Last error:`,
                        error.message
                    )
                    this.updateStatus('Error')
                    throw new Error(`Failed to connect after ${retries} attempts: ${error.message}`)
                }
                console.log(`[TcpClient] Retrying connection in ${delay}ms...`)
                await new Promise((resolve) => setTimeout(resolve, delay))
            }
        }
    }

    public disconnect(): void {
        if (this.socket) {
            console.log(`[TcpClient] Disconnecting from ${this.currentHost}:${this.currentPort}.`)
            this.socket.destroy() // Closes the socket immediately
            this.socket = null
            this.updateStatus('Disconnected')
            this.isConnecting = false
        } else {
            console.log('[TcpClient] No active socket to disconnect.')
        }
    }

    // --- Data Sending and Receiving ---
    async send(payload: Request): Promise<Response> {
        if (!this.socket || this.socket.readyState !== 'open') {
            this.updateStatus('Disconnected')
            throw new Error('TCP Client not connected. Cannot send data.')
        }

        return new Promise((resolve, reject) => {
            // Set a timeout for the response for this specific request
            const responseTimeout = setTimeout(() => {
                console.warn('[TcpClient] Response timeout occurred for request.')
                reject(new Error('Response timed out from peer.'))
            }, 30000) // 30 seconds timeout for a response

            const jsonString = JSON.stringify(payload)
            console.log(`[TcpClient] Original payload size: ${jsonString.length} bytes`)

            try {
                // Compress the JSON string
                const compressedData = deflate(jsonString)
                console.log(
                    `[TcpClient] Compressed payload size: ${compressedData.length} bytes. Ratio: ${((compressedData.length / jsonString.length) * 100).toFixed(2)}%`
                )

                // Prefix with length (4 bytes, Little Endian)
                const lengthBuffer = Buffer.alloc(4)
                lengthBuffer.writeUInt32LE(compressedData.length, 0)

                // Combine length and compressed data
                const messageBuffer = Buffer.concat([lengthBuffer, Buffer.from(compressedData)])

                console.log(`[TcpClient] Sending total message size: ${messageBuffer.length} bytes`)
                this.socket?.write(messageBuffer, (error) => {
                    if (error) {
                        clearTimeout(responseTimeout)
                        console.error('[TcpClient] Error writing to socket:', error.message)
                        this.updateStatus('Error')
                        return reject(new Error(`Failed to send data: ${error.message}`))
                    }
                    console.log('[TcpClient] Data sent successfully.')
                })

                // Store resolve/reject for the next incoming data
                this.socket.once('responseReceived', (response: Response) => {
                    clearTimeout(responseTimeout)
                    resolve(response)
                })

                // Handle errors that might occur after write but before response
                this.socket.once('responseError', (error: Error) => {
                    clearTimeout(responseTimeout)
                    reject(error)
                })
            } catch (e: any) {
                clearTimeout(responseTimeout)
                console.error('[TcpClient] Compression or serialization error:', e.message)
                reject(new Error(`Data processing error: ${e.message}`))
            }
        })
    }

    private setupListeners(): void {
        if (this.socket) {
            // Remove existing listeners to prevent duplicates
            this.socket.removeAllListeners()
        }

        // Set up listeners for the socket instance
        // Note: this.socket is initially null and will be assigned in connect()
        // It's better to add listeners right after socket is created in connect(),
        // or ensure this method is called only once per socket lifetime.
        // For simplicity, let's assume `connect` handles new socket creation.
        // If you plan to reuse socket object, ensure `removeAllListeners` is called first.

        // A more robust way to set listeners for a newly created socket:
        const attachListeners = (s: TcpSocket.Socket) => {
            s.on('data', this.handleIncomingData.bind(this))
            s.on('close', () => {
                console.log(`[TcpClient] Socket closed.`)
                this.updateStatus('Disconnected')
                this.socket = null // Clear reference to closed socket
                this.receivedDataBuffer = new Uint8Array(0) // Clear buffer on close
            })
            s.on('error', (error) => {
                console.error('[TcpClient] Socket error:', error.message)
                this.updateStatus('Error')
                // Trigger a 'responseError' event if a promise is awaiting a response
                s.emit(
                    'responseError',
                    new Error(`Socket error during communication: ${error.message}`)
                )
                this.disconnect() // Attempt to disconnect on error
            })
        }

        // If using the `connect` method from this class, you would call `attachListeners(this.socket)`
        // immediately after `TcpSocket.createConnection` resolves.
        // For this example, we'll ensure it's called once upon class instantiation (if socket exists)
        // or upon successful connection.
        // Given current `connect` structure, `this.socket.on('error', reject)` handles initial errors.
        // The `data` and `close` listeners should be set *after* the socket is successfully created.
    }

    // This method needs to handle framing. Assuming length-prefixed messages.
    private handleIncomingData(data: Buffer): void {
        console.log(`[TcpClient] Raw incoming data chunk size: ${data.length} bytes`)

        // Append new data to buffer
        const newBuffer = new Uint8Array(this.receivedDataBuffer.length + data.length)
        newBuffer.set(this.receivedDataBuffer, 0)
        newBuffer.set(new Uint8Array(data), this.receivedDataBuffer.length)
        this.receivedDataBuffer = newBuffer

        console.log(`[TcpClient] Current buffer size: ${this.receivedDataBuffer.length} bytes`)

        // Process messages from the buffer
        while (this.receivedDataBuffer.length >= 4) {
            // Need at least 4 bytes for length prefix
            const messageLength = Buffer.from(this.receivedDataBuffer.slice(0, 4)).readUInt32LE(0)

            if (this.receivedDataBuffer.length >= 4 + messageLength) {
                // We have a complete message
                const compressedMessage = this.receivedDataBuffer.slice(4, 4 + messageLength)
                console.log(
                    `[TcpClient] Extracted compressed message size: ${compressedMessage.length} bytes`
                )

                try {
                    // Decompress the message
                    const decompressedData = inflate(compressedMessage, { to: 'string' })
                    console.log(
                        `[TcpClient] Decompressed message size: ${decompressedData.length} bytes`
                    )

                    const response: Response = JSON.parse(decompressedData)
                    console.log('[TcpClient] Received and parsed response:', response)

                    // Emit a custom event or resolve a promise related to the `send` method
                    // This requires some mechanism to link incoming data to the `send` call.
                    // For simplicity, we'll assume `send` is awaiting the *next* response.
                    this.socket?.emit('responseReceived', response)
                } catch (e: any) {
                    console.error(
                        '[TcpClient] Error processing incoming data (decompression or JSON parse):',
                        e.message
                    )
                    this.socket?.emit(
                        'responseError',
                        new Error(`Failed to parse response: ${e.message}`)
                    )
                }

                // Remove the processed message from the buffer
                this.receivedDataBuffer = this.receivedDataBuffer.slice(4 + messageLength)
                console.log(
                    `[TcpClient] Remaining buffer size after processing: ${this.receivedDataBuffer.length} bytes`
                )
            } else {
                // Not enough data for a full message yet, wait for more
                break
            }
        }
    }
}

// Global instance for convenience, or you can pass it via props/context
export const tcpClientInstance = new TcpClient()

// Mock function for web environment (Vercel previews)
// This should only be used if not running on a device.
export const sendMockPrompt = async (payload: Request): Promise<Response> => {
    console.log('[Mock TCP Client] Received mock prompt:', payload.prompt)
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve({
                status: 'success',
                output: `Mock AI response to "${payload.prompt}" from model ${payload.model}. (Via Mock)`,
            })
        }, 1000)
    })
}
