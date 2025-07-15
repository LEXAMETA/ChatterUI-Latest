import React, { useState } from 'react';
import {
  View,
  Button,
  Text,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Platform,
} from 'react-native';
import SectionTitle from './components/text/SectionTitle';
import { pickFile, readFileContent, AppDirectory } from '../lib/utils/File'; // Your utils
import { useTheme } from '../lib/theme/ThemeManager';
import { ContextParams } from 'cui-llama.rn';
import { LlamaContext, initLlama } from 'cui-llama.rn';
import { NativeEmbeddingResult } from 'cui-llama.rn/lib/typescript/NativeRNLlama';
import * as FileSystem from 'expo-file-system';
import { create } from 'zustand';
import { rawdb } from '@db';

// --- Zustand Store for Embedding State ---
type EmbeddingStoreState = {
  model: LlamaContext | undefined;
  loadModel: (preset: LlamaConfig) => Promise<void>;
  getEmbedding: (text: string) => Promise<NativeEmbeddingResult | undefined>;
};

export const useEmbeddingStore = create<EmbeddingStoreState>()((set, get) => ({
  model: undefined,
  loadModel: async (preset: LlamaConfig) => {
    try {
      await FileSystem.makeDirectoryAsync(AppDirectory.ModelPath, { intermediates: true });
      const model = await initLlama({
        model: AppDirectory.ModelPath + 'allminifp16.gguf',
        n_threads: preset.threads,
        n_batch: preset.batch,
        embedding: true,
      });
      if (!model) {
        console.error('Failed to initialize Llama model.');
        return;
      }
      set({ model });
      console.log('Llama model loaded successfully.');
    } catch (error) {
      console.error('Error loading Llama model:', error);
    }
  },
  getEmbedding: async (text: string) => {
    try {
      return await get()?.model?.embedding(text);
    } catch (error) {
      console.error('Error getting embedding:', error);
      return undefined;
    }
  },
}));

// --- Database Helpers ---
const deleteTables = async () => {
  try {
    rawdb.execSync(`drop table if exists vec_examples`);
    console.log('vec_examples table dropped.');
  } catch (e) {
    console.error('Error dropping table:', e);
  }
};

const createTables = async () => {
  try {
    await rawdb.execAsync(
      `create virtual table vec_examples using vec0(
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        sample_embedding float[8] distance_metric=cosine
      );`
    );
    console.log('vec_examples table created.');
  } catch (e) {
    console.error('Error creating table:', e);
  }
};

const insertData = async () => {
  try {
    rawdb.runSync(`insert into vec_examples(id, sample_embedding)
    values
      (1, '[-0.200, 0.250, 0.341, -0.211, 0.645, 0.935, -0.316, -0.924]'),
      (2, '[0.443, -0.501, 0.355, -0.771, 0.707, -0.708, -0.185, 0.362]'),
      (3, '[0.716, -0.927, 0.134, 0.052, -0.669, 0.793, -0.634, -0.162]'),
      (4, '[-0.710, 0.330, 0.656, 0.041, -0.990, 0.726, 0.385, -0.958]');`);
    console.log('Sample data inserted.');
  } catch (e) {
    console.error('Error inserting data:', e);
  }
};

interface EmbeddingScreenProps {}

