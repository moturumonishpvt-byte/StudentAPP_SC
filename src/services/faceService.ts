import { loadEmbeddingModel } from '../facerecg/faceEmbedding';
import {
  maxSimilarityAgainstTemplates,
  VERIFICATION_THRESHOLD,
  MARGIN_THRESHOLD,
} from '../facerecg/faceCompare';
import { storageService } from './storageService';

export interface LivenessData {
  isLive: boolean;
  livenessScore: number;
  livenessReason: string;
}

export interface FaceMatchResult {
  success: boolean;
  studentId?: string;
  studentName?: string;
  message?: string;
  livenessData?: LivenessData;
}

export const faceService = {
  /**
   * Pre-loads the TFLite model so it is ready when the camera opens.
   */
  async initializeModels() {
    console.log('[FaceService] Loading TFLite native model...');
    await loadEmbeddingModel();
    console.log('[FaceService] TFLite ready. Init complete.');
  },

  /**
   * Match a pre-computed embedding against locally cached student embeddings.
   * Enforces 2D Liveness verification, strict 0.68 threshold, and top-2 margin safety.
   */
  matchEmbedding(
    embedding: number[],
    livenessData?: LivenessData,
  ): FaceMatchResult {
    if (!embedding || embedding.length === 0) {
      return { success: false, message: '⚠️ Empty embedding — model error' };
    }

    // 1. Check Anti-Spoofing Liveness First
    if (livenessData && !livenessData.isLive) {
      return {
        success: false,
        message: `🚫 Spoof Detected: ${livenessData.livenessReason}`,
        livenessData,
      };
    }

    const storedData = storageService.getObject('studentEmbeddings');

    if (!storedData || Object.keys(storedData).length === 0) {
      return {
        success: false,
        message: '⚠️ No student data synced. Check your Supabase connection.',
      };
    }

    let top1Id: string | null = null;
    let top1Name: string | null = null;
    let top1Score = 0;
    let top2Score = 0;

    // Compare query embedding against every registered student profile
    for (const [studentId, studentInfo] of Object.entries<any>(storedData)) {
      if (studentInfo.embedding) {
        const sim = maxSimilarityAgainstTemplates(
          embedding,
          studentInfo.embedding,
        );
        if (sim > top1Score) {
          top2Score = top1Score;
          top1Score = sim;
          top1Id = studentId;
          top1Name = studentInfo.name;
        } else if (sim > top2Score) {
          top2Score = sim;
        }
      }
    }

    // 2. Strict Threshold & Top-2 Margin Validation
    // Requires top1Score >= 0.68 AND (top1Score - top2Score) >= 0.10
    const margin = top1Score - top2Score;
    const isStrictMatch =
      top1Id &&
      top1Score >= VERIFICATION_THRESHOLD &&
      (Object.keys(storedData).length === 1 || margin >= MARGIN_THRESHOLD);

    if (isStrictMatch) {
      const matchPercent = (top1Score * 100).toFixed(0);
      return {
        success: true,
        studentId: top1Id!,
        studentName: top1Name!,
        message: `✅ Identity Verified: ${top1Name} (${matchPercent}%)`,
        livenessData,
      };
    }

    // 3. Rejection of Impostors & Unregistered Faces
    if (top1Score < VERIFICATION_THRESHOLD) {
      return {
        success: false,
        message: `❌ Access Denied: Unregistered Face (${(
          top1Score * 100
        ).toFixed(0)}%)`,
        livenessData,
      };
    }

    // Ambiguous match (top1 and top2 profiles are too close)
    return {
      success: false,
      message: '⚠️ Access Denied: Low confidence margin',
      livenessData,
    };
  },

  /**
   * Legacy method kept for compatibility.
   */
  async processFrame(): Promise<FaceMatchResult> {
    return {
      success: false,
      message: 'Use matchEmbedding() with the native fast path.',
    };
  },
};
