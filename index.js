/**
 * @format
 *
 * Global polyfills — must be first, before any other imports.
 * Hermes (React Native's JS engine) is NOT Node.js and does NOT provide
 * Buffer, process, atob/btoa, or a full URL implementation.
 *
 * react-native-url-polyfill MUST be first — Supabase uses URL.protocol,
 * URLSearchParams, etc. internally. Without this, every Supabase call
 * throws "URL.protocol is not implemented".
 */
import 'react-native-url-polyfill/auto';

import { Buffer } from 'buffer';
global.Buffer = Buffer;

import { AppRegistry } from 'react-native';
import App from './App';

AppRegistry.registerComponent('am-student-app', () => App);
