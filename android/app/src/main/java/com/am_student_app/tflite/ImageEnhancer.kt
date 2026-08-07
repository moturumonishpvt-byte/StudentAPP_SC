package com.am_student_app.tflite

import android.graphics.Bitmap
import android.graphics.Color
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

object ImageEnhancer {

    /**
     * Analyzes lighting conditions and enhances bitmap for face embedding extraction.
     * Returns an enhanced 112x112 Bitmap optimized for MobileFaceNet input.
     */
    fun enhanceFaceBitmap(bitmap: Bitmap): Bitmap {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)

        // 1. Calculate luminance metrics
        var totalLuminance = 0.0
        var highlightCount = 0
        val totalPixels = pixels.size

        for (pixel in pixels) {
            val r = (pixel shr 16) and 0xFF
            val g = (pixel shr 8) and 0xFF
            val b = pixel and 0xFF
            val lum = 0.299 * r + 0.587 * g + 0.114 * b
            totalLuminance += lum
            if (lum > 220) highlightCount++
        }

        val avgLuminance = totalLuminance / totalPixels
        val highlightRatio = highlightCount.toDouble() / totalPixels

        // Determine enhancement strategy
        val isLowLight = avgLuminance < 55.0
        val isOverexposed = highlightRatio > 0.15 || avgLuminance > 200.0

        val enhancedPixels = IntArray(totalPixels)

        // Build lookup table for fast execution
        val lut = IntArray(256)
        for (i in 0..255) {
            var v = i.toDouble()

            if (isLowLight) {
                // Adaptive low-light boost using S-curve & linear gain
                v = Math.pow(v / 255.0, 0.75) * 255.0 * 1.25
            } else if (isOverexposed) {
                // Tone mapping / highlight compression for backlight
                v = Math.pow(v / 255.0, 1.4) * 255.0
            } else {
                // Standard contrast stretch (CLAHE light approximation)
                v = ((v - 127.5) * 1.15) + 127.5
            }

            lut[i] = max(0, min(255, v.toInt()))
        }

        // Apply lookup table to all channels
        for (i in 0 until totalPixels) {
            val pixel = pixels[i]
            val a = (pixel shr 24) and 0xFF
            val r = lut[(pixel shr 16) and 0xFF]
            val g = lut[(pixel shr 8) and 0xFF]
            val b = lut[pixel and 0xFF]
            enhancedPixels[i] = (a shl 24) or (r shl 16) or (g shl 8) or b
        }

        val enhanced = Bitmap.createBitmap(width, height, bitmap.config)
        enhanced.setPixels(enhancedPixels, 0, width, 0, 0, width, height)

        // Resize to 112x112 for MobileFaceNet
        return if (width != 112 || height != 112) {
            Bitmap.createScaledBitmap(enhanced, 112, 112, true)
        } else {
            enhanced
        }
    }
}
