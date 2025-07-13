import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native'; // For platform-specific handling
import { localDownload } from '@vali98/react-native-fs';

import { Logger } from '../state/Logger'; // Assuming Logger is your custom logger

// Define app-specific directories for organized file storage
export const AppDirectory = {
  ModelPath: `${FileSystem.documentDirectory}models/`,
  SessionPath: `${FileSystem.documentDirectory}session/`,
  CharacterPath: `${FileSystem.documentDirectory}characters/`,
  Assets: `${FileSystem.documentDirectory}appAssets/`,
};

/**
 * Pick a file using Expo DocumentPicker
 * @param type MIME type or array of MIME types, default '*/*'
 * @param copyToCacheDirectory Whether to copy file to cache for easier reading, default true
 * @returns File info or null if cancelled/error
 */
export async function pickFile(
  type: string | string[] = '*/*',
  copyToCacheDirectory: boolean = true
): Promise<{ uri: string; name: string; mimeType: string | null; size: number | null } | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({ type, copyToCacheDirectory });

    if (result.type === 'success') {
      const asset = result.assets[0];
      return {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? null,
        size: asset.size ?? null,
      };
    } else {
      Logger.info('File picking cancelled');
      return null;
    }
  } catch (error) {
    Logger.error('Error picking file:', error);
    return null;
  }
}

/**
 * Read file content as string from a URI
 * @param uri File URI
 * @param encoding Encoding type (utf8 or base64), default UTF8
 * @returns String content or null on error
 */
export async function readFileContent(
  uri: string,
  encoding: FileSystem.EncodingType = FileSystem.EncodingType.UTF8
): Promise<string | null> {
  try {
    // On Android, content URIs might require copyToCacheDirectory=true for direct reading
    const content = await FileSystem.readAsStringAsync(uri, { encoding });
    return content;
  } catch (error) {
    Logger.error('Error reading file content from URI:', uri, error);
    return null;
  }
}

/**
 * Get file extension from filename
 * @param filename Filename string
 * @returns Extension in lowercase or null if none
 */
export function getFileExtension(filename: string): string | null {
  const parts = filename.split('.');
  if (parts.length > 1) {
    return parts.pop()?.toLowerCase() ?? null;
  }
  return null;
}

/**
 * Copy a file to the app's document directory under a given filename
 * @param sourceUri Source file URI
 * @param destinationFileName Destination filename (with extension)
 * @returns Destination URI or null on failure
 */
export async function copyFileToAppDirectory(
  sourceUri: string,
  destinationFileName: string
): Promise<string | null> {
  try {
    const appDir = FileSystem.documentDirectory;
    if (!appDir) throw new Error('Document directory not available.');

    const destinationUri = appDir + destinationFileName;

    await FileSystem.copyAsync({ from: sourceUri, to: destinationUri });
    Logger.info(`File copied to: ${destinationUri}`);
    return destinationUri;
  } catch (error) {
    Logger.error(`Error copying file from ${sourceUri} to ${destinationFileName}:`, error);
    return null;
  }
}

/**
 * Save string data to cache directory and trigger download (for React Native environments)
 * @param data String data to save
 * @param filename Filename with extension
 * @param encoding Encoding type ('base64' or 'utf8')
 */
export const saveStringToDownload = async (
  data: string,
  filename: string,
  encoding: 'base64' | 'utf8'
) => {
  try {
    await FileSystem.writeAsStringAsync(FileSystem.cacheDirectory + filename, data, { encoding });
    await localDownload(FileSystem.cacheDirectory?.replace('file://', '') + filename);
  } catch (e) {
    Logger.error('Failed to download: ' + e);
  }
};

type PickerResult = { success: false } | { success: true; data: string };
type JSONPickerResult = { success: false } | { success: true; data: any };

/**
 * Pick a JSON document and parse it
 * @param multiple Allow multiple selection (currently unused in picker)
 * @returns Parsed JSON data or failure
 */
export const pickJSONDocument = async (multiple: boolean = false): Promise<JSONPickerResult> => {
  const result = await pickStringDocument({ type: 'application/json', multiple });
  if (!result.success) return result;

  try {
    const jsonData = JSON.parse(result.data);
    return { success: true, data: jsonData };
  } catch {
    Logger.error('Failed to parse JSON data');
    return { success: false };
  }
};

/**
 * Pick a document as string with specified encoding and type
 * @param options Options for picking document
 * @returns Success with data string or failure
 */
export const pickStringDocument = async ({
  multiple = false,
  encoding = 'utf8',
  type = '*/*',
}: {
  multiple?: boolean;
  encoding?: 'utf8' | 'base64';
  type?: string;
} = {}): Promise<PickerResult> => {
  try {
    const result = await DocumentPicker.getDocumentAsync({ type });
    if (result.canceled) {
      return { success: false };
    }
    const uri = result.assets[0].uri;
    const data = await FileSystem.readAsStringAsync(uri, { encoding }).catch((e) => {
      Logger.info(`Failed to read file: ${e}`);
      return null;
    });
    if (!data) return { success: false };
    return { success: true, data };
  } catch (error) {
    Logger.error('Error picking string document:', error);
    return { success: false };
  }
};

// Constants for file size units
const GB = 1000 ** 3;
const MB = 1000 ** 2;

/**
 * Convert file size in bytes to a human-readable string (MB or GB)
 * @param size Size in bytes
 * @returns Readable string like '12.34 MB' or '1.23 GB'
 */
export const readableFileSize = (size: number): string => {
  if (size < GB) {
    return `${(size / MB).toFixed(2)} MB`;
  } else {
    return `${(size / GB).toFixed(2)} GB`;
  }
};
