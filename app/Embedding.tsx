import React, { useState, useEffect } from 'react';
import { View, Button, Text, ActivityIndicator, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { SectionTitle } from './components/text/SectionTitle';
import { pickFile, readFileContent, AppDirectory } from '../lib/utils/File'; // Import your new utilities and AppDirectory
import { useTheme } from '../lib/theme/ThemeManager'; // Assuming you have a theme context
import { LlamaConfig } from '@lib/engine/Local/LlamaLocal'; // Assuming this path is correct for LlamaConfig
import { LlamaContext, initLlama } from 'cui-llama.rn';
import { NativeEmbeddingResult } from 'cui-llama.rn/lib/typescript/NativeRNLlama';
import { documentDirectory } from 'expo-file-system';
import { create } from 'zustand';
import { rawdb } from '@db'; // Assuming this path is correct for your database

interface EmbeddingScreenProps {
  // Add any specific props for this screen if needed
}

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
      // Ensure the models directory exists
      await FileSystem.makeDirectoryAsync(AppDirectory.ModelPath, { intermediates: true });

      const model = await initLlama({
        model: AppDirectory.ModelPath + 'allminifp16.gguf', // Use AppDirectory for model path
        n_threads: preset.threads,
        n_batch: preset.batch,
        embedding: true,
      });
      if (!model) {
        console.error('Failed to initialize Llama model.');
        return;
      }
      set({ model: model });
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

// --- Database Helpers (Moved from the second snippet) ---
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
  // This is sample data insertion.
  // The original commented out batch insertion logic could be re-implemented if needed.
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

export default function EmbeddingScreen(props: EmbeddingScreenProps) {
  const { colors } = useTheme();
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContentPreview, setFileContentPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // States for Llama embedding interaction
  const { loadModel, getEmbedding } = useEmbeddingStore((state) => ({
    loadModel: state.loadModel,
    getEmbedding: state.getEmbedding,
  }));
  const [textInput1, setTextInput1] = useState<string>('');
  const [textInput2, setTextInput2] = useState<string>('');
  const [embeddingOutput, setEmbeddingOutput] = useState<string>('');

  // Example LlamaConfig. Adjust as per your actual LlamaLocal structure.
  // This should ideally come from user settings or a predefined config.
  const llamaConfig: LlamaConfig = {
    threads: 4, // Example value
    batch: 512, // Example value
    // other LlamaConfig properties if any
  };

  const handlePickDataset = async () => {
    setLoadingFile(true);
    setFileName(null);
    setFileContentPreview(null);
    setError(null);
    try {
      const fileInfo = await pickFile('text/*'); // Or customize to 'application/json', '.json', 'text/csv'
      if (fileInfo) {
        setFileName(fileInfo.name);
        const content = await readFileContent(fileInfo.uri);
        if (content) {
          setFileContentPreview(content.substring(0, 500) + (content.length > 500 ? '...' : '')); // Show a preview
          console.log("Dataset loaded successfully. Content length:", content.length);
          // TODO: Pass 'content' to your RAG system for processing/embedding
          // e.g., await ragSystem.addDataset(fileInfo.name, content);
          // Example: If you want to embed the loaded content
          // const embeddings = await getEmbedding(content);
          // console.log("Content embeddings:", embeddings);
        } else {
          setError("Failed to read file content.");
        }
      } else {
        setFileName("No file selected.");
      }
    } catch (e: any) {
      console.error("Error picking or reading dataset:", e);
      setError(`Error: ${e.message}`);
    } finally {
      setLoadingFile(false);
    }
  };

  const handleQueryDatabase = async () => {
    const now = performance.now();
    // Use an actual embedding from a text input or a pre-defined one
    // For now, using a random input as per the original snippet
    const inputVector = `[${Array(8)
      .fill(0)
      .map((item) => 2 * (Math.random() - 0.5))}]`;

    try {
      const data = await rawdb.getAllAsync(`select
        id,
        distance
        from vec_examples
        where sample_embedding match '${inputVector}'
        order by distance
      limit 1`);
      console.log('Query Input:', inputVector);
      console.log('Query Result:', data);
      setEmbeddingOutput(`Query Result: ${JSON.stringify(data)}\nTime: ${(performance.now() - now).toFixed(2)}ms`);
    } catch (e) {
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

    if (!v1 || !v2 || !v1.embedding || !v2.embedding) {
      setEmbeddingOutput('Failed to get embeddings for one or both texts.');
      return;
    }

    let s1 = 0;
    let s2 = 0;
    let dotprod = 0;

    // Ensure embeddings are of the same length
    const minLength = Math.min(v1.embedding.length, v2.embedding.length);

    for (let i = 0; i < minLength; i++) {
      dotprod += v1.embedding[i] * v2.embedding[i];
      s1 += v1.embedding[i] * v1.embedding[i];
      s2 += v2.embedding[i] * v2.embedding[i];
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
      <TouchableOpacity
        onPress={() => loadModel(llamaConfig)}
        style={[styles.button, { backgroundColor: colors.primary }]}
      >
        <Text style={[styles.buttonText, { color: colors.buttonText }]}>Load Llama Embedding Model</Text>
      </TouchableOpacity>

      <TextInput
        value={textInput1}
        onChangeText={setTextInput1}
        placeholder="Enter text 1 for embedding"
        placeholderTextColor={colors.text._400}
        style={[
          styles.textInput,
          {
            color: colors.text._100,
            borderColor: colors.text._400,
          },
        ]}
      />
      <TextInput
        value={textInput2}
        onChangeText={setTextInput2}
        placeholder="Enter text 2 for embedding"
        placeholderTextColor={colors.text._400}
        style={[
          styles.textInput,
          {
            color: colors.text._100,
            borderColor: colors.text._400,
          },
        ]}
      />
      <TouchableOpacity
        onPress={handleTestEmbedding}
        style={[styles.button, { backgroundColor: colors.accent }]}
      >
        <Text style={[styles.buttonText, { color: colors.buttonText }]}>Calculate Embedding Similarity</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => { setTextInput1(''); setTextInput2(''); setEmbeddingOutput(''); }}
        style={[styles.button, { backgroundColor: colors.secondary }]}
      >
        <Text style={[styles.buttonText, { color: colors.buttonText }]}>Clear Text Inputs</Text>
      </TouchableOpacity>

      {embeddingOutput ? (
        <Text style={[styles.outputText, { color: colors.text._100 }]}>{embeddingOutput}</Text>
      ) : null}

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
    padding: 20,
  },
  indicator: {
    marginVertical: 10,
  },
  text: {
    marginTop: 10,
  },
  previewContainer: {
    marginTop: 10,
    padding: 10,
    borderRadius: 5,
    maxHeight: 150, // Limit preview height
    overflow: 'hidden',
  },
  previewText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', // Better monospace font handling
    fontSize: 12,
  },
  errorText: {
    marginTop: 10,
    color: 'red',
  },
  separator: {
    height: 1,
    backgroundColor: '#ccc',
    marginVertical: 20,
  },
  button: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 5,
  },
  buttonText: {
    fontWeight: 'bold',
    fontSize: 16,
  },
  textInput: {
    padding: 10,
    borderRadius: 5,
    borderWidth: 1,
    marginVertical: 8,
    fontSize: 14,
  },
  outputText: {
    marginTop: 10,
    padding: 10,
    borderRadius: 5,
    backgroundColor: '#f0f0f0', // Placeholder, use theme color
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
  },
  dbButtonContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  smallButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 5,
    width: '48%', // Roughly half width
  },
});
