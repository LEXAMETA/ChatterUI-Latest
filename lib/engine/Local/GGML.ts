/* eslint-disable @typescript-eslint/prefer-optional-chain */

import * as FileSystem from 'expo-file-system'

export enum GGMLType {
    UNKNOWN = -1,
    LLAMA_FTYPE_ALL_F32 = 0,
    LLAMA_FTYPE_MOSTLY_F16 = 1,
    LLAMA_FTYPE_MOSTLY_Q4_0 = 2,
    LLAMA_FTYPE_MOSTLY_Q4_1 = 3,
    // LLAMA_FTYPE_MOSTLY_Q4_1_SOME_F16 = 4,
    // LLAMA_FTYPE_MOSTLY_Q4_2       = 5,
    // LLAMA_FTYPE_MOSTLY_Q4_3       = 6,
    LLAMA_FTYPE_MOSTLY_Q8_0 = 7,
    LLAMA_FTYPE_MOSTLY_Q5_0 = 8,
    LLAMA_FTYPE_MOSTLY_Q5_1 = 9,
    LLAMA_FTYPE_MOSTLY_Q2_K = 10,
    LLAMA_FTYPE_MOSTLY_Q3_K_S = 11,
    LLAMA_FTYPE_MOSTLY_Q3_K_M = 12,
    LLAMA_FTYPE_MOSTLY_Q3_K_L = 13,
    LLAMA_FTYPE_MOSTLY_Q4_K_S = 14,
    LLAMA_FTYPE_MOSTLY_Q4_K_M = 15,
    LLAMA_FTYPE_MOSTLY_Q5_K_S = 16,
    LLAMA_FTYPE_MOSTLY_Q5_K_M = 17,
    LLAMA_FTYPE_MOSTLY_Q6_K = 18,
    LLAMA_FTYPE_MOSTLY_IQ2_XXS = 19,
    LLAMA_FTYPE_MOSTLY_IQ2_XS = 20,
    LLAMA_FTYPE_MOSTLY_Q2_K_S = 21,
    LLAMA_FTYPE_MOSTLY_IQ3_XS = 22,
    LLAMA_FTYPE_MOSTLY_IQ3_XXS = 23,
    LLAMA_FTYPE_MOSTLY_IQ1_S = 24,
    LLAMA_FTYPE_MOSTLY_IQ4_NL = 25,
    LLAMA_FTYPE_MOSTLY_IQ3_S = 26,
    LLAMA_FTYPE_MOSTLY_IQ3_M = 27,
    LLAMA_FTYPE_MOSTLY_IQ2_S = 28,
    LLAMA_FTYPE_MOSTLY_IQ2_M = 29,
    LLAMA_FTYPE_MOSTLY_IQ4_XS = 30,
    LLAMA_FTYPE_MOSTLY_IQ1_M = 31,
    LLAMA_FTYPE_MOSTLY_BF16 = 32,
    LLAMA_FTYPE_MOSTLY_Q4_0_4_4 = 33,
    LLAMA_FTYPE_MOSTLY_Q4_0_4_8 = 34,
    LLAMA_FTYPE_MOSTLY_Q4_0_8_8 = 35,
    LLAMA_FTYPE_MOSTLY_TQ1_0 = 36,
    LLAMA_FTYPE_MOSTLY_TQ2_0 = 37,
}

