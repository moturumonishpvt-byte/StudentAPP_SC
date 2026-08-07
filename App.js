/**
 * App.js - AM_Student
 *
 * Root component for the Student application.
 *
 * Replace the placeholder login section with your real auth flow
 * (Supabase, face-recognition, JWT, etc.)
 *
 * Flow:
 *   App starts → Check if a student user is logged in
 *     → Not logged in: show LoginGate (plug in YOUR auth here)
 *     → Logged in: show AttendanceScreen with the student's real uid + name
 */

import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { StudentAuthProvider, useStudentAuth } from './src/auth/AuthContext';
import AttendanceScreen from './src/screens/AttendanceScreen';
import FaceScanScreen from './src/screens/FaceScanScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import { studentService } from './src/services/studentService';

export default function App() {
  return (
    <StudentAuthProvider>
      <AppContent />
    </StudentAuthProvider>
  );
}

function AppContent() {
  const { studentUser, setStudentUser } = useStudentAuth();
  const [currentScreen, setCurrentScreen] = React.useState('login'); // 'login' | 'register'

  // Heartbeat log to confirm JS is running on the device
  React.useEffect(() => {
    const interval = setInterval(() => {
      console.log(
        '[App] Heartbeat - JS Bridge is ALIVE. Time:',
        new Date().toLocaleTimeString(),
      );
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Background Sync Lifecycle
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    // Initial sync on cold start
    studentService.backgroundSyncEmbeddings();

    const subscription = AppState.addEventListener('change', nextAppState => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // App has come to the foreground
        studentService.backgroundSyncEmbeddings();
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // If the student identity is not verified yet, show either Scan or Register screen.
  if (!studentUser) {
    if (currentScreen === 'register') {
      return <RegisterScreen onBack={() => setCurrentScreen('login')} />;
    }
    return (
      <FaceScanScreen
        onLogin={setStudentUser}
        onNavigateToRegister={() => setCurrentScreen('register')}
      />
    );
  }

  return (
    /**
     * studentUser is the REAL student object verified by the Face Recognition module.
     * Their uid flows into the JOIN:<uid> message sent over BLE and into the attendance record.
     */
    <AttendanceScreen studentUser={studentUser} />
  );
}
