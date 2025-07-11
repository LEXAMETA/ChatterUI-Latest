// global.d.ts

declare module 'react-native-tcp-socket' {
    import { EventEmitter } from 'events'

    // Declare the Socket class
    export class Socket extends EventEmitter {
        // ... (keep the properties and methods from previous attempt) ...
        localAddress: string
        localPort: number
        remoteAddress: string
        remotePort: number
        bytesRead: number
        bytesWritten: number

        write(
            data: string | Buffer,
            encoding?: BufferEncoding,
            callback?: (err?: Error) => void
        ): boolean
        end(
            data?: string | Buffer,
            encoding?: BufferEncoding,
            callback?: (err?: Error) => void
        ): void
        destroy(error?: Error): void
        pause(): this
        resume(): this
        setEncoding(encoding: BufferEncoding): this
        address(): { port: number; family: string; address: string } | null

        on(event: 'connect', listener: () => void): this
        on(event: 'data', listener: (data: Buffer) => void): this
        on(event: 'error', listener: (err: Error) => void): this
        on(event: 'close', listener: (hadError: boolean) => void): this
        on(event: string | symbol, listener: (...args: any[]) => void): this
    }

    // Declare the createConnection function directly
    export function createConnection(
        options: {
            port: number
            host?: string
            localAddress?: string
            localPort?: number
            reuseAddress?: boolean
            tls?: boolean
            interface?: string
        },
        callback?: () => void
    ): Socket

    // If the library also exports a named 'Socket' or a main 'TcpSocket' object that contains `Socket`
    // Add this line only if you refer to `TcpSocket.Socket` directly,
    // otherwise, just `Socket` should be enough if it's imported as `import { Socket } from ...`
    export const TcpSocket: { Socket: typeof Socket }
}

declare module 'pako'
declare module '@react-native-picker/picker'
