import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  Image,
  KeyboardAvoidingView,
  Platform,
  Modal,
  StatusBar,
} from 'react-native';
import {
  Camera,
  useCameraDevices,
  useCameraFormat,
} from 'react-native-vision-camera';
import { supabase } from '../services/supabaseClient';
import { averageEmbeddings } from '../facerecg/faceCompare';
import { NativeModules } from 'react-native';

const { TFLiteModule } = NativeModules;

// ─── Theme (Professional Minimal Light Mode) ──────────────────────────────────
const ACCENT = '#DC2626'; // Professional Crimson Red
const BG = '#F8FAFC'; // Clean Light Slate
const CARD_BG = '#FFFFFF'; // Pure White Card Surface
const BORDER = '#E2E8F0'; // Subtle Light Border
const TEXT_PRIMARY = '#0F172A'; // Deep Slate Text
const TEXT_SECONDARY = '#64748B'; // Muted Slate

interface RegisterScreenProps {
  onBack: () => void;
}

export default function RegisterScreen({ onBack }: RegisterScreenProps) {
  // Form State
  const [studentUid, setStudentUid] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [name, setName] = useState('');
  const [course, setCourse] = useState('BTech');
  const [branch, setBranch] = useState('CSE');
  const [semester, setSemester] = useState('1');
  const [section, setSection] = useState('A');

  // Camera & Image State
  const [hasCameraPermission, setHasCameraPermission] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [capturedPhotos, setCapturedPhotos] = useState<string[]>([]);
  const [isCapturingFrames, setIsCapturingFrames] = useState(false);

  // Status State
  const [isRegistering, setIsRegistering] = useState(false);

  const cameraRef = useRef<Camera>(null);
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

  // Request permissions on mount
  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasCameraPermission(status === 'granted');
    })();
  }, []);

  // Multi-Frame Capture Photo (Captures 3 rapid frames for rock-solid biometric enrolment)
  const handleCapture = async () => {
    if (!cameraRef.current) {
      Alert.alert('Camera Error', 'Camera not ready.');
      return;
    }
    setIsCapturingFrames(true);
    const photos: string[] = [];
    try {
      for (let i = 0; i < 3; i++) {
        const photo = await cameraRef.current.takePhoto({
          flash: 'off',
          enableShutterSound: false,
        });
        photos.push(photo.path);
        if (i < 2) {
          await new Promise(r => setTimeout(r, 150));
        }
      }

      setCapturedPhotos(photos);
      setCapturedPhoto(photos[0]);
      setShowCamera(false);
    } catch (e: any) {
      Alert.alert('Capture Failed', e.message || 'Failed to capture photo.');
    } finally {
      setIsCapturingFrames(false);
    }
  };

  // Submit Registration
  const handleSubmit = async () => {
    // Validate inputs
    if (!studentUid.trim()) {
      return Alert.alert('Validation Error', 'Student UID is required.');
    }
    if (!rollNumber.trim()) {
      return Alert.alert('Validation Error', 'Roll Number is required.');
    }
    if (!name.trim()) {
      return Alert.alert('Validation Error', 'Full Name is required.');
    }
    if (capturedPhotos.length === 0 && !capturedPhoto) {
      return Alert.alert(
        'Validation Error',
        'Face photo is required. Please capture photo.',
      );
    }

    const parsedSem = parseInt(semester, 10);
    if (isNaN(parsedSem)) {
      return Alert.alert(
        'Validation Error',
        'Semester must be a valid number.',
      );
    }

    setIsRegistering(true);

    const targetPaths =
      capturedPhotos.length > 0 ? capturedPhotos : [capturedPhoto!];
    const extractedEmbeddings: number[][] = [];

    try {
      console.log(
        `[RegisterScreen] Extracting multi-frame embeddings across ${targetPaths.length} captures...`,
      );

      for (const rawPath of targetPaths) {
        const photoPath = rawPath.startsWith('file://')
          ? rawPath.slice(7)
          : rawPath;
        try {
          const res = await TFLiteModule.recognizeFaceFromFile(photoPath);
          if (
            res.embedding &&
            Array.isArray(res.embedding) &&
            res.embedding.length > 0
          ) {
            extractedEmbeddings.push(res.embedding);
          }
        } catch (e) {
          console.warn(
            '[RegisterScreen] Frame embedding extraction skipped frame:',
            e,
          );
        }
      }

      if (extractedEmbeddings.length === 0) {
        throw new Error(
          'Could not extract face biometrics. Please re-take the photo ensuring your face is clearly visible.',
        );
      }

      // Compute multi-frame averaged master embedding vector & store multi-template array
      const finalEmbedding = averageEmbeddings(extractedEmbeddings);
      const embeddingTemplates = [finalEmbedding, ...extractedEmbeddings];

      // 2. Insert/Upsert into Supabase students table
      console.log('[RegisterScreen] Upserting master embedding to Supabase...');
      const { error } = await supabase.from('students').upsert(
        {
          student_uid: studentUid.trim(),
          roll_number: rollNumber.trim(),
          name: name.trim(),
          course: course.trim(),
          branch: branch.trim(),
          semester: parsedSem,
          section: section.trim(),
          face_embedding: embeddingTemplates,
        },
        { onConflict: 'student_uid' },
      );

      if (error) {
        throw new Error(`Supabase error ${error.code ?? ''}: ${error.message}`);
      }

      // 3. Update local cache immediately so the student can verify instantly
      try {
        const { storageService } = require('../services/storageService');
        const currentCache =
          storageService.getObject('studentEmbeddings') || {};
        currentCache[studentUid.trim()] = {
          name: name.trim(),
          embedding: embeddingTemplates,
        };
        storageService.setObject('studentEmbeddings', currentCache);
      } catch (_) {}

      Alert.alert('Success', `Student '${name}' registered successfully!`, [
        { text: 'OK', onPress: onBack },
      ]);
    } catch (err: any) {
      console.error('[RegisterScreen] Registration failed:', err);
      Alert.alert('Registration Failed', err.message || 'An error occurred.');
    } finally {
      setIsRegistering(false);
      // Clean up temp photo files
      for (const p of targetPaths) {
        try {
          const cleanP = p.startsWith('file://') ? p.slice(7) : p;
          const RNFS = require('react-native-fs').default;
          RNFS.unlink(cleanP).catch(() => {});
        } catch (_) {}
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Student Registration</Text>
          <Text style={styles.subtitle}>
            Create profile and enroll biometric face embedding
          </Text>
        </View>

        {showCamera ? (
          /* Camera View */
          <View style={styles.cameraContainer}>
            {!hasCameraPermission ? (
              <Text style={styles.errorText}>
                Camera permission not granted.
              </Text>
            ) : !device ? (
              <View style={{ alignItems: 'center', marginVertical: 30 }}>
                <ActivityIndicator size="large" color={ACCENT} />
                <Text
                  style={[
                    styles.errorText,
                    { marginTop: 10, color: TEXT_SECONDARY },
                  ]}
                >
                  Initializing Camera...
                </Text>
              </View>
            ) : (
              <View style={styles.cameraFrame}>
                <Camera
                  style={StyleSheet.absoluteFill}
                  ref={cameraRef}
                  device={device}
                  format={format}
                  isActive={true}
                  photo={true}
                  resizeMode="cover"
                />
                <View style={styles.cameraOverlay}>
                  <Text style={styles.cameraGuideText}>
                    {isCapturingFrames
                      ? '📸 Enrolling Biometric Frames...'
                      : 'Center face in the frame'}
                  </Text>
                </View>
              </View>
            )}
            <View style={styles.cameraControls}>
              <TouchableOpacity
                style={[
                  styles.captureBtn,
                  isCapturingFrames && styles.btnDisabled,
                ]}
                onPress={handleCapture}
                disabled={isCapturingFrames}
              >
                <View style={styles.captureBtnInner} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelCameraBtn}
                onPress={() => setShowCamera(false)}
              >
                <Text style={styles.cancelCameraText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* Form & Photo Selector View */
          <View style={styles.formContainer}>
            {/* Photo Capture Section */}
            <View style={styles.photoSection}>
              {capturedPhoto ? (
                <View style={styles.photoPreviewContainer}>
                  <Image
                    source={{ uri: `file://${capturedPhoto}` }}
                    style={styles.photoPreview}
                  />
                  <TouchableOpacity
                    style={styles.recaptureBtn}
                    onPress={() => setShowGuideModal(true)}
                  >
                    <Text style={styles.recaptureText}>Retake Photo</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.captureTrigger}
                  onPress={() => setShowGuideModal(true)}
                >
                  <Text style={styles.captureTriggerIcon}>📸</Text>
                  <Text style={styles.captureTriggerText}>
                    Capture Face Biometrics
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Inputs */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Student UID / DB Key</Text>
              <TextInput
                style={styles.input}
                value={studentUid}
                onChangeText={setStudentUid}
                placeholder="e.g. 21006"
                placeholderTextColor="#666"
                keyboardType="numeric"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Roll Number</Text>
              <TextInput
                style={styles.input}
                value={rollNumber}
                onChangeText={setRollNumber}
                placeholder="e.g. 23L31A4465"
                placeholderTextColor="#666"
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Full Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Nitish Kumar"
                placeholderTextColor="#666"
              />
            </View>

            {/* Row fields */}
            <View style={styles.row}>
              <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.inputLabel}>Course</Text>
                <TextInput
                  style={styles.input}
                  value={course}
                  onChangeText={setCourse}
                  placeholder="e.g. BTech"
                  placeholderTextColor="#666"
                />
              </View>

              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Branch</Text>
                <TextInput
                  style={styles.input}
                  value={branch}
                  onChangeText={setBranch}
                  placeholder="e.g. CSE"
                  placeholderTextColor="#666"
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.inputLabel}>Semester</Text>
                <TextInput
                  style={styles.input}
                  value={semester}
                  onChangeText={setSemester}
                  placeholder="e.g. 1"
                  placeholderTextColor="#666"
                  keyboardType="numeric"
                />
              </View>

              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Section</Text>
                <TextInput
                  style={styles.input}
                  value={section}
                  onChangeText={setSection}
                  placeholder="e.g. A"
                  placeholderTextColor="#666"
                  autoCapitalize="characters"
                />
              </View>
            </View>

            {/* Buttons */}
            <TouchableOpacity
              style={[styles.submitBtn, isRegistering && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={isRegistering}
            >
              {isRegistering ? (
                <ActivityIndicator color="#1C1C1E" />
              ) : (
                <Text style={styles.submitBtnText}>Submit Registration</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.backBtn}
              onPress={onBack}
              disabled={isRegistering}
            >
              <Text style={styles.backBtnText}>Back to Login</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Face Registration Guidelines Popup Modal */}
      <Modal
        visible={showGuideModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowGuideModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalHeaderTitle}>
              📸 Face Enrolment Guidelines
            </Text>
            <Text style={styles.modalHeaderSubtitle}>
              Please follow these conditions for 100% accurate biometric
              enrolment:
            </Text>

            <View style={styles.guideRow}>
              <Text style={styles.guideIcon}>💡</Text>
              <View style={styles.guideTextCol}>
                <Text style={styles.guideTitle}>Good Lighting</Text>
                <Text style={styles.guideDesc}>
                  Face must be well-lit. Avoid strong background glare or dark
                  shadows.
                </Text>
              </View>
            </View>

            <View style={styles.guideRow}>
              <Text style={styles.guideIcon}>👤</Text>
              <View style={styles.guideTextCol}>
                <Text style={styles.guideTitle}>Center & Upright</Text>
                <Text style={styles.guideDesc}>
                  Look straight into the camera lens with your head held
                  upright.
                </Text>
              </View>
            </View>

            <View style={styles.guideRow}>
              <Text style={styles.guideIcon}>🕶️</Text>
              <View style={styles.guideTextCol}>
                <Text style={styles.guideTitle}>Unobstructed Face</Text>
                <Text style={styles.guideDesc}>
                  Remove face masks, dark sunglasses, or heavy face coverings.
                </Text>
              </View>
            </View>

            <View style={styles.guideRow}>
              <Text style={styles.guideIcon}>😐</Text>
              <View style={styles.guideTextCol}>
                <Text style={styles.guideTitle}>Hold Still for 3 Frames</Text>
                <Text style={styles.guideDesc}>
                  Keep a steady neutral expression while 3 biometric frames are
                  captured.
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.modalStartBtn}
              onPress={() => {
                setShowGuideModal(false);
                setShowCamera(true);
              }}
            >
              <Text style={styles.modalStartBtnText}>
                I'm Ready — Open Camera
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => setShowGuideModal(false)}
            >
              <Text style={styles.modalCancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  scrollContainer: {
    padding: 24,
    paddingBottom: 60,
  },
  header: {
    marginTop: 40,
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    color: TEXT_PRIMARY,
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 13,
    color: TEXT_SECONDARY,
    marginTop: 6,
  },
  cameraContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  cameraFrame: {
    width: 280,
    height: 280,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: TEXT_PRIMARY,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 16,
  },
  cameraGuideText: {
    color: '#FFFFFF',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 'bold',
  },
  cameraControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    width: '100%',
    justifyContent: 'center',
  },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: ACCENT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureBtnInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: ACCENT,
  },
  cancelCameraBtn: {
    position: 'absolute',
    right: 20,
  },
  cancelCameraText: {
    color: TEXT_SECONDARY,
    fontSize: 15,
    fontWeight: 'bold',
  },
  formContainer: {
    width: '100%',
  },
  photoSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  captureTrigger: {
    width: '100%',
    height: 120,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: CARD_BG,
    justifyContent: 'center',
    alignItems: 'center',
    borderStyle: 'dashed',
  },
  captureTriggerIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  captureTriggerText: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: 'bold',
  },
  photoPreviewContainer: {
    alignItems: 'center',
    width: '100%',
  },
  photoPreview: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 3,
    borderColor: ACCENT,
  },
  recaptureBtn: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: '#E2E8F0',
  },
  recaptureText: {
    color: TEXT_PRIMARY,
    fontSize: 13,
    fontWeight: 'bold',
  },
  inputGroup: {
    marginBottom: 16,
    width: '100%',
  },
  inputLabel: {
    color: TEXT_SECONDARY,
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    color: TEXT_PRIMARY,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    fontWeight: '500',
  },
  row: {
    flexDirection: 'row',
    width: '100%',
  },
  submitBtn: {
    backgroundColor: ACCENT,
    width: '100%',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  backBtn: {
    width: '100%',
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  backBtnText: {
    color: TEXT_SECONDARY,
    fontSize: 14,
    fontWeight: 'bold',
  },
  errorText: {
    color: ACCENT,
    textAlign: 'center',
    padding: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: CARD_BG,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 24,
    elevation: 8,
  },
  modalHeaderTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: TEXT_PRIMARY,
    textAlign: 'center',
    marginBottom: 6,
  },
  modalHeaderSubtitle: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 16,
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  guideIcon: {
    fontSize: 22,
    marginRight: 14,
    marginTop: 2,
  },
  guideTextCol: {
    flex: 1,
  },
  guideTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: TEXT_PRIMARY,
    marginBottom: 2,
  },
  guideDesc: {
    fontSize: 11,
    color: TEXT_SECONDARY,
    lineHeight: 15,
  },
  modalStartBtn: {
    backgroundColor: ACCENT,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  modalStartBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  modalCancelBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  modalCancelBtnText: {
    color: TEXT_SECONDARY,
    fontSize: 13,
    fontWeight: 'bold',
  },
});
