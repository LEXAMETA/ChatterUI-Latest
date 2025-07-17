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
 * Pick a file using Expo DocumentPicker.
 *
 * @param type MIME type or array of MIME types. Defaults to "*\/*".
 * @param copyToCacheDirectory Whether to copy file to app cache directory to ease reading. Defaults to true.
 * @returns PickedFileInfo object with file info or null if cancelled or error.
 */
export async function pickFile(
    type: string | string[] = '*\/*',
    copyToCacheDirectory: boolean = true
): Promise<PickedFileInfo | null> {
    try {
        const result = await DocumentPicker.getDocumentAsync({
            type,
            copyToCacheDirectory,
        })

        // --- FIXES START HERE ---
        // Check for cancellation first, then process success result
        if (result.canceled) {
            if (Logger?.info) {
                Logger.info('File picking cancelled.')
            } else {
                console.log('File picking cancelled.')
            }
            return null
        }

        // Now, if not cancelled, it must be a success result, and we can access 'assets'
        // Ensure assets array exists and has at least one item
        if (Array.isArray(result.assets) && result.assets.length > 0) {
            const asset = result.assets[0]
            // Add explicit check for 'asset' being defined, although the array.length check implies it
            // This satisfies TS18048 more directly in some cases, or implies result.assets[0] is not undefined.
            if (!asset) { // Defensive check, should rarely be hit after result.assets.length > 0
                if (Logger?.warn) {
                    Logger.warn('No asset found in document picker result array.')
                } else {
                    console.warn('No asset found in document picker result array.')
                }
                return null
            }
            return {
                uri: asset.uri,
                name: asset.name,
                mimeType: asset.mimeType ?? null, // Use nullish coalescing for optional properties
                size: asset.size ?? null,         // Use nullish coalescing for optional properties
            }
        } else {
            // This path would be hit if result is not cancelled but assets array is empty
            if (Logger?.info) {
                Logger.info('File picking completed, but no file selected (empty assets array).')
            } else {
                console.log('File picking completed, but no file selected (empty assets array).')
            }
            return null
        }
        // --- FIXES END HERE ---

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
 * Read file content as a string from a URI.
 *
 * @param uri File URI
 * @param encoding Encoding type: utf8 or base64. Defaults to UTF8.
 * @returns File content string or null if error.
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

/**
 * Read a binary file URI for native module consumption.
 * Often native modules accept a file URI string directly.
 *
 * @param uri File URI
 * @returns URI string or null on error
 */
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

/**
 * Get file extension from a filename.
 *
 * @param filename Filename string
 * @returns Extension in lowercase or null if none found
 */
export function getFileExtension(filename: string): string | null {
    const parts = filename.split('.')
    if (parts.length > 1) {
        return parts.pop()?.toLowerCase() ?? null
    }
    return null
}

/**
 * Copy a file to the app's document directory under a given filename.
 *
 * @param sourceUri Source file URI
 * @param destinationFileName Destination filename with extension
 * @returns Destination URI or null on failure
 */
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

/**
 * Check if a file exists in the app's document directory.
 *
 * @param fileName Filename to check
 * @returns True if file exists, false otherwise
 */
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

/**
 * Save string data to a cache directory and trigger download (in React Native environment).
 *
 * @param data String data to save
 * @param filename Filename with extension
 * @param encoding Encoding type: 'base64' or 'utf8'
 */
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
 *
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
 * Pick a document as a string with specified encoding and MIME type.
 *
 * @param options Options object:
 * multiple - whether to allow multiple selection (unused)
 * encoding - encoding for read file ("utf8" or "base64"), default "utf8"
 * type - MIME type filter, default "*\/*"
 * @returns Success with string data or failure
 */
export const pickStringDocument = async ({
    multiple = false,
    encoding = 'utf8',
    type = '*\/*',
}: {
    multiple?: boolean
    encoding?: 'utf8' | 'base64'
    type?: string
} = {}): Promise<PickerResult> => {
    try {
        const result = await DocumentPicker.getDocumentAsync({ type })
        // --- FIXES START HERE ---
        // Check for cancellation first
        if (result.canceled) {
            return { success: false }
        }

        // Now, if not cancelled, it's a success result.
        // Access 'assets' directly from 'result' as per DocumentPickerSuccessResult
        if (!Array.isArray(result.assets) || result.assets.length === 0) {
            // This case implies a success result with no assets (shouldn't happen often, but good to guard)
            return { success: false }
        }

        const asset = result.assets[0]
        // Explicitly check if asset.uri is present before using it
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
        // --- FIXES END HERE ---
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
 * Convert file size in bytes to a human-readable string using MB or GB units.
 *
 * @param size Size in bytes
 * @returns Human-readable string like "12.34 MB" or "1.23 GB"
 */
export const readableFileSize = (size: number): string => {
    if (size < GB) {
        return `${(size / MB).toFixed(2)} MB`
    } else {
        return `${(size / GB).toFixed(2)} GB`
    }
}
