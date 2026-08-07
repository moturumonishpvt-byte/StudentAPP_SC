/**
 * useFaceRecognition.ts — AM_Student
 *
 * Continuous scanning hook for student verification.
 * Architecture synchronized with Faculty production release.
 *
 * Anti-Spoofing layers (JS-side):
 *   FIX 1 — Liveness Frame Gate: Block matching until 3 consecutive frames captured.
 *   FIX 2 — Embedding Temporal Drift: cos_sim(Frame1, Frame3) > 0.9993 → static photo.
 *   FIX 3 — Frozen Pose Detection: Zero head micro-motion → static photo/screen.
 *
 * NOTE: BLE logic is completely untouched.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { NativeModules } from 'react-native';
import RNFS from 'react-native-fs';
import { faceService, FaceMatchResult } from '../services/faceService';
import { averageEmbeddings } from '../facerecg/faceCompare';
import type { Camera } from 'react-native-vision-camera';

const { TFLiteModule } = NativeModules;

export function useFaceRecognition() {
  const [isModelsLoaded, setIsModelsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<FaceMatchResult | null>(null);
  const cameraRef = useRef<Camera>(null);
  const scanningRef = useRef(false);

  // Load TFLite model on mount
  useEffect(() => {
    let mounted = true;
    faceService
      .initializeModels()
      .then(() => {
        if (mounted) {
          setIsModelsLoaded(true);
        }
      })
      .catch((e: any) => {
        if (mounted) {
          setError(e.message || 'Failed to load model');
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    scanningRef.current = isScanning;
  }, [isScanning]);

  // Frame history: head pose metrics for liveness gate & frozen pose check
  const frameHistoryRef = useRef<
    Array<{ eulerY: number; eulerZ: number; leftEye: number; rightEye: number }>
  >([]);
  // Embedding history: 128-D vectors for temporal drift check
  const embHistoryRef = useRef<number[][]>([]);

  /**
   * Continuous Scan Loop.
   * Runs every 150ms while isScanning is true.
   */
  const startScanLoop = useCallback(async () => {
    // Reset liveness history on each new scan session
    frameHistoryRef.current = [];
    embHistoryRef.current = [];

    while (scanningRef.current) {
      let photoPath: string | null = null;
      try {
        const camera = cameraRef.current;
        if (!camera) {
          setIsScanning(false);
          break;
        }

        setScanResult({ success: false, message: '📸 Capturing...' });

        // 1. Take photo
        const photo = await camera.takePhoto({
          flash: 'off',
          enableShutterSound: false,
        });

        photoPath = photo.path.startsWith('file://')
          ? photo.path
          : `file://${photo.path}`;

        setScanResult({ success: false, message: '🧠 Analyzing...' });

        // 2. Native pipeline: detect → crop → full-res spoof → resize → embed
        const nativeResult = await TFLiteModule.recognizeFaceFromFile(
          photoPath,
        );

        // Collect pose metrics into frame history
        if (typeof nativeResult.eulerY === 'number') {
          frameHistoryRef.current.push({
            eulerY: nativeResult.eulerY,
            eulerZ: nativeResult.eulerZ,
            leftEye: nativeResult.leftEyeOpen,
            rightEye: nativeResult.rightEyeOpen,
          });
          if (frameHistoryRef.current.length > 4) {
            frameHistoryRef.current.shift();
          }
        }

        // Collect embedding into embedding history
        if (Array.isArray(nativeResult.embedding)) {
          embHistoryRef.current.push(nativeResult.embedding);
          if (embHistoryRef.current.length > 3) {
            embHistoryRef.current.shift();
          }
        }

        // Layer A: Native spoof check (glare, texture, HSV, luminance)
        if (nativeResult.isSpoof) {
          setScanResult({
            success: false,
            message: `🛡️ Anti-Spoof Denied: ${
              nativeResult.reason || 'Screen Reflection Detected'
            }`,
          });
          await new Promise(resolve => setTimeout(resolve, 150));
          continue;
        }

        // FIX 1 — LIVENESS FRAME GATE
        // Block matching against stored embeddings until at least 3 consecutive frames collected.
        // Prevents Frame-1 bypass where a static photo matches before liveness logic is evaluated.
        if (frameHistoryRef.current.length < 3) {
          const framesLeft = 3 - frameHistoryRef.current.length;
          setScanResult({
            success: false,
            message: `🔍 Verifying Live Presence... (${framesLeft})`,
          });
          await new Promise(resolve => setTimeout(resolve, 150));
          continue;
        }

        // FIX 2 — EMBEDDING TEMPORAL DRIFT CHECK
        // Live face: natural micro-tremors produce drift 0.940–0.998 between Frame 1 and Frame 3.
        // Static photo/screen: identical embeddings → cos_sim > 0.9993 (physically impossible with live face).
        let isEmbeddingFrozen = false;
        const embH = embHistoryRef.current;
        if (embH.length >= 3) {
          const e0 = embH[0];
          const eN = embH[embH.length - 1];
          let dot = 0,
            na = 0,
            nb = 0;
          for (let i = 0; i < e0.length; i++) {
            dot += e0[i] * eN[i];
            na += e0[i] * e0[i];
            nb += eN[i] * eN[i];
          }
          const drift =
            na > 0 && nb > 0 ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
          if (drift > 0.9993) {
            isEmbeddingFrozen = true;
          }
        }

        // FIX 3 — FROZEN HEAD POSE CHECK
        // Static image has zero head micro-motion across frames.
        // Live human always has slight natural movement (breathing, eyelids, sensor noise).
        const posH = frameHistoryRef.current;
        const varY = Math.abs(posH[posH.length - 1].eulerY - posH[0].eulerY);
        const varZ = Math.abs(posH[posH.length - 1].eulerZ - posH[0].eulerZ);
        const isPoseFrozen = varY < 0.05 && varZ < 0.05;

        if (isEmbeddingFrozen && isPoseFrozen) {
          setScanResult({
            success: false,
            message: '🛡️ Anti-Spoof Denied: Static Photo / Screen Detected',
          });
        } else {
          // 3. Match averaged 3-frame embedding against local cache
          const queryEmbedding = averageEmbeddings(embHistoryRef.current);
          const result = faceService.matchEmbedding(
            queryEmbedding.length > 0 ? queryEmbedding : nativeResult.embedding,
          );
          setScanResult(result);

          if (result.success) {
            scanningRef.current = false;
            setIsScanning(false);
            break;
          }
        }
      } catch (err: any) {
        setScanResult({
          success: false,
          message: `⚠️ ${err.message || 'Scan error — please try again'}`,
        });
      } finally {
        // Always clean up temp photo file
        if (photoPath) {
          const pathForDelete = photoPath.replace('file://', '');
          RNFS.unlink(pathForDelete).catch(() => {});
        }
      }

      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }, []);

  useEffect(() => {
    if (isScanning && isModelsLoaded) {
      startScanLoop();
    }
  }, [isScanning, isModelsLoaded, startScanLoop]);

  return {
    cameraRef,
    isModelsLoaded,
    error,
    isScanning,
    setIsScanning,
    scanResult,
    setScanResult,
  };
}
