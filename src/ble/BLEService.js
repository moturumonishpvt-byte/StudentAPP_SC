/**
 * BLEService.js - AM_Student
 *
 * Core BLE service singleton for the student (central/client) role.
 * Wraps the react-native-ble-plx BleManager.
 *
 * Source reference: ble v2 / example / src / services / BLEService / BLEService.ts
 * Adapted for AM_Student (JavaScript, no Toast, student-centric permissions).
 *
 * The student device acts exclusively as a BLE CENTRAL (client):
 *   scan → connect → discover services → write JOIN → monitor for OTP → write OTP_VERIFY
 */

import {
  BleManager,
  BleErrorCode,
  State as BluetoothState,
  LogLevel,
} from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';
import { Buffer } from 'buffer';

const TAG = '[AM_Student][BLEService]';

class BLEServiceInstance {
  /** @type {BleManager} */
  manager;

  /** @type {import('react-native-ble-plx').Device | null} */
  device = null;

  /** @type {import('react-native-ble-plx').Subscription | null} */
  characteristicMonitor = null;

  isCharacteristicMonitorDisconnectExpected = false;

  constructor() {
    this.manager = new BleManager();
    this.manager.setLogLevel(LogLevel.Error);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Wait for Bluetooth to become PoweredOn.
   * @returns {Promise<void>}
   */
  initializeBLE = () =>
    new Promise((resolve, reject) => {
      const subscription = this.manager.onStateChange(state => {
        switch (state) {
          case BluetoothState.Unsupported:
            subscription.remove();
            reject(new Error('Bluetooth is not supported on this device'));
            break;

          case BluetoothState.PoweredOff:
            console.warn(TAG, 'Bluetooth is powered off');
            this.manager.enable().catch(err => {
              if (err.errorCode === BleErrorCode.BluetoothUnauthorized) {
                this.requestBluetoothPermission();
              }
            });
            break;

          case BluetoothState.Unauthorized:
            this.requestBluetoothPermission();
            break;

          case BluetoothState.PoweredOn:
            subscription.remove();
            resolve();
            break;

          default:
            console.warn(TAG, 'Unhandled BLE state:', state);
        }
      }, true);
    });

  /** Clean up the BLE manager. */
  destroy = async () => {
    this.stopDeviceScan();
    this.finishMonitor();
    if (this.device) {
      try {
        await this.manager.cancelDeviceConnection(this.device.id);
      } catch (_) {}
      this.device = null;
    }
    await this.manager.destroy();
  };

  // ─── Scanning ───────────────────────────────────────────────────────────────

  /**
   * Starts BLE scanning.  Calls onDeviceFound for every matching advertisement.
   *
   * @param {(device: import('react-native-ble-plx').Device) => void} onDeviceFound
   * @param {string[] | null} UUIDs  Service UUIDs to filter (null = all)
   * @param {boolean} [legacyScan]
   */
  scanDevices = (onDeviceFound, UUIDs = null, allowDuplicates = false) => {
    this.manager
      .startDeviceScan(UUIDs, { allowDuplicates }, (error, device) => {
        if (error) {
          console.error(TAG, 'Scan error:', error.message);
          this.manager.stopDeviceScan();
          return;
        }
        if (device) {
          onDeviceFound(device);
        }
      })
      .catch(e => console.error(TAG, 'startDeviceScan threw:', e));
  };

  stopDeviceScan = () => {
    this.manager.stopDeviceScan();
  };

  // ─── Connection ─────────────────────────────────────────────────────────────

  /**
   * Connect to the faculty device.
   * @param {string} deviceId
   * @param {number} [timeout]
   * @returns {Promise<import('react-native-ble-plx').Device>}
   */
  connectToDevice = (deviceId, timeout = 10000) =>
    new Promise((resolve, reject) => {
      this.stopDeviceScan();
      this.manager
        .connectToDevice(deviceId, { timeout })
        .then(async device => {
          this.device = device;
          if (Platform.OS === 'android') {
            try {
              await this.manager.requestMTUForDevice(device.id, 512);
            } catch (e) {
              console.warn(TAG, 'Failed to request MTU:', e.message);
            }
            try {
              // 1 = High Priority (mitigates 2.4GHz WiFi interference)
              await this.manager.requestConnectionPriorityForDevice(
                device.id,
                1,
              );
            } catch (e) {
              console.warn(TAG, 'Failed to request Priority:', e.message);
            }
          }
          resolve(device);
        })
        .catch(error => {
          if (
            error.errorCode === BleErrorCode.DeviceAlreadyConnected &&
            this.device
          ) {
            resolve(this.device);
          } else {
            console.error(TAG, 'connectToDevice error:', error.message);
            reject(error);
          }
        });
    });

  /**
   * Disconnect from the faculty device.
   * @param {string} [deviceId]
   */
  disconnectDevice = async deviceId => {
    const id = deviceId ?? this.device?.id;
    if (!id) {
      return;
    }
    try {
      await this.manager.cancelDeviceConnection(id);
    } catch (error) {
      if (error?.errorCode !== BleErrorCode.DeviceDisconnected) {
        console.error(TAG, 'disconnect error:', error.message);
      }
    }
    if (!deviceId || deviceId === this.device?.id) {
      this.device = null;
    }
  };

  // ─── Service Discovery ──────────────────────────────────────────────────────

  discoverAllServicesAndCharacteristics = () =>
    new Promise((resolve, reject) => {
      if (!this.device) {
        reject(new Error('Device is not connected'));
        return;
      }
      this.manager
        .discoverAllServicesAndCharacteristicsForDevice(this.device.id)
        .then(device => {
          this.device = device;
          resolve(device);
        })
        .catch(error => {
          console.error(TAG, 'discover error:', error.message);
          reject(error);
        });
    });

  // ─── Characteristic I/O ─────────────────────────────────────────────────────

  /**
   * Write a UTF-8 string to a characteristic (with response).
   * @param {string} serviceUUID
   * @param {string} characteristicUUID
   * @param {string} message
   */
  writeCharacteristic = (serviceUUID, characteristicUUID, message) => {
    if (!this.device) {
      throw new Error('Device is not connected');
    }
    const base64Value = Buffer.from(message, 'utf8').toString('base64');
    return this.manager.writeCharacteristicWithResponseForDevice(
      this.device.id,
      serviceUUID,
      characteristicUUID,
      base64Value,
    );
  };

  /**
   * Write without response (faster, suitable for JOIN / OTP_VERIFY).
   */
  writeCharacteristicWithoutResponse = (
    serviceUUID,
    characteristicUUID,
    message,
  ) => {
    if (!this.device) {
      throw new Error('Device is not connected');
    }
    const base64Value = Buffer.from(message, 'utf8').toString('base64');
    return this.manager.writeCharacteristicWithoutResponseForDevice(
      this.device.id,
      serviceUUID,
      characteristicUUID,
      base64Value,
    );
  };

  /**
   * Monitor (notify) a characteristic and decode incoming messages as UTF-8.
   * @param {string} serviceUUID
   * @param {string} characteristicUUID
   * @param {(message: string) => void} onMessage
   * @param {(error: Error) => void} onError
   * @param {string} [transactionId]
   */
  setupMonitor = (
    serviceUUID,
    characteristicUUID,
    onMessage,
    onError,
    transactionId,
  ) => {
    if (!this.device) {
      throw new Error('Device is not connected');
    }

    this.characteristicMonitor = this.manager.monitorCharacteristicForDevice(
      this.device.id,
      serviceUUID,
      characteristicUUID,
      (error, characteristic) => {
        if (error) {
          if (
            error.errorCode === 2 &&
            this.isCharacteristicMonitorDisconnectExpected
          ) {
            this.isCharacteristicMonitorDisconnectExpected = false;
            return;
          }
          onError(error);
          return;
        }
        if (characteristic?.value) {
          const decoded = Buffer.from(characteristic.value, 'base64').toString(
            'utf8',
          );
          onMessage(decoded);
        }
      },
      transactionId,
    );
  };

  finishMonitor = () => {
    this.isCharacteristicMonitorDisconnectExpected = true;
    this.characteristicMonitor?.remove();
    this.characteristicMonitor = null;
  };

  // ─── Device Events ──────────────────────────────────────────────────────────

  onDeviceDisconnected = listener => {
    if (!this.device) {
      throw new Error('Device is not connected');
    }
    return this.manager.onDeviceDisconnected(this.device.id, listener);
  };

  isDeviceConnected = () => {
    if (!this.device) {
      return Promise.resolve(false);
    }
    return this.manager.isDeviceConnected(this.device.id).catch(() => false);
  };

  // ─── Permissions ────────────────────────────────────────────────────────────

  requestBluetoothPermission = async () => {
    if (Platform.OS === 'ios') {
      return true;
    }

    if (Platform.OS === 'android') {
      const apiLevel = parseInt(Platform.Version.toString(), 10);

      if (
        apiLevel < 31 &&
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      ) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }

      if (
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN &&
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
      ) {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);
        return (
          result['android.permission.BLUETOOTH_CONNECT'] ===
            PermissionsAndroid.RESULTS.GRANTED &&
          result['android.permission.BLUETOOTH_SCAN'] ===
            PermissionsAndroid.RESULTS.GRANTED
        );
      }
    }

    console.warn(TAG, 'Bluetooth permissions not granted');
    return false;
  };

  getState = () => this.manager.state().catch(console.error);
}

export const BLEService = new BLEServiceInstance();