export const GGMLNameMap: Record<GGMLType, string> = {
    [GGMLType.UNKNOWN]: 'N/A',
    [GGMLType.LLAMA_FTYPE_ALL_F32]: 'F32',
    [GGMLType.LLAMA_FTYPE_MOSTLY_F16]: 'F16',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q4_0]: 'Q4_0',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q4_1]: 'Q4_1',
    // [GGMLType.LLAMA_FTYPE_MOSTLY_Q4_1_SOME_F16]: 'Q4_1_SOME_F16',
    // [GGMLType.LLAMA_FTYPE_MOSTLY_Q4_2]: 'Q4_2',
    // [GGMLType.LLAMA_FTYPE_MOSTLY_Q4_3]: 'Q4_3',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q8_0]: 'Q8_0',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q5_0]: 'Q5_0',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q5_1]: 'Q5_1',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q2_K]: 'Q2_K',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q3_K_S]: 'Q3_K_S',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q3_K_M]: 'Q3_K_M',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q3_K_L]: 'Q3_K_L',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q4_K_S]: 'Q4_K_S',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q4_K_M]: 'Q4_K_M',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q5_K_S]: 'Q5_K_S',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q5_K_M]: 'Q5_K_M',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q6_K]: 'Q6_K',
    [GGMLType.LLAMA_FTYPE_MOSTLY_IQ2_XXS]: 'IQ2_XXS',
    [GGMLType.LLAMA_FTYPE_MOSTLY_IQ2_XS]: 'IQ2_XS',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q2_K_S]: 'Q2_K_S',
    [GGMLType.LLAMA_FTYPE_MOSTLY_IQ3_XS]: 'IQ3_XS',
    [GGMLType.LLAMA_FTYPE_MOSTLY_IQ3_XXS]: 'IQ3_XXS',
    [GGMLType.LLAMA_FTYPE_MOSTLY_IQ1_S]: 'IQ1_S',
    [GGMLType.LLAMA_FTYPE_MOSTLY_IQ4_NL]: 'IQ4_NL',
    [GGMLType.LLAMA_FTYPE_MOSTLY_IQ3_S]: 'IQ3_S',
    [GGMLType.LLAMA_FTYPE_MOSTLY_IQ3_M]: 'IQ3_M',
    [GGMLType.LLAMA_FTYPE_MOSTLY_IQ2_S]: 'IQ2_S',
    [GGMLType.LLAMA_FTYPE_MOSTLY_IQ2_M]: 'IQ2_M',
    [GGMLType.LLAMA_FTYPE_MOSTLY_IQ4_XS]: 'IQ4_XS',
    [GGMLType.LLAMA_FTYPE_MOSTLY_IQ1_M]: 'IQ1_M',
    [GGMLType.LLAMA_FTYPE_MOSTLY_BF16]: 'BF16',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q4_0_4_4]: 'Q4_0_4_4',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q4_0_4_8]: 'Q4_0_4_8',
    [GGMLType.LLAMA_FTYPE_MOSTLY_Q4_0_8_8]: 'Q4_0_8_8',
    [GGMLType.LLAMA_FTYPE_MOSTLY_TQ1_0]: 'TQ1_0',
    [GGMLType.LLAMA_FTYPE_MOSTLY_TQ2_0]: 'TQ2_0',
}

export function checkGGMLDeprecated(type: number): boolean {
    return (
        type === GGMLType.LLAMA_FTYPE_MOSTLY_Q4_0_4_4 ||
        type === GGMLType.LLAMA_FTYPE_MOSTLY_Q4_0_4_8 ||
        type === GGMLType.LLAMA_FTYPE_MOSTLY_Q4_0_8_8
    )
}

// Helper function to convert Base64 string to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
    if (typeof Buffer !== 'undefined' && Buffer.from) {
        return Uint8Array.from(Buffer.from(base64, 'base64'))
    } else if (typeof atob !== 'undefined') {
        const binaryString = atob(base64)
        const len = binaryString.length
        const bytes = new Uint8Array(len)
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i)
        }
        return bytes
    } else {
        throw new Error('No suitable environment for Base64 decoding found.')
    }
}

// Convert 4 bytes of Uint8Array to a uint32 number (little-endian)
function readUInt32LE(bytes: Uint8Array, offset: number): number {
    if (offset + 4 > bytes.length) {
        throw new Error(
            `[GGML] Insufficient data to read 32-bit integer at offset ${offset}. Array length: ${bytes.length}`
        )
    }
    // Provide default 0 to prevent 'possibly undefined' error
    const b0 = bytes[offset] ?? 0
    const b1 = bytes[offset + 1] ?? 0
    const b2 = bytes[offset + 2] ?? 0
    const b3 = bytes[offset + 3] ?? 0

    return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0
}

