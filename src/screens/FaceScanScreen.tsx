import React, { useEffect, useState, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
  StatusBar,
} from 'react-native';
import {
  Camera,
  useCameraDevices,
  useCameraFormat,
} from 'react-native-vision-camera';
import { useFaceRecognition } from '../hooks/useFaceRecognition';
import { studentService } from '../services/studentService';

/**
 * FaceScanScreen
 * Step 1 of the attendance flow: Face → BLE → OTP
 */
export default function FaceScanScreen({
  onLogin,
  onNavigateToRegister,
}: {
  onLogin: (student: any) => void;
  onNavigateToRegister: () => void;
}) {
  const [hasPermission, setHasPermission] = useState(false);
  const [isForceSyncing, setIsForceSyncing] = useState(false);

  // Universal camera hardware selection across all Android OEMs (Samsung, Xiaomi, Vivo, Oppo, RealMe, etc.)
  const devices = useCameraDevices();
  const device = useMemo(() => {
    if (!devices || devices.length === 0) {
      return undefined;
    }
    return (
      devices.find(d => d.position === 'front') ??
      devices.find(d => d.position === 'back') ??
      devices[0]
    );
  }, [devices]);

  const validDevice =
    device && Array.isArray(device.formats) && device.formats.length > 0
      ? device
      : undefined;
  const format = useCameraFormat(validDevice, [
    { photoResolution: { width: 640, height: 480 } },
    { videoResolution: { width: 640, height: 480 } },
    { fps: 30 },
  ]);

  const {
    cameraRef,
    isModelsLoaded,
    error,
    isScanning,
    setIsScanning,
    scanResult,
  } = useFaceRecognition();

  // Request camera and location/ble permissions sequentially on mount
  useEffect(() => {
    (async () => {
      try {
        const status = await Camera.requestCameraPermission();
        setHasPermission(status === 'granted');

        if (Platform.OS === 'android') {
          const { PermissionsAndroid } = require('react-native');
          const blePerms = [
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          ].filter(Boolean);
          if (blePerms.length > 0) {
            await PermissionsAndroid.requestMultiple(blePerms).catch(() => {});
          }
        }
      } catch (e) {
        console.warn('Permission request error:', e);
      }
    })();
  }, []);

  const handleForceSync = async () => {
    setIsForceSyncing(true);
    try {
      await studentService.forceFullSync();
    } catch (err: any) {
      console.log('Force sync failed:', err);
    } finally {
      setIsForceSyncing(false);
    }
  };

  // Transition on successful match
  useEffect(() => {
    if (scanResult?.success && scanResult.studentId) {
      const verifiedStudent = {
        uid: scanResult.studentId,
        name: scanResult.studentName || 'Verified Student',
        rollNo: scanResult.studentId,
        branch: 'Verified',
        semester: 'Verified',
      };
      setTimeout(() => onLogin(verifiedStudent), 1500);
    }
  }, [scanResult, onLogin]);

  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>
          Camera permission is required to verify identity.{'\n'}Please enable
          it in Settings.
        </Text>
        <TouchableOpacity
          style={[styles.button, { marginTop: 20, width: '70%' }]}
          onPress={() => Linking.openSettings()}
        >
          <Text style={styles.buttonText}>Open Settings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#E53935" />
        <Text style={[styles.text, { marginTop: 16 }]}>
          Initializing Camera...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
      <View style={styles.overlay}>
        <View style={styles.header}>
          <Text style={styles.title}>Identity Verification</Text>
          {error ? (
            <Text style={[styles.subtitle, styles.errorText]}>
              AI Error: {error}
            </Text>
          ) : !isModelsLoaded ? (
            <Text style={styles.subtitle}>Loading AI Models…</Text>
          ) : (
            <Text style={styles.subtitle}>
              Position your face in the centre
            </Text>
          )}
        </View>

        {/* Manual Force Sync (Escape Hatch) */}
        <TouchableOpacity
          style={styles.adminSyncBtn}
          onPress={handleForceSync}
          disabled={isForceSyncing}
        >
          <Text style={styles.adminSyncBtnText}>
            {isForceSyncing ? '🔄 Syncing...' : '🔄 Force Sync'}
          </Text>
        </TouchableOpacity>

        {/* Face framing box - NOW ISOLATES THE CAMERA FEED */}
        <View
          style={[
            styles.frameBox,
            scanResult?.success && styles.frameBoxSuccess,
            { overflow: 'hidden' },
          ]}
        >
          <Camera
            style={StyleSheet.absoluteFill}
            ref={cameraRef}
            device={device}
            format={format}
            isActive={!scanResult?.success}
            photo={true}
            resizeMode="cover"
          />
        </View>

        <View style={styles.footer}>
          {scanResult && (
            <View
              style={[
                styles.resultBox,
                scanResult.success ? styles.resultSuccess : styles.resultFail,
              ]}
            >
              <Text style={styles.resultText}>{scanResult.message}</Text>
            </View>
          )}

          {!scanResult?.success && (
            <View style={{ width: '100%' }}>
              <TouchableOpacity
                style={[
                  styles.button,
                  (!isModelsLoaded || isScanning) && styles.buttonDisabled,
                ]}
                disabled={!isModelsLoaded || isScanning}
                onPress={() => setIsScanning(true)}
              >
                {isScanning ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Start Scan</Text>
                )}
              </TouchableOpacity>

              {!isScanning && (
                <TouchableOpacity
                  style={styles.registerButton}
                  onPress={onNavigateToRegister}
                >
                  <Text style={styles.registerButtonText}>
                    Register New Student
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    padding: 24,
    zIndex: 10,
  },
  header: { alignItems: 'center', marginTop: 40 },
  title: {
    fontSize: 24,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: 1,
  },
  subtitle: { fontSize: 14, color: '#64748B', marginTop: 8 },
  errorText: { color: '#DC2626' },
  frameBox: {
    width: 250,
    height: 250,
    borderWidth: 3,
    borderColor: '#0F172A',
    borderRadius: 24,
    alignSelf: 'center',
    backgroundColor: '#E2E8F0',
  },
  frameBoxSuccess: { borderColor: '#059669', borderWidth: 4 },
  footer: { width: '100%', paddingBottom: 40, alignItems: 'center' },
  resultBox: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    width: '100%',
    alignItems: 'center',
  },
  resultSuccess: {
    backgroundColor: '#D1FAE5',
    borderWidth: 1,
    borderColor: '#059669',
  },
  resultFail: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#DC2626',
  },
  resultText: { color: '#0F172A', fontWeight: 'bold', fontSize: 14 },
  button: {
    backgroundColor: '#DC2626',
    width: '100%',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#94A3B8' },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  registerButton: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    width: '100%',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  registerButtonText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  adminSyncBtn: {
    marginTop: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  adminSyncBtnText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
  },
  text: { color: '#0F172A', textAlign: 'center', padding: 20, fontSize: 14 },
});
