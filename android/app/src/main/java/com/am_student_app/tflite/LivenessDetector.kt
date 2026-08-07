package com.am_student_app.tflite

import android.graphics.Bitmap
import android.graphics.Color
import kotlin.math.abs
import kotlin.math.sqrt

data class LivenessResult(
    val isLive: Boolean,
    val score: Float,
    val reason: String,
    val moireScore: Float,
    val reflectionScore: Float,
    val illuminantMatchScore: Float
)

object LivenessDetector {

    /**
     * Performs multi-factor 2D RGB anti-spoofing analysis on a captured camera frame.
     * Evaluates:
     *   1. Screen pixel grid & moiré pattern energy (Laplacian spatial frequency)
     *   2. Screen planar reflection & specular glare highlights
     *   3. Background vs. Face color temperature & illuminant consistency
     */
    fun analyzeLiveness(fullFrame: Bitmap, faceCrop: Bitmap): LivenessResult {
        // 1. Moiré & Texture Grid Analysis on face crop
        val moireScore = computeMoireScore(faceCrop)

        // 2. Screen Specular Glare & Reflection Analysis
        val reflectionScore = computeReflectionScore(faceCrop)

        // 3. Background vs. Face Illumination Consistency Analysis
        val illuminantMatchScore = computeIlluminationConsistency(fullFrame, faceCrop)

        // Combine scores into overall liveness confidence [0.0, 1.0]
        // Higher score = Real Live Person; Lower score = Spoof / Screen / Print
        val totalScore = (0.35f * moireScore) + (0.35f * reflectionScore) + (0.30f * illuminantMatchScore)

        val isLive = totalScore >= 0.58f && moireScore >= 0.45f && illuminantMatchScore >= 0.40f

        val reason = when {
            moireScore < 0.45f -> "Screen pixel grid / Moiré pattern detected"
            reflectionScore < 0.45f -> "Unnatural screen reflection / glass glare detected"
            illuminantMatchScore < 0.40f -> "Background light mismatch (Screen replay detected)"
            !isLive -> "Anti-spoofing check failed"
            else -> "Liveness verified"
        }

        return LivenessResult(
            isLive = isLive,
            score = totalScore,
            reason = reason,
            moireScore = moireScore,
            reflectionScore = reflectionScore,
            illuminantMatchScore = illuminantMatchScore
        )
    }

    /**
     * Calculates spatial high-frequency energy.
     * Digital screens and prints exhibit high artificial micro-gradient spikes (moiré / pixel dots).
     */
    private fun computeMoireScore(bitmap: Bitmap): Float {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)

        var laplacianSum = 0.0
        var count = 0

        for (y in 1 until height - 1) {
            for (x in 1 until width - 1) {
                val center = getGray(pixels[y * width + x])
                val left = getGray(pixels[y * width + (x - 1)])
                val right = getGray(pixels[y * width + (x + 1)])
                val top = getGray(pixels[(y - 1) * width + x])
                val bottom = getGray(pixels[(y + 1) * width + x])

                val lap = abs(4 * center - left - right - top - bottom)
                laplacianSum += lap
                count++
            }
        }

        val avgLaplacian = if (count > 0) laplacianSum / count else 0.0

        // Normal human skin has smooth gradients (avg laplacian 8..25).
        // Screen pixel grids / printed halftones produce extreme noise spikes (> 45) or flat blur (< 3).
        return when {
            avgLaplacian in 6.0..32.0 -> 0.95f
            avgLaplacian in 4.0..42.0 -> 0.70f
            avgLaplacian > 45.0 -> 0.20f // Heavy screen pixel grid / moiré
            else -> 0.35f // Unnaturally blurry / static low-res print
        }
    }

    /**
     * Detects planar screen glare and glass reflection highlights.
     */
    private fun computeReflectionScore(bitmap: Bitmap): Float {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)

        var specularPixels = 0
        var totalLum = 0.0

        for (p in pixels) {
            val r = (p shr 16) and 0xFF
            val g = (p shr 8) and 0xFF
            val b = p and 0xFF
            val lum = 0.299 * r + 0.587 * g + 0.114 * b
            totalLum += lum
            // Sharp specular white reflection on glass screen
            if (r > 240 && g > 240 && b > 240) {
                specularPixels++
            }
        }

        val specularRatio = specularPixels.toFloat() / pixels.size

        // If specular glass glare takes > 4% of face area, it's highly indicative of screen reflection
        return when {
            specularRatio < 0.015f -> 0.95f
            specularRatio < 0.035f -> 0.75f
            specularRatio < 0.060f -> 0.40f
            else -> 0.15f // Heavy glass screen reflection
        }
    }

    /**
     * Compares background illumination vs face illumination.
     * Real faces share ambient environmental lighting with the background.
     * Screen-projected faces display independent light emission and color temperature skew.
     */
    private fun computeIlluminationConsistency(fullFrame: Bitmap, faceCrop: Bitmap): Float {
        val (faceR, faceG, faceB) = getAverageRGB(faceCrop)
        val (bgR, bgG, bgB) = getOuterBackgroundRGB(fullFrame)

        // Calculate chromaticity difference (R/G and B/G ratios)
        val faceRG = if (faceG > 0) faceR / faceG else 1.0f
        val faceBG = if (faceG > 0) faceB / faceG else 1.0f

        val bgRG = if (bgG > 0) bgR / bgG else 1.0f
        val bgBG = if (bgG > 0) bgB / bgG else 1.0f

        val diffRG = abs(faceRG - bgRG)
        val diffBG = abs(faceBG - bgBG)
        val chromDistance = sqrt((diffRG * diffRG + diffBG * diffBG).toDouble()).toFloat()

        // Real environment: background and face share similar ambient color temperature.
        // Screen replay: face illuminated by phone screen backlight (high blue/cyan tint) while background has warm ambient light.
        return when {
            chromDistance < 0.25f -> 0.95f
            chromDistance < 0.45f -> 0.75f
            chromDistance < 0.70f -> 0.45f
            else -> 0.20f // Extreme backlight / screen illumination mismatch
        }
    }

    private fun getAverageRGB(bitmap: Bitmap): Triple<Float, Float, Float> {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)

        var sumR = 0L
        var sumG = 0L
        var sumB = 0L

        for (p in pixels) {
            sumR += (p shr 16) and 0xFF
            sumG += (p shr 8) and 0xFF
            sumB += p and 0xFF
        }

        val count = pixels.size.toFloat()
        return Triple(sumR / count, sumG / count, sumB / count)
    }

    private fun getOuterBackgroundRGB(bitmap: Bitmap): Triple<Float, Float, Float> {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)

        var sumR = 0L
        var sumG = 0L
        var sumB = 0L
        var count = 0

        // Sample outer 15% border of full frame (background environment)
        val borderX = (width * 0.15).toInt()
        val borderY = (height * 0.15).toInt()

        for (y in 0 until height) {
            for (x in 0 until width) {
                if (x < borderX || x > width - borderX || y < borderY || y > height - borderY) {
                    val p = pixels[y * width + x]
                    sumR += (p shr 16) and 0xFF
                    sumG += (p shr 8) and 0xFF
                    sumB += p and 0xFF
                    count++
                }
            }
        }

        val total = if (count > 0) count.toFloat() else 1.0f
        return Triple(sumR / total, sumG / total, sumB / total)
    }

    private fun getGray(pixel: Int): Int {
        val r = (pixel shr 16) and 0xFF
        val g = (pixel shr 8) and 0xFF
        val b = pixel and 0xFF
        return (0.299 * r + 0.587 * g + 0.114 * b).toInt()
    }
}
