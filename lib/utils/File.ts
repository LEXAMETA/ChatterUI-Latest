import { localDownload } from '@vali98/react-native-fs'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import { Platform } from 'react-native' // For platform-specific handling

import { Logger } from '../state/Logger' // Replace with console if Logger not available

// App-specific directories for organized file storage
export const AppDirectory = {
    ModelPath: `${FileSystem.documentDirectory}models/`,
    SessionPath: `${FileSystem.documentDirectory}session/`,
    CharacterPath: `${FileSystem.documentDirectory}characters/`,
    Assets: `${FileSystem.documentDirectory}appAssets/`,
}

/**
 * Information about a picked file.
 */
export interface PickedFileInfo {
    uri: string
    name: string
    mimeType: string | null
    size: number | null
}


/**
 * @param {string | string[]} type MIME type or array of MIME types. Default is `'*/*'`.
 * @param {boolean} copyToCacheDirectory Whether to copy file to cache for easier reading.
 * @default true
 * @returns {DocumentPicker.DocumentPickerResult | null} File info or null if cancelled or error.
 */

export async function pickFile(
    type: string | string[] = '*/*',
    copyToCacheDirectory: boolean = true
): Promise<PickedFileInfo | null> {
    try {
        const result = await DocumentPicker.getDocumentAsync({
            type,
            copyToCacheDirectory,
        })

        // Safe check for null/undefined and cancellation
        if (
            result &&
            result.type === 'success' &&
            Array.isArray(result.assets) &&
            result.assets.length > 0
        ) {
            const asset = result.assets[0]
            // Access mimeType safely instead of deprecated 'type'
            return {
                uri: asset.uri,
                name: asset.name,
                mimeType: asset.mimeType ?? null,
                size: asset.size ?? null,
            }
        } else {
            if (Logger?.info) {
                Logger.info('File picking cancelled or no file selected.')
            } else {
                console.log('File picking cancelled or no file selected.')
            }
            return null
        }
    } catch (error) {
        if (Logger?.error) {
            Logger.error('Error picking file:', error)
        } else {
            console.error('Error picking file:', error)
        }
        return null
    }
}

/**
 * Read file content as string from a URI.
 * @param uri File URI
 * @param encoding Encoding type (utf8 or base64), default UTF8
 * @returns File content string or null on error
 */
export async function readFileContent(
    uri: string,
    encoding: FileSystem.EncodingType = FileSystem.EncodingType.UTF8
): Promise<string | null> {
    try {
        const content = await FileSystem.readAsStringAsync(uri, { encoding })
        return content
    } catch (error) {
        if (Logger?.error) {
            Logger.error('Error reading file content from URI:', uri, error)
        } else {
            console.error('Error reading file content from URI:', uri, error)
        }
        return null
    }
}

// --- Additional utilities below ---

export async function readBinaryFile(uri: string): Promise<string | null> {
    try {
        // Returning URI directly for native modules that accept file URIs.
        return uri
    } catch (error) {
        if (Logger?.error) {
            Logger.error('Error reading binary file:', error)
        } else {
            console.error('Error reading binary file:', error)
        }
        return null
    }
}

export function getFileExtension(filename: string): string | null {
    const parts = filename.split('.')
    if (parts.length > 1) {
        return parts.pop()?.toLowerCase() ?? null
    }
    return null
}

export async function copyFileToAppDirectory(
    sourceUri: string,
    destinationFileName: string
): Promise<string | null> {
    try {
        const appDir = FileSystem.documentDirectory
        if (!appDir) throw new Error('Document directory not available on this device.')

        const destinationPath = `${appDir}${destinationFileName}`

        await FileSystem.copyAsync({
            from: sourceUri,
            to: destinationPath,
        })
        if (Logger?.info) {
            Logger.info(`File copied from ${sourceUri} to ${destinationPath}`)
        } else {
            console.log(`File copied from ${sourceUri} to ${destinationPath}`)
        }
        return destinationPath
    } catch (error) {
        if (Logger?.error) {
            Logger.error(`Error copying file from ${sourceUri} to ${destinationFileName}:`, error)
        } else {
            console.error(`Error copying file from ${sourceUri} to ${destinationFileName}:`, error)
        }
        return null
    }
}

export async function fileExistsInAppDirectory(fileName: string): Promise<boolean> {
    try {
        const appDir = FileSystem.documentDirectory
        if (!appDir) return false
        const fileInfo = await FileSystem.getInfoAsync(`${appDir}${fileName}`)
        return !!fileInfo.exists
    } catch (error) {
        if (Logger?.error) {
            Logger.error(`Error checking if file exists: ${fileName}`, error)
        } else {
            console.error(`Error checking if file exists: ${fileName}`, error)
        }
        return false
    }
}

export const saveStringToDownload = async (
    data: string,
    filename: string,
    encoding: 'base64' | 'utf8'
) => {
    try {
        await FileSystem.writeAsStringAsync(FileSystem.cacheDirectory + filename, data, {
            encoding,
        })
        await localDownload(FileSystem.cacheDirectory?.replace('file://', '') + filename)
    } catch (e) {
        if (Logger?.error) {
            Logger.error('Failed to download: ' + e)
        } else {
            console.error('Failed to download: ' + e)
        }
    }
}

type PickerResult = { success: false } | { success: true; data: string }

type JSONPickerResult = { success: false } | { success: true; data: any }

/**
 * Pick a JSON document and parse it.
 * @param multiple Allow multiple selection - currently unused
 * @returns Parsed JSON data or failure
 */
export const pickJSONDocument = async (multiple: boolean = false): Promise<JSONPickerResult> => {
    const result = await pickStringDocument({ type: 'application/json', multiple })
    if (!result.success) return result

    try {
        const jsonData = JSON.parse(result.data)
        return { success: true, data: jsonData }
    } catch {
        if (Logger?.error) {
            Logger.error('Failed to parse JSON data')
        } else {
            console.error('Failed to parse JSON data')
        }
        return { success: false }
    }
}

/**
 * Pick a document as string with specified encoding and MIME type.
 * @param options Options: multiple, encoding, type
 * @returns Success with data string or failure
 */
export const pickStringDocument = async ({
    multiple = false,
    encoding = 'utf8',
    type = '*/*',
}: {
    multiple?: boolean
    encoding?: 'utf8' | 'base64'
    type?: string
} = {}): Promise<PickerResult> => {
    try {
        const result = await DocumentPicker.getDocumentAsync({ type })
        if (!result || result.canceled || !Array.isArray(result.assets) || result.assets.length === 0) {
            return { success: false }
        }
        const asset = result.assets[0]
        if (!asset.uri) return { success: false }

        const data = await FileSystem.readAsStringAsync(asset.uri, { encoding }).catch((e) => {
            if (Logger?.info) {
                Logger.info(`Failed to read file: ${e}`)
            } else {
                console.log(`Failed to read file: ${e}`)
            }
            return null
        })
        if (data === null) return { success: false }

        return { success: true, data }
    } catch (error) {
        if (Logger?.error) {
            Logger.error('Error picking string document:', error)
        } else {
            console.error('Error picking string document:', error)
        }
        return { success: false }
    }
}

// Constants for file size units
const GB = 1000 ** 3
const MB = 1000 ** 2

/**
 * Convert file size in bytes to a human-readable string (MB or GB).
 * @param size Size in bytes
 * @returns Readable string like '12.34 MB' or '1.23 GB'
 */
export const readableFileSize = (size: number): string => {
    if (size < GB) {
        return `${(size / MB).toFixed(2)} MB`
    } else {
        return `${(size / GB).toFixed(2)} GB`
    }
}
