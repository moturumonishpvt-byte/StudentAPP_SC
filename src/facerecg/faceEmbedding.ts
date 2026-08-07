import { NativeModules } from 'react-native';

const { TFLiteModule } = NativeModules;

let modelLoaded = false;

/**
 * Load the MobileFaceNet TFLite model from Android assets.
 * All inference runs natively via TFLiteModule — TF.js is NOT used or imported.
 */
export async function loadEmbeddingModel(): Promise<void> {
  if (modelLoaded) {
    return;
  }
  await new Promise(resolve => setTimeout(resolve, 500));
  await TFLiteModule.loadModelFromAssets('models/mobilefacenet.tflite');
  modelLoaded = true;
}

export function normalizeEmbedding(embedding: number[]): number[] {
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? embedding.map(v => v / norm) : embedding;
}