// Reads GGML model type from file header (partial header read)
export async function getGGMLTypeFromFile(filePath: string): Promise<GGMLType> {
    try {
        const fileInfo = await FileSystem.getInfoAsync(filePath)
        if (!fileInfo.exists || fileInfo.isDirectory) {
            console.warn(`[GGML] File does not exist or is a directory for type check: ${filePath}`)
            return GGMLType.UNKNOWN
        }

        const base64Content = await FileSystem.readAsStringAsync(filePath, {
            encoding: FileSystem.EncodingType.Base64,
        })

        const bytesToRead = 256
        const uint8Array = base64ToUint8Array(
            base64Content.substring(0, Math.ceil(bytesToRead / 3) * 4)
        )

        if (uint8Array.length < 16) {
            console.warn(`[GGML] File too small to be a valid GGUF header: ${filePath}`)
            return GGMLType.UNKNOWN
        }

        const GGUF_MAGIC = 0x46554747 // 'GGUF'

        const magic = readUInt32LE(uint8Array, 0)
        if (magic !== GGUF_MAGIC) {
            console.warn(`[GGML] Not a GGUF file (bad magic number): ${filePath}`)
            return GGMLType.UNKNOWN
        }

        let offset = 8
        const tensorCount = readUInt32LE(uint8Array, offset)
        offset += 4
        const kvCount = readUInt32LE(uint8Array, offset)
        offset += 4

        for (let i = 0; i < kvCount; i++) {
            if (offset + 4 > uint8Array.length) {
                console.warn(`[GGML] Insufficient data to read KV key length for pair ${i}.`)
                break
            }
            const keyLength = readUInt32LE(uint8Array, offset)
            offset += 4

            if (offset + keyLength > uint8Array.length) {
                console.warn(`[GGML] Insufficient data to read KV key string for pair ${i}.`)
                break
            }
            const keyBytes = uint8Array.subarray(offset, offset + keyLength)
            const key = new TextDecoder().decode(keyBytes)
            offset += keyLength

            if (offset + 4 > uint8Array.length) {
                console.warn(`[GGML] Insufficient data to read KV value type for pair ${i}.`)
                break
            }
            const valueType = readUInt32LE(uint8Array, offset)
            offset += 4

            let valueSize = 0
            switch (valueType) {
                case 0: {
                    valueSize = 1
                    break
                }
                case 1: {
                    valueSize = 1
                    break
                }
                case 2: {
                    valueSize = 2
                    break
                }
                case 3: {
                    valueSize = 2
                    break
                }
                case 4: {
                    valueSize = 4
                    break
                }
                case 5: {
                    valueSize = 4
                    break
                }
                case 6: {
                    valueSize = 8
                    break
                }
                case 7: {
                    valueSize = 8
                    break
                }
                case 8: {
                    valueSize = 4
                    break
                }
                case 9: {
                    valueSize = 8
                    break
                }
                case 10: {
                    valueSize = 1
                    break
                }
                case 11: {
                    if (offset + 4 > uint8Array.length) break
                    const stringLength = readUInt32LE(uint8Array, offset)
                    valueSize = 4 + stringLength
                    break
                }
                case 12: {
                    if (offset + 4 > uint8Array.length) break
                    valueSize = 4
                    break
                }
                default: {
                    console.warn(
                        `[GGML] Unknown GGUF value type: ${valueType} for key ${key}. Skipping.`
                    )
                    break
                }
            }
            if (valueSize === 0) break

            if (key === 'general.file_type') {
                if (offset + valueSize > uint8Array.length) {
                    console.warn(`[GGML] Insufficient data to read 'general.file_type' value.`)
                    break
                }
                const fileTypeValue = readUInt32LE(uint8Array, offset)
                return fileTypeValue as GGMLType
            }
            offset += valueSize
        }

        console.warn(`[GGML] 'general.file_type' KV pair not found in header for "${filePath}".`)
        return GGMLType.UNKNOWN
    } catch (error) {
        console.error(`[GGML] Error getting GGML type from file "${filePath}":`, error)
        return GGMLType.UNKNOWN
    }
}
