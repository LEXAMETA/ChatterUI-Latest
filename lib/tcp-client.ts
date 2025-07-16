import { inflate, deflate } from 'pako' // For ZLIB compression/decompression
import { createConnection, Socket } from 'react-native-tcp-socket'
import { Buffer } from 'buffer' // Polyfill for Buffer in React Native

export interface Request {
  type: 'prompt' | 'status' | 'config'
  model: string
  prompt?: string
  lora?: string
  // Additional fields as needed
}

export interface Response {
  status: 'success' | 'error'
  output?: string
  error?: string
  // Additional fields as needed
}

export class TcpClient {
  public socket: Socket | null = null
  private receivedDataBuffer: Uint8Array = new Uint8Array(0)
  private isConnecting: boolean = false
  private currentHost: string = ''
  private currentPort: number = 0
  private connectionStatusCallback:
    | ((status: 'Connected' | 'Connecting...' | 'Disconnected' | 'Error') => void)
    | null = null

  // Current in-flight request's Promise handlers
  private currentRequestResolve: ((response: Response) => void) | null = null
  private currentRequestReject: ((error: Error) => void) | null = null

  constructor() {
    // Initialized without socket; listeners attached after connect
  }

  public setStatusCallback(
    callback: (status: 'Connected' | 'Connecting...' | 'Disconnected' | 'Error') => void
  ) {
    this.connectionStatusCallback = callback
  }

  private updateStatus(status: 'Connected' | 'Connecting...' | 'Disconnected' | 'Error') {
    this.connectionStatusCallback?.(status)
    console.log(`[TcpClient] Status: ${status}`)
  }

