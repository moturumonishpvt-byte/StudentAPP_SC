/**
 * AuthContext.js - AM_Student
 *
 * Lightweight authentication context for the Student app.
 *
 * Shape of a student user object:
 *  {
 *    uid:         string   — unique student ID from your platform/database
 *    name:        string   — full name  (e.g. "Ravi Kumar")
 *    rollNo:      string   — roll number (optional, for display)
 *    branch:      string   — branch (optional)
 *    semester:    string   — current semester (optional)
 *    avatarUrl:   string   — profile image URL (optional)
 *  }
 *
 * ─────────────────────────────────────────────────────────────────
 *  HOW TO INTEGRATE WITH YOUR PLATFORM:
 *
 *  Option A — Supabase:
 *    const { data: { user } } = await supabase.auth.getUser();
 *    // fetch from your 'students' table using user.id
 *    setStudentUser({ uid: user.id, name: profile.full_name, ... });
 *
 *  Option B — Face recognition result:
 *    setStudentUser({ uid: identifiedStudent.id, name: identifiedStudent.name });
 *
 *  Option C — Any other session:
 *    setStudentUser(yourAuthResponse.student);
 * ─────────────────────────────────────────────────────────────────
 */

import React, { createContext, useContext, useState } from 'react';

const StudentAuthContext = createContext(null);

export function StudentAuthProvider({ children }) {
  const [studentUser, setStudentUser] = useState(null);
  return (
    <StudentAuthContext.Provider value={{ studentUser, setStudentUser }}>
      {children}
    </StudentAuthContext.Provider>
  );
}

export function useStudentAuth() {
  const ctx = useContext(StudentAuthContext);
  if (!ctx) {
    throw new Error('useStudentAuth must be inside <StudentAuthProvider>');
  }
  return ctx;
}
