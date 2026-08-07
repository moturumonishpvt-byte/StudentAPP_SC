/**
 * SecurityUtils.js - AM_Student
 * Simplified version: OTP only.
 */

import { MSG, RSSI_PROXIMITY_THRESHOLD } from './BLEConstants';

/**
 * Builds the JOIN message for the faculty app.
 * This sends the Student's Roll Number / ID.
 *
 * @param {string} rollNumber
 */
export function buildJoinMessage(rollNumber) {
  return `${MSG.JOIN_PREFIX}${rollNumber}`;
}

/**
 * Proximity check based on signal strength.
 * Returns true if the device is within a reliable classroom range.
 *
 * @param {number} rssi
 */
export function isDeviceCloseEnough(rssi) {
  if (rssi == null) {
    return false;
  }
  return rssi >= RSSI_PROXIMITY_THRESHOLD;
}

/**
 * Translates machine codes to human-friendly messages.
 */
export function friendlyRejectionMessage(code) {
  switch (code) {
    case 'DUPLICATE':
      return 'You have already joined this session.';
    case 'SESSION_CLOSED':
      return 'The attendance window is closed.';
    case 'MAX_ATTEMPTS':
      return 'Too many incorrect PIN attempts. Please contact your instructor.';
    case 'MANUAL':
      return 'Attendance manually updated by instructor.';
    default:
      return 'Connection rejected by faculty device.';
  }
}
