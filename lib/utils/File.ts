import { localDownload } from '@vali98/react-native-fs'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import { Platform } from 'react-native'

import { Logger } from '../state/Logger'

export const AppDirectory = {
    ModelPath: `${FileSystem.documentDirectory}models/`,
    SessionPath: `${FileSystem.documentDirectory}session/`,
    CharacterPath: `${FileSystem.documentDirectory}characters/`,
    Assets: `${FileSystem.documentDirectory}appAssets/`,
}

export interface PickedFileInfo {
    uri: string
    name: string
    mimeType: string | null
    size: number | null
}

export async function pickFile(
    type: string | string[] = '*/*',
    copyToCacheDirectory = true
): Promise<PickedFileInfo | null> {
    try {
        const result = await DocumentPicker.getDocumentAsync({
            type,
            copyToCacheDirectory,
        })

        if (result.canceled) {
            Logger?.info('File picking cancelled.')
            console.log('File picking cancelled.')
            return null
        }

        if (Array.isArray(result.assets) && result.assets.length > 0) {
            const asset = result.assets[0]
            if (!asset) {
                Logger?.warn('No asset found in document picker result array.')
                console.warn('No asset found in document picker result array.')
                return null
            }
            return {
                uri: asset.uri,
                name: asset.name,
                mimeType: asset.mimeType ?? null,
                size: asset.size ?? null,
            }
        } else {
            Logger?.info('File picking completed, but no file selected (empty assets array).')
            console.log('File picking completed, but no file selected (empty assets array).')
            return null
        }
    } catch (error) {
        Logger?.error('Error picking file:', error)
        console.error('Error picking file:', error)
        return null
    }
}

export async function readFileContent(
    uri: string,
    encoding: FileSystem.EncodingType = FileSystem.EncodingType.UTF8
): Promise<string | null> {
    try {
        return await FileSystem.readAsStringAsync(uri, { encoding })
    } catch (error) {
        Logger?.error('Error reading file content from URI:', uri, error)
        console.error('Error reading file content from URI:', uri, error)
        return null
    }
}

export async function readBinaryFile(uri: string): Promise<string | null> {
    try {
        return uri
    } catch (error) {
        Logger?.error('Error reading binary file:', error)
        console.error('Error reading binary file:', error)
        return null
    }
}

export function getFileExtension(filename: string): string | null {
    const parts = filename.split('.')
    if (parts.length > 1) return parts.pop()?.toLowerCase() ?? null
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

        Logger?.info(`File copied from ${sourceUri} to ${destinationPath}`)
        console.log(`File copied from ${sourceUri} to ${destinationPath}`)

        return destinationPath
    } catch (error) {
        Logger?.error(`Error copying file from ${sourceUri} to ${destinationFileName}:`, error)
        console.error(`Error copying file from ${sourceUri} to ${destinationFileName}:`, error)
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
        Logger?.error(`Error checking if file exists: ${fileName}`, error)
        console.error(`Error checking if file exists: ${fileName}`, error)
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
        Logger?.error('Failed to download: ' + e)
        console.error('Failed to download: ' + e)
    }
}

type PickerResult = { success: false } | { success: true; data: string }
type JSONPickerResult = { success: false } | { success: true; data: any }

export const pickJSONDocument = async (multiple = false): Promise<JSONPickerResult> => {
    const result = await pickStringDocument({ type: 'application/json', multiple })
    if (!result.success) return result

    try {
        const jsonData = JSON.parse(result.data)
        return { success: true, data: jsonData }
    } catch {
        Logger?.error('Failed to parse JSON data')
        console.error('Failed to parse JSON data')
        return { success: false }
    }
}

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

        if (result.canceled) return { success: false }
        if (!Array.isArray(result.assets) || result.assets.length === 0) return { success: false }

        const asset = result.assets[0]!
        if (!asset.uri) return { success: false }

        const data = await FileSystem.readAsStringAsync(asset.uri, { encoding }).catch((e) => {
            Logger?.info(`Failed to read file: ${e}`)
            console.log(`Failed to read file: ${e}`)
            return null
        })

        if (data === null) return { success: false }
        return { success: true, data }
    } catch (error) {
        Logger?.error('Error picking string document:', error)
        console.error('Error picking string document:', error)
        return { success: false }
    }
}

const GB = 1000 ** 3
const MB = 1000 ** 2

export const readableFileSize = (size: number): string => {
    if (size < GB) {
        return `${(size / MB).toFixed(2)} MB`
    } else {
        return `${(size / GB).toFixed(2)} GB`
    }
}
