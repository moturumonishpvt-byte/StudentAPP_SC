package com.am_student_app.tflite

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Log
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.*
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import org.tensorflow.lite.Interpreter
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import kotlin.math.sqrt

/**
 * TFLiteModule.kt — AM_Student
 *
 * PIPELINE (synchronized with Faculty production app):
 *   1. Read JPEG at FULL resolution
 *   2. Fix EXIF rotation
 *   3. Mirror-flip horizontally (front camera)
 *   4. Detect face with ML Kit → pick largest
 *   5. Apply 20% margin padding
 *   6. Full-resolution face crop
 *   7. Anti-spoof analysis on FULL-RES crop (BEFORE downscaling)
 *   8. Resize to 112×112
 *   9. Adaptive lighting normalization
 *  10. Normalize: pixel = (pixel / 127.5) - 1.0  [RGB, float32]
 *  11. Run MobileFaceNet TFLite
 *  12. L2-normalize to unit sphere
 *
 * NOTE: BLE logic is completely untouched.
 */
class TFLiteModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var interpreter: Interpreter? = null

    // CONFIG
    private val L2_NORMALIZE    = true
    private val FLIP_HORIZONTAL = true   // front camera images are mirrored
    private val FACE_MARGIN     = 0.20f  // 20% padding around bounding box

    // Lazy-initialized to avoid crashing during class construction if ML Kit isn't ready
    private val detector by lazy {
        val opts = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
            .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
            .build()
        FaceDetection.getClient(opts)
    }

    override fun getName(): String = "TFLiteModule"

    @ReactMethod
    fun loadModelFromAssets(assetPath: String, promise: Promise) {
        try {
            val afd = reactContext.assets.openFd(assetPath)
            val inputStream = FileInputStream(afd.fileDescriptor)
            val fileChannel = inputStream.channel
            val modelBuffer = fileChannel.map(
                FileChannel.MapMode.READ_ONLY,
                afd.startOffset,
                afd.declaredLength
            )
            val options = Interpreter.Options().apply {
                setNumThreads(4)
                try { setUseNNAPI(true) } catch (_: Exception) {}
            }
            interpreter?.close()
            interpreter = Interpreter(modelBuffer, options)
            promise.resolve(true)
        } catch (e: Exception) {
            // Fallback without NNAPI
            try {
                val afd = reactContext.assets.openFd(assetPath)
                val buffer = FileInputStream(afd.fileDescriptor).channel
                    .map(FileChannel.MapMode.READ_ONLY, afd.startOffset, afd.declaredLength)
                interpreter?.close()
                interpreter = Interpreter(buffer, Interpreter.Options().apply { setNumThreads(4) })
                promise.resolve(true)
            } catch (fe: Exception) {
                promise.reject("LOAD_ERROR", "Failed to load model: ${fe.message}", fe)
            }
        }
    }

    @ReactMethod
    fun loadModel(modelPath: String, promise: Promise) {
        try {
            val file = File(modelPath)
            interpreter?.close()
            interpreter = Interpreter(file, Interpreter.Options().apply { setNumThreads(4) })
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("LOAD_ERROR", "Failed to load model from file: ${e.message}", e)
        }
    }

    /**
     * Legacy inference method kept for backwards compatibility with faceEmbedding.ts.
     * faceEmbedding.ts calls TFLiteModule.runInference(inputArray) directly.
     */
    @ReactMethod
    fun runInference(inputArray: ReadableArray, promise: Promise) {
        try {
            val tflite = interpreter ?: throw IllegalStateException("Model not loaded")
            val byteBuffer = ByteBuffer.allocateDirect(1 * 112 * 112 * 3 * 4)
            byteBuffer.order(ByteOrder.nativeOrder())
            for (i in 0 until inputArray.size()) {
                byteBuffer.putFloat(inputArray.getDouble(i).toFloat())
            }
            val outputBuffer = Array(1) { FloatArray(192) }
            tflite.run(byteBuffer, outputBuffer)
            val raw = outputBuffer[0].sliceArray(0 until 128)
            var normSq = 0f
            for (v in raw) normSq += v * v
            val norm = sqrt(normSq.toDouble()).toFloat()
            val resultList = Arguments.createArray()
            for (v in raw) resultList.pushDouble(if (norm > 0) (v / norm).toDouble() else v.toDouble())
            promise.resolve(resultList)
        } catch (e: Exception) {
            promise.reject("INFERENCE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun recognizeFaceFromFile(imagePath: String, promise: Promise) {
        val interp = interpreter
        if (interp == null) {
            promise.reject("MODEL_NOT_LOADED", "Security module not ready")
            return
        }

        try {
            val path = imagePath.removePrefix("file://")
            val file = File(path)
            if (!file.exists()) {
                promise.reject("FILE_NOT_FOUND", "Capture failed")
                return
            }

            var bitmap = BitmapFactory.decodeFile(path)
            if (bitmap == null) {
                promise.reject("DECODE_ERROR", "Processing failed")
                return
            }

            bitmap = fixExifRotation(bitmap, path)

            if (FLIP_HORIZONTAL) {
                val matrix = Matrix().apply { preScale(-1f, 1f) }
                val flipped = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, false)
                if (flipped != bitmap) bitmap.recycle()
                bitmap = flipped
            }

            val image = InputImage.fromBitmap(bitmap, 0)
            val sourceBitmap = bitmap

            detector.process(image)
                .addOnSuccessListener { faces ->
                    try {
                        if (faces.isEmpty()) {
                            promise.reject("NO_FACE", "No face detected")
                            return@addOnSuccessListener
                        }

                        val face = faces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() }!!
                        val bounds = face.boundingBox

                        // Extract ML Kit Liveness & Classification Metrics
                        val leftEyeOpen  = face.leftEyeOpenProbability  ?: -1f
                        val rightEyeOpen = face.rightEyeOpenProbability ?: -1f
                        val eulerY = face.headEulerAngleY
                        val eulerZ = face.headEulerAngleZ

                        // 5-Point Landmark Facial Alignment before crop
                        val croppedRaw = alignAndCropFace(sourceBitmap, face)

                        // Anti-spoof analysis on FULL-RESOLUTION croppedRaw BEFORE downscaling.
                        // Downscaling to 112x112 blurs Moiré patterns & saturation variance, defeating detection.
                        val spoofAnalysis = analyzeReflectionAndLiveness(sourceBitmap, bounds, croppedRaw)
                        val isSpoof      = spoofAnalysis.first
                        val spoofReason  = spoofAnalysis.second

                        val cropped = Bitmap.createScaledBitmap(croppedRaw, 112, 112, true)
                        if (croppedRaw != cropped) croppedRaw.recycle()

                        // Adaptive Lighting Normalization
                        val pixels = IntArray(112 * 112)
                        cropped.getPixels(pixels, 0, 112, 0, 0, 112, 112)

                        var totalLuminance = 0.0
                        for (p in pixels) {
                            val r = (p shr 16) and 0xFF
                            val g = (p shr 8)  and 0xFF
                            val b = p and 0xFF
                            totalLuminance += 0.299 * r + 0.587 * g + 0.114 * b
                        }
                        val avgLuminance = totalLuminance / pixels.size

                        val adaptiveGain = when {
                            avgLuminance < 60.0  -> Math.min(1.8, 60.0 / Math.max(avgLuminance, 15.0))
                            avgLuminance > 200.0 -> Math.max(0.7, 200.0 / avgLuminance)
                            else -> 1.0
                        }

                        val inputBuffer = ByteBuffer.allocateDirect(1 * 112 * 112 * 3 * 4)
                        inputBuffer.order(ByteOrder.nativeOrder())

                        for (pixel in pixels) {
                            var r = ((pixel shr 16) and 0xFF).toDouble()
                            var g = ((pixel shr 8)  and 0xFF).toDouble()
                            var b = (pixel and 0xFF).toDouble()

                            if (adaptiveGain != 1.0) {
                                r = Math.min(255.0, Math.max(0.0, (r - 127.5) * adaptiveGain + 127.5))
                                g = Math.min(255.0, Math.max(0.0, (g - 127.5) * adaptiveGain + 127.5))
                                b = Math.min(255.0, Math.max(0.0, (b - 127.5) * adaptiveGain + 127.5))
                            }

                            inputBuffer.putFloat(((r - 127.5) / 128.0).toFloat())
                            inputBuffer.putFloat(((g - 127.5) / 128.0).toFloat())
                            inputBuffer.putFloat(((b - 127.5) / 128.0).toFloat())
                        }
                        inputBuffer.rewind()
                        cropped.recycle()
                        sourceBitmap.recycle()

                        val outputShape = interp.getOutputTensor(0).shape()
                        val outputSize  = outputShape.fold(1) { acc, d -> acc * d }
                        val outputBuffer = ByteBuffer.allocateDirect(outputSize * 4)
                        outputBuffer.order(ByteOrder.nativeOrder())
                        interp.run(inputBuffer, outputBuffer)
                        outputBuffer.rewind()

                        val raw = FloatArray(outputSize) { outputBuffer.getFloat() }

                        val finalEmbedding: List<Float> = if (L2_NORMALIZE) {
                            val norm = sqrt(raw.sumOf { (it * it).toDouble() }).toFloat()
                            if (norm > 0f) raw.map { it / norm } else raw.toList()
                        } else {
                            raw.toList()
                        }

                        val result = Arguments.createMap()
                        val embeddingArray = Arguments.createArray()
                        finalEmbedding.take(128).forEach { embeddingArray.pushDouble(it.toDouble()) }
                        result.putArray("embedding", embeddingArray)
                        result.putBoolean("isSpoof", isSpoof)
                        result.putString("reason", spoofReason)
                        result.putDouble("leftEyeOpen",  leftEyeOpen.toDouble())
                        result.putDouble("rightEyeOpen", rightEyeOpen.toDouble())
                        result.putDouble("eulerY", eulerY.toDouble())
                        result.putDouble("eulerZ", eulerZ.toDouble())
                        promise.resolve(result)

                    } catch (e: Exception) {
                        promise.reject("POST_DETECT_ERROR", "Internal system error")
                    }
                }
                .addOnFailureListener {
                    promise.reject("MLKIT_ERROR", "Face detection failed")
                }

        } catch (e: Exception) {
            promise.reject("RECOGNITION_ERROR", "System busy")
        }
    }

    /**
     * 5-Layer Anti-Spoofing & Liveness Analyzer.
     *  1. Specular reflection glare (screen glass highlight)
     *  2. Display color channel shift (blue-dominant backlight)
     *  3. Video/photo screen self-illumination (face brighter than background)
     *  4. HSV Saturation variance (flat display vs. 3D skin subsurface)
     *  5. Laplacian texture variance (Moiré screen grid & 2D re-capture blur)
     *
     * Analysis is performed on FULL-RESOLUTION faceCrop to preserve all fine texture.
     */
    private fun analyzeReflectionAndLiveness(
        fullBitmap: Bitmap,
        faceBounds: android.graphics.Rect,
        faceCrop: Bitmap
    ): Pair<Boolean, String> {
        val width  = faceCrop.width
        val height = faceCrop.height
        val pixels = IntArray(width * height)
        faceCrop.getPixels(pixels, 0, width, 0, 0, width, height)

        var specularCount = 0
        var totalR = 0.0
        var totalG = 0.0
        var totalB = 0.0

        val saturations = FloatArray(pixels.size)
        val grays       = FloatArray(pixels.size)

        val hsv = FloatArray(3)
        for (i in pixels.indices) {
            val p = pixels[i]
            val r = (p shr 16) and 0xFF
            val g = (p shr 8)  and 0xFF
            val b = p and 0xFF

            totalR += r
            totalG += g
            totalB += b

            grays[i] = (0.299f * r + 0.587f * g + 0.114f * b)

            android.graphics.Color.RGBToHSV(r, g, b, hsv)
            saturations[i] = hsv[1]

            // Layer 1: Screen Specular Highlight
            if (r > 245 && g > 245 && b > 245) specularCount++
        }

        // Layer 1: Specular Glare Reflection Check
        val specularRatio = specularCount.toDouble() / pixels.size
        if (specularRatio > 0.04) {
            return Pair(true, "Screen Specular Glare Detected")
        }

        // Layer 2: Display Color Shift Check
        val avgR = totalR / pixels.size
        val avgG = totalG / pixels.size
        val avgB = totalB / pixels.size
        if (avgB > avgR && avgB > avgG + 10.0) {
            return Pair(true, "Display Screen Color Shift Detected")
        }

        // Layer 3: VIDEO/PHOTO SCREEN SELF-ILLUMINATION DETECTION
        // A video/photo on a phone screen acts as its own backlight:
        //   → face region significantly brighter than surrounding background
        //   → creates luminance step-up at the screen boundary
        // A real person: face and background share the same ambient light → ratio near 1.0
        run {
            val bmpW = fullBitmap.width
            val bmpH = fullBitmap.height

            val margin  = (faceBounds.width() * 0.15f).toInt().coerceAtLeast(20)
            val bgLeft  = (faceBounds.left   - margin).coerceAtLeast(0)
            val bgTop   = (faceBounds.top    - margin).coerceAtLeast(0)
            val bgRight = (faceBounds.right  + margin).coerceAtMost(bmpW)
            val bgBot   = (faceBounds.bottom + margin).coerceAtMost(bmpH)

            if (bgRight - bgLeft > 40 && bgBot - bgTop > 40) {
                var bgLum = 0.0; var bgCount = 0

                // Sample top strip (above face)
                for (x in bgLeft until bgRight step 4) {
                    for (y in bgTop until faceBounds.top.coerceAtMost(bgBot) step 4) {
                        val p = fullBitmap.getPixel(x, y)
                        bgLum += 0.299 * ((p shr 16) and 0xFF) +
                                 0.587 * ((p shr 8)  and 0xFF) +
                                 0.114 * (p and 0xFF)
                        bgCount++
                    }
                }
                // Sample bottom strip (below face)
                for (x in bgLeft until bgRight step 4) {
                    for (y in faceBounds.bottom.coerceAtLeast(bgTop) until bgBot step 4) {
                        val p = fullBitmap.getPixel(x, y)
                        bgLum += 0.299 * ((p shr 16) and 0xFF) +
                                 0.587 * ((p shr 8)  and 0xFF) +
                                 0.114 * (p and 0xFF)
                        bgCount++
                    }
                }

                if (bgCount > 10) {
                    val avgBgLum   = bgLum / bgCount
                    val avgFaceLum = grays.average()

                    // Screen self-illumination: face > 1.7x brighter than background
                    if (avgBgLum > 15.0 && avgFaceLum / avgBgLum > 1.7) {
                        return Pair(true, "Screen Backlight Illumination Detected")
                    }
                    // Background luminance spike: screen bezel / external display in frame
                    if (avgFaceLum > 10.0 && avgBgLum / avgFaceLum > 2.2) {
                        return Pair(true, "Screen Reflection in Background Detected")
                    }
                }
            }
        }

        // Layer 4: HSV Saturation Standard Deviation
        // Real 3D human skin: stdDevSat > 0.10 (subsurface scattering & 3D shadow variation)
        // Phone display flat backlight array: stdDevSat < 0.055 (uniform flat emission)
        val avgSat      = saturations.average()
        val varianceSat = saturations.fold(0.0) { acc, s -> acc + Math.pow(s - avgSat, 2.0) } / saturations.size
        val stdDevSat   = Math.sqrt(varianceSat)
        if (stdDevSat < 0.055 && avgSat > 0.04) {
            return Pair(true, "Photo/Display Flat Saturation Detected")
        }

        // Layer 5: Laplacian Variance (Moiré Screen Frequency & Re-capture Blur)
        // Screen photo re-capture: low texture blur (lapVariance < 45.0)
        // Screen Moiré pixel grid frequency spike: lapVariance > 1200.0
        var laplacianSum   = 0.0
        var laplacianSqSum = 0.0
        var count          = 0

        for (y in 1 until height - 1) {
            for (x in 1 until width - 1) {
                val center = grays[y * width + x]
                val lap    = grays[y * width + (x + 1)] +
                             grays[y * width + (x - 1)] +
                             grays[(y + 1) * width + x] +
                             grays[(y - 1) * width + x] - 4f * center
                laplacianSum   += lap
                laplacianSqSum += lap * lap
                count++
            }
        }

        if (count > 0) {
            val meanLap    = laplacianSum / count
            val lapVariance = (laplacianSqSum / count) - (meanLap * meanLap)
            if (lapVariance < 45.0 || lapVariance > 1200.0) {
                return Pair(true, "Screen Moiré / Photo Texture Detected")
            }
        }

        return Pair(false, "")
    }

    private fun fixExifRotation(bitmap: Bitmap, filePath: String): Bitmap {
        return try {
            val exif        = ExifInterface(filePath)
            val orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            val degrees     = when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90  -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> return bitmap
            }
            val matrix = Matrix().apply { postRotate(degrees) }
            Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
                .also { if (it != bitmap) bitmap.recycle() }
        } catch (e: Exception) {
            bitmap
        }
    }

    /**
     * Aligns and crops face bitmap using ML Kit eye landmarks.
     * Computes 2D rotation & scale so eyes are horizontally aligned.
     */
    private fun alignAndCropFace(source: Bitmap, face: com.google.mlkit.vision.face.Face): Bitmap {
        val bounds = face.boundingBox
        val leftEyeLandmark = face.getLandmark(FaceLandmark.LEFT_EYE)
        val rightEyeLandmark = face.getLandmark(FaceLandmark.RIGHT_EYE)

        if (leftEyeLandmark != null && rightEyeLandmark != null) {
            val leftEye = leftEyeLandmark.position
            val rightEye = rightEyeLandmark.position

            val dx = (rightEye.x - leftEye.x).toDouble()
            val dy = (rightEye.y - leftEye.y).toDouble()
            val eyeDist = sqrt(dx * dx + dy * dy)

            if (eyeDist > 5.0) {
                val angle = Math.toDegrees(Math.atan2(dy, dx)).toFloat()
                val eyeCenterX = (leftEye.x + rightEye.x) / 2f
                val eyeCenterY = (leftEye.y + rightEye.y) / 2f

                // Rotate bitmap so eyes are horizontal
                val matrix = Matrix().apply {
                    postRotate(-angle, eyeCenterX, eyeCenterY)
                }
                val rotated = Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)

                // Normalized face box matching MobileFaceNet standard crop bounds
                val cropW = (bounds.width() * 1.35f).toInt()
                val cropH = (bounds.height() * 1.35f).toInt()
                val cropLeft = maxOf(0, (eyeCenterX - cropW / 2f).toInt())
                val cropTop = maxOf(0, (eyeCenterY - cropH * 0.45f).toInt())
                val actualW = minOf(rotated.width - cropLeft, cropW)
                val actualH = minOf(rotated.height - cropTop, cropH)

                if (actualW > 20 && actualH > 20) {
                    val alignedCrop = Bitmap.createBitmap(rotated, cropLeft, cropTop, actualW, actualH)
                    if (rotated != source) rotated.recycle()
                    return alignedCrop
                }
            }
        }

        // Fallback: standard bounding box with 20% margin
        val marginW = (bounds.width() * FACE_MARGIN).toInt()
        val marginH = (bounds.height() * FACE_MARGIN).toInt()
        val left = maxOf(0, bounds.left - marginW)
        val top = maxOf(0, bounds.top - marginH)
        val right = minOf(source.width, bounds.right + marginW)
        val bottom = minOf(source.height, bounds.bottom + marginH)
        val cropW = right - left
        val cropH = bottom - top

        return if (cropW > 0 && cropH > 0) {
            Bitmap.createBitmap(source, left, top, cropW, cropH)
        } else {
            Bitmap.createBitmap(source, maxOf(0, bounds.left), maxOf(0, bounds.top), maxOf(1, bounds.width()), maxOf(1, bounds.height()))
        }
    }

    companion object {
        private const val TAG = "FacePipeline"
    }
}
