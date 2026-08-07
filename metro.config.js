const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add custom asset extensions for TensorFlow Lite models
config.resolver.assetExts.push('tflite', 'bin');

// FIX: Disable node externals that crash on Windows with "node:sea" ENOENT error
config.resolver.unstable_externals = {};

module.exports = config;
