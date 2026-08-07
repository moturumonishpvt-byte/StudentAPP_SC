/**
 * faceDetector.ts
 * Loads BlazeFace model and handles face detection + cropping directly built for React Native.
 */

import * as blazeface from '@tensorflow-models/blazeface';
import * as tf from '@tensorflow/tfjs';

let blazeFaceModel: blazeface.BlazeFaceModel | null = null;

/**
 * Load and cache the BlazeFace model.
 */
export async function loadBlazeFace(): Promise<blazeface.BlazeFaceModel> {
  if (blazeFaceModel) {
    return blazeFaceModel;
  }
  console.log(
    '[FaceDetector] Starting blazeface.load() (may download weights)...',
  );
  try {
    blazeFaceModel = await blazeface.load();
    console.log('[FaceDetector] blazeface.load() completed.');
    return blazeFaceModel;
  } catch (error) {
    console.error('[FaceDetector] Failed to load BlazeFace:', error);
    throw error;
  }
}

/**
 * Detect faces from a 3D Tensor (typically an image frame).
 * Returns the single best face prediction, or null if:
 *   - No face detected
 *   - More than one face detected
 */
export async function detectFace(
  imageTensor: tf.Tensor3D,
): Promise<blazeface.NormalizedFace | null> {
  const model = await loadBlazeFace();

  // estimateFaces accepts a Tensor3D in its overloaded signature
  const predictions = await model.estimateFaces(imageTensor, false);

  if (!predictions || predictions.length === 0) {
    return null;
  }
  if (predictions.length > 1) {
    return null;
  } // Only allow one face for authentication

  return predictions[0];
}

/**
 * Crop the detected face region from the original tensor and
 * resize it to 112×112 pixels (MobileFaceNet input requirement).
 */
export function cropAndResize(
  imageTensor: tf.Tensor3D,
  prediction: blazeface.NormalizedFace,
): tf.Tensor3D {
  // Extract bounding box — topLeft and bottomRight are [x, y] coordinates
  const topLeft = prediction.topLeft as [number, number];
  const bottomRight = prediction.bottomRight as [number, number];

  const x = topLeft[0];
  const y = topLeft[1];
  const w = bottomRight[0] - topLeft[0];
  const h = bottomRight[1] - topLeft[1];

  // Add a small margin for better embedding quality (catching the full chin/forehead)
  const margin = 0.15;
  const mx = w * margin;
  const my = h * margin;

  const [imageHeight, imageWidth] = imageTensor.shape.slice(0, 2);

  const sx = Math.max(0, x - mx);
  const sy = Math.max(0, y - my);
  const sw = Math.min(imageWidth - sx, w + 2 * mx);
  const sh = Math.min(imageHeight - sy, h + 2 * my);

  // Normalize absolute coordinates [sy, sx, sy+sh, sx+sw] to relative [0..1]
  // required by tf.image.cropAndResize
  const y1 = sy / imageHeight;
  const x1 = sx / imageWidth;
  const y2 = (sy + sh) / imageHeight;
  const x2 = (sx + sw) / imageWidth;

  const boxes = tf.tensor2d([[y1, x1, y2, x2]], [1, 4]);
  const boxInd = tf.tensor1d([0], 'int32');
  const cropSize: [number, number] = [112, 112];

  // cropAndResize expects a 4D tensor (batch_size, height, width, channels)
  const expandedImage = imageTensor.expandDims<tf.Tensor4D>(0);

  // Perform crop and resize
  const cropped = tf.image.cropAndResize(
    expandedImage,
    boxes,
    boxInd,
    cropSize,
    'bilinear',
  );

  // Remove the batch dimension to return a 3D Tensor
  const result = cropped.squeeze<tf.Tensor3D>([0]);

  // Clean up intermediate tensors to prevent memory leaks in RN
  tf.dispose([boxes, boxInd, expandedImage, cropped]);

  return result;
}
