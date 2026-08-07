/**
 * BLEConstants.js - AM_Student
 *
 * Modified: Simplified version (OTP only)
 */

// ─── Service & Characteristic UUIDs ──────────────────────────────────────────
export const AM_SERVICE_UUID = '12345678-1234-1234-1234-1234567890ab';
export const FACULTY_TO_STUDENT_CHAR_UUID =
  '12345678-1234-1234-1234-1234567890ac';
export const STUDENT_TO_FACULTY_CHAR_UUID =
  '12345678-1234-1234-1234-1234567890ad';

// ─── BLE Scan ─────────────────────────────────────────────────────────────────
export const SCAN_DURATION_MS = 15_000;

/**
 * RSSI threshold for Layer 1 feedback.
 * -85 dBm is a reasonable "inside a classroom" signal strength.
 */
export const RSSI_PROXIMITY_THRESHOLD = -85;

// ─── Message Protocol ─────────────────────────────────────────────────────────
export const MSG = {
  // Student -> Faculty
  JOIN_PREFIX: 'JOIN:', // Format: JOIN:RollNumber
  OTP_VERIFY_PREFIX: 'OTP_VERIFY:',

  // Faculty -> Student
  OTP_REQUEST: 'OTP_REQUEST',
  OTP_PREFIX: 'OTP:', // Optional: if faculty sends OTP via BLE
  OTP_WRONG: 'OTP_WRONG',
  ATTENDANCE_CONFIRMED: 'ATTENDANCE_CONFIRMED',

  JOIN_REJECTED: 'JOIN_REJECTED:',
  REJECT_DUPLICATE: 'DUPLICATE',
  REJECT_CLOSED: 'SESSION_CLOSED',
  REJECT_MAX_ATTEMPTS: 'MAX_ATTEMPTS',
  REJECT_MANUAL: 'MANUAL',
};
