import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;

// React Native uses process.env (NOT import.meta.env which is Vite/web-only).
// Set these via react-native-config or replace with your actual credentials.
const SUPABASE_URL = 'https://gduxlotlifugsvdcopep.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_LndCahcsg_FSYeoSmdgoAw_uuz2OxLT';

export const getSupabase = (): SupabaseClient => {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn(
      'Supabase credentials (SUPABASE_URL, SUPABASE_ANON_KEY) are missing.',
    );

    // Return a proxy that throws a descriptive error when any method is called
    return new Proxy({} as SupabaseClient, {
      get: (_target, prop) => {
        if (typeof prop === 'symbol') {
          return undefined;
        }

        return (..._args: any[]) => {
          throw new Error(
            `Supabase credentials are missing. Cannot call method "${String(
              prop,
            )}". ` +
              'Please set SUPABASE_URL and SUPABASE_ANON_KEY in your environment variables.',
          );
        };
      },
    });
  }

  try {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return supabaseInstance;
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
    throw error;
  }
};

// Export a proxy for the 'supabase' object to maintain backward compatibility
export const supabase = new Proxy({} as SupabaseClient, {
  get: (_target, prop) => {
    const client = getSupabase();
    const value = (client as any)[prop];

    // If it's a function, bind it to the client
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});
