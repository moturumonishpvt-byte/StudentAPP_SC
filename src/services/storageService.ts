import { MMKV } from 'react-native-mmkv';

// @ts-ignore - The IDE incorrectly identifies MMKV as only a type before the native modules are fully built.
const storageInstance = new MMKV();

export const storageService = {
  /**
   * Save a JSON object (like student profile or embeddings)
   */
  setObject: (key: string, value: any) => {
    try {
      storageInstance.set(key, JSON.stringify(value));
    } catch (e) {
      console.error(`Error saving ${key} to MMKV:`, e);
    }
  },

  /**
   * Retrieve a JSON object
   */
  getObject: (key: string): any | null => {
    try {
      const data = storageInstance.getString(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error(`Error reading ${key} from MMKV:`, e);
      return null;
    }
  },

  /**
   * Clear all local data (useful for logout)
   */
  clearAll: () => {
    storageInstance.clearAll();
  },
};