export default function EmbeddingScreen(props: EmbeddingScreenProps) {
  const { colors } = useTheme();

  const [loadingFile, setLoadingFile] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContentPreview, setFileContentPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Llama model and embedding from Zustand store
  const { loadModel, getEmbedding } = useEmbeddingStore((state) => ({
    loadModel: state.loadModel,
    getEmbedding: state.getEmbedding,
  }));

  // Text inputs for embedding comparison
  const [textInput1, setTextInput1] = useState<string>('');
  const [textInput2, setTextInput2] = useState<string>('');
  const [embeddingOutput, setEmbeddingOutput] = useState<string>('');

  // Example LlamaConfig (adjust as needed)
const llamaConfig: ContextParams = {
  threads: 4,
  batch: 512,
};

  // Enhanced document picker handler with null/undefined checks
  const handlePickDataset = async () => {
    setLoadingFile(true);
    setFileName(null);
    setFileContentPreview(null);
    setError(null);
    try {
      // The `pickFile` utility function should return `DocumentPicker.DocumentPickerResult | null`
      const result = await pickFile('text/*');

      if (!result) { // If pickFile returns null (e.g., operation was cancelled or failed internally)
        setFileName('Document picking cancelled or failed.');
        setLoadingFile(false);
        return;
      }

      // TS2339: Property 'canceled' does not exist on type 'PickedFileInfo'.
      // This means `pickFile` returns `PickedFileInfo`, which is not directly `DocumentPickerResult`.
      // Your `lib/utils/File.ts` needs to define `PickedFileInfo` as a union.
      // Assuming `PickedFileInfo` is `DocumentPicker.DocumentPickerSuccessResult | DocumentPicker.DocumentPickerCancelledResult`
      if (result.canceled) { // This now correctly checks if the picking was canceled.
        setFileName('Document picking cancelled.');
        setLoadingFile(false);
        return;
      }

      // After the `if (result.canceled)` check, TypeScript should know `result` is `DocumentPicker.DocumentPickerSuccessResult`.
      // TS2339: Property 'assets' does not exist on type 'PickedFileInfo'.
      // This is still an issue if `PickedFileInfo` isn't properly a union.
      // If `pickFile` is *already* handling the `canceled` state and only returning successful `assets`,
      // then `result` itself is `PickedFileInfo` (which likely has an `assets` property if it's successful).
      // Let's assume `result` is of a type that might have `assets` or `canceled`.
      // If `pickFile` only returns *success* data, then `result` would be `DocumentPicker.DocumentPickerAsset[]` or similar.
      // Re-examining `lib/utils/File.ts` will clarify `pickFile`'s return type.

      // For now, let's keep the nullish coalescing to be safe with `result.assets`.
      // The ideal fix is to ensure `pickFile`'s return type is accurate and then leverage type narrowing.
      const fileInfo = result.assets?.[0]; // If `result` is from DocumentPicker.DocumentPickerSuccessResult, `assets` exists.

      if (fileInfo) {
        setFileName(fileInfo.name);
        const content = await readFileContent(fileInfo.uri);
        if (content != null) { // Check for null or undefined content
          setFileContentPreview(content.substring(0, 500) + (content.length > 500 ? '...' : ''));
          // TODO: pass content to your RAG system or embedding logic here
        } else {
          setError('Failed to read file content or content is empty.');
        }
      } else {
        setError('No file asset found after selection.');
      }
    } catch (e: any) {
      console.error('Error picking or reading dataset:', e);
      setError(`Error: ${e.message}`);
    } finally {
      setLoadingFile(false);
    }
  };

  const handleQueryDatabase = async () => {
    const now = performance.now();

    const inputVector = `[${Array(8)
      .fill(0)
      .map(() => 2 * (Math.random() - 0.5))
      .join(', ')}]`;

    try {
      const data = await rawdb.getAllAsync(
        `select id, distance from vec_examples where sample_embedding match '${inputVector}' order by distance limit 1`
      );
      console.log('Query Input:', inputVector);
      console.log('Query Result:', data);
      setEmbeddingOutput(`Query Result: ${JSON.stringify(data)}\nTime: ${(performance.now() - now).toFixed(2)}ms`);
    } catch (e: any) {
      console.error('Error querying database:', e);
      setEmbeddingOutput(`Error querying DB: ${e.message}`);
    }
  };

  const handleTestEmbedding = async () => {
    if (!textInput1 || !textInput2) {
      setEmbeddingOutput('Please enter text in both fields.');
      return;
    }
    const v1 = await getEmbedding(textInput1);
    const v2 = await getEmbedding(textInput2);

    // TS2532: Object is possibly 'undefined'. (on v1.embedding[i], v2.embedding[i])
    // Consolidated checks for v1, v2, v1.embedding, and v2.embedding
    if (!v1?.embedding || !v2?.embedding) { // Use optional chaining to check for embedding property safely
      setEmbeddingOutput('Failed to get embeddings for one or both texts.');
      return;
    }

    let s1 = 0,
      s2 = 0,
      dotprod = 0;
    // We can now safely access v1.embedding and v2.embedding because of the check above.
    const minLength = Math.min(v1.embedding.length, v2.embedding.length);
    for (let i = 0; i < minLength; i++) {
      dotprod += v1.embedding[i] * v2.embedding[i];
      s1 += v1.embedding[i] ** 2;
      s2 += v2.embedding[i] ** 2;
    }

    const similarity = dotprod / (Math.sqrt(s1) * Math.sqrt(s2));
    setEmbeddingOutput(`Cosine Similarity: ${similarity.toFixed(4)}`);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SectionTitle title="RAG Dataset Management" />
      <Button title="Load Dataset from Device" onPress={handlePickDataset} disabled={loadingFile} />

      {loadingFile && <ActivityIndicator color={colors.primary} style={styles.indicator} />}
      {fileName && <Text style={[styles.text, { color: colors.text }]}>Selected File: {fileName}</Text>}
      {fileContentPreview && (
        <View style={[styles.previewContainer, { backgroundColor: colors.card }]}>
          <Text style={[styles.previewText, { color: colors.text }]}>
            Content Preview:{"\n"}
            {fileContentPreview}
          </Text>
        </View>
      )}
      {error && <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>}

      <View style={styles.separator} />

      <SectionTitle title="Llama Embedding & Vector DB" />
      <TouchableOpacity onPress={() => loadModel(llamaConfig)} style={[styles.button, { backgroundColor: colors.primary }]}>
        <Text style={[styles.buttonText, { color: colors.buttonText }]}>Load Llama Embedding Model</Text>
      </TouchableOpacity>

      <TextInput
        value={textInput1}
        onChangeText={setTextInput1}
        placeholder="Enter text 1 for embedding"
        placeholderTextColor={colors.text._400}
        style={[styles.textInput, { color: colors.text._100, borderColor: colors.text._400 }]}
      />
      <TextInput
        value={textInput2}
        onChangeText={setTextInput2}
        placeholder="Enter text 2 for embedding"
        placeholderTextColor={colors.text._400}
        style={[styles.textInput, { color: colors.text._100, borderColor: colors.text._400 }]}
      />
      <TouchableOpacity onPress={handleTestEmbedding} style={[styles.button, { backgroundColor: colors.accent }]}>
        <Text style={[styles.buttonText, { color: colors.buttonText }]}>Calculate Embedding Similarity</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => {
          setTextInput1('');
          setTextInput2('');
          setEmbeddingOutput('');
        }}
        style={[styles.button, { backgroundColor: colors.secondary }]}
      >
        <Text style={[styles.buttonText, { color: colors.buttonText }]}>Clear Text Inputs</Text>
      </TouchableOpacity>

      {embeddingOutput ? <Text style={[styles.outputText, { color: colors.text._100 }]}>{embeddingOutput}</Text> : null}

      <View style={styles.separator} />

      <SectionTitle title="Vector Database Operations" />
      <View style={styles.dbButtonContainer}>
        <TouchableOpacity onPress={deleteTables} style={[styles.smallButton, { backgroundColor: colors.error }]}>
          <Text style={[styles.buttonText, { color: colors.buttonText }]}>Delete DB</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={createTables} style={[styles.smallButton, { backgroundColor: colors.primary }]}>
          <Text style={[styles.buttonText, { color: colors.buttonText }]}>Make DB</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={insertData} style={[styles.smallButton, { backgroundColor: colors.secondary }]}>
          <Text style={[styles.buttonText, { color: colors.buttonText }]}>Insert Data</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleQueryDatabase} style={[styles.smallButton, { backgroundColor: colors.accent }]}>
          <Text style={[styles.buttonText, { color: colors.buttonText }]}>Query DB</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
  },
  indicator: {
    marginVertical: 8,
  },
  text: {
    marginTop: 12,
  },
  previewContainer: {
    marginTop: 12,
    padding: 8,
    borderRadius: 8,
    maxHeight: 150,
    overflow: 'hidden',
  },
  previewText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
  },
  errorText: {
    marginTop: 12,
    color: 'red',
  },
  separator: {
    height: 1,
    backgroundColor: '#ccc',
    marginVertical: 24,
  },
  button: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 8,
  },
  buttonText: {
    fontWeight: 'bold',
    fontSize: 16,
  },
  textInput: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    marginVertical: 8,
    fontSize: 14,
  },
  outputText: {
    marginTop: 12,
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
  },
  dbButtonContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  smallButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 8,
    width: '48%',
  },
});
