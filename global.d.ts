// global.d.ts

import { LlamaContext, ContextParams } from 'cui-llama.rn';
import { ModelDataType } from 'db/schema'; // Adjust import path as needed

declare module 'cui-llama.rn' {
  // Extend or declare any missing types from the cui-llama.rn library if needed
  // For example, PopupMenuHandle, Menu, etc., if required
}

// Add your LoadContextOptions interface for engine context loading
export interface LoadContextOptions {
  modelId: number;
  expectedType: ModelDataType['model_type'];
  currentContext: LlamaContext | null;
  loadedModel: ModelDataType | null;
  isEmbeddingModel?: boolean;
  loraPath?: string | null;
  config: ContextParams;
}

declare module 'react-native-tcp-socket' {
  import { EventEmitter } from 'events';

  export class Socket extends EventEmitter {
    localAddress: string;
    localPort: number;
    remoteAddress: string;
    remotePort: number;
    bytesRead: number;
    bytesWritten: number;

    write(
      data: string | Buffer,
      encoding?: BufferEncoding,
      callback?: (err?: Error) => void
    ): boolean;
    end(
      data?: string | Buffer,
      encoding?: BufferEncoding,
      callback?: (err?: Error) => void
    ): void;
    destroy(error?: Error): void;
    pause(): this;
    resume(): this;
    setEncoding(encoding: BufferEncoding): this;
    address(): { port: number; family: string; address: string } | null;

    on(event: 'connect', listener: () => void): this;
    on(event: 'data', listener: (data: Buffer) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'close', listener: (hadError: boolean) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
  }

  export function createConnection(
    options: {
      port: number;
      host?: string;
      localAddress?: string;
      localPort?: number;
      reuseAddress?: boolean;
      tls?: boolean;
      interface?: string;
    },
    callback?: () => void
  ): Socket;

  export const TcpSocket: { Socket: typeof Socket };
}

declare module 'pako';
declare module '@react-native-picker/picker';