  async connect(host: string, port: number, retries = 3, delay = 1000): Promise<void> {
    if (this.socket && !this.isConnecting) {
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
          this.socket = createConnection(
            { host, port, tls: false },
            () => {
              console.log(`[TcpClient] Successfully connected to ${host}:${port}`)
              this.updateStatus('Connected')
              this.isConnecting = false
              this.setupListeners(this.socket!)
              resolve()
            }
          )
          this.socket.on('error', (error: any) => {
            console.error(`[TcpClient] Connection error on attempt ${attempt} for ${host}:${port}:`, error.message)
            this.updateStatus('Error')
            this.socket?.destroy()
            reject(error)
          })
        })
        return
      } catch (error: any) {
        if (attempt === retries) {
          console.error(`[TcpClient] Failed to connect after ${retries} attempts to ${host}:${port}. Last error:`, error.message)
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
      this.socket.removeAllListeners()
      this.socket.destroy()
      this.socket = null
      this.updateStatus('Disconnected')
      this.isConnecting = false
      // Reject any pending request on disconnect
      this.currentRequestReject?.(new Error('Disconnected while request was pending.'))
      this.currentRequestResolve = null
      this.currentRequestReject = null
    } else {
      console.log('[TcpClient] No active socket to disconnect.')
    }
  }

  async send(payload: Request): Promise<Response> {
    if (!this.socket) {
      this.updateStatus('Disconnected')
      throw new Error('TCP Client not connected. Cannot send data.')
    }

    if (this.currentRequestResolve || this.currentRequestReject) {
      console.warn('[TcpClient] A previous request is still pending. Rejecting new request.')
      throw new Error('Another request is already in progress. Please wait.')
    }

    return new Promise((resolve, reject) => {
      this.currentRequestResolve = resolve
      this.currentRequestReject = reject

      const responseTimeout = setTimeout(() => {
        console.warn('[TcpClient] Response timeout occurred for request.')
        this.currentRequestReject?.(new Error('Response timed out from peer.'))
        this.currentRequestResolve = null
        this.currentRequestReject = null
      }, 30000)

      const jsonString = JSON.stringify(payload)
      console.log(`[TcpClient] Original payload size: ${jsonString.length} bytes`)

      try {
        const compressedData = deflate(jsonString)
        console.log(
          `[TcpClient] Compressed payload size: ${compressedData.length} bytes. Ratio: ${(
            (compressedData.length / jsonString.length) *
            100
          ).toFixed(2)}%`
        )

        const lengthBuffer = Buffer.alloc(4)
        lengthBuffer.writeUInt32LE(compressedData.length, 0)

        const messageBuffer = Buffer.concat([lengthBuffer, Buffer.from(compressedData)])

        console.log(`[TcpClient] Sending total message size: ${messageBuffer.length} bytes`)
        this.socket?.write(messageBuffer, undefined, (error: any) => {
          if (error) {
            clearTimeout(responseTimeout)
            console.error('[TcpClient] Error writing to socket:', error.message)
            this.updateStatus('Error')
            this.currentRequestReject?.(new Error(`Failed to send data: ${error.message}`))
            this.currentRequestResolve = null
            this.currentRequestReject = null
          } else {
            console.log('[TcpClient] Data sent successfully.')
          }
        })
      } catch (e: any) {
        clearTimeout(responseTimeout)
        console.error('[TcpClient] Compression or serialization error:', e.message)
        this.currentRequestReject?.(new Error(`Data processing error: ${e.message}`))
        this.currentRequestResolve = null
        this.currentRequestReject = null
      }
    })
  }

  private setupListeners(s: Socket): void {
    s.removeAllListeners()

    s.on('data', this.handleIncomingData.bind(this))
    s.on('close', () => {
      console.log(`[TcpClient] Socket closed.`)
      this.updateStatus('Disconnected')
      this.socket = null
      this.receivedDataBuffer = new Uint8Array(0)
      this.currentRequestReject?.(new Error('Socket closed unexpectedly.'))
      this.currentRequestResolve = null
      this.currentRequestReject = null
    })

    s.on('error', (error: any) => {
      console.error('[TcpClient] Socket error:', error.message)
      this.updateStatus('Error')
      this.currentRequestReject?.(new Error(`Socket error during communication: ${error.message}`))
      this.currentRequestResolve = null
      this.currentRequestReject = null
      this.disconnect()
    })
  }

  private handleIncomingData(data: Buffer): void {
    console.log(`[TcpClient] Raw incoming data chunk size: ${data.length} bytes`)

    const newBuffer = new Uint8Array(this.receivedDataBuffer.length + data.length)
    newBuffer.set(this.receivedDataBuffer, 0)
    newBuffer.set(new Uint8Array(data), this.receivedDataBuffer.length)
    this.receivedDataBuffer = newBuffer

    console.log(`[TcpClient] Current buffer size: ${this.receivedDataBuffer.length} bytes`)

    while (this.receivedDataBuffer.length >= 4) {
      const messageLength = Buffer.from(this.receivedDataBuffer.slice(0, 4)).readUInt32LE(0)

      if (this.receivedDataBuffer.length >= 4 + messageLength) {
        const compressedMessage = this.receivedDataBuffer.slice(4, 4 + messageLength)
        console.log(`[TcpClient] Extracted compressed message size: ${compressedMessage.length} bytes`)

        try {
          const decompressedData = inflate(compressedMessage, { to: 'string' })
          console.log(`[TcpClient] Decompressed message size: ${decompressedData.length} bytes`)

          const response: Response = JSON.parse(decompressedData)
          console.log('[TcpClient] Received and parsed response:', response)

          this.currentRequestResolve?.(response)
          this.currentRequestResolve = null
          this.currentRequestReject = null
        } catch (e: any) {
          console.error('[TcpClient] Error processing incoming data (decompression or JSON parse):', e.message)
          this.currentRequestReject?.(new Error(`Failed to parse response: ${e.message}`))
          this.currentRequestResolve = null
          this.currentRequestReject = null
        }

        this.receivedDataBuffer = this.receivedDataBuffer.slice(4 + messageLength)
        console.log(`[TcpClient] Remaining buffer size after processing: ${this.receivedDataBuffer.length} bytes`)
      } else {
        break
      }
    }
  }
}

export const tcpClientInstance = new TcpClient()

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
