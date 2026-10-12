import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

// A module-level singleton, as in the golf app: building it inside a render lets StrictMode and
// discarded memos construct several clients sharing one storage key, which Supabase warns about.
let authClient: SupabaseClient | null = null
// Held separately so a fresh `getToken` from Clerk is used without rebuilding the client.
let latestGetToken: (() => Promise<string | null>) | null = null

/** The signed-in client, carrying the Clerk session token. Use it only for a user's own rows. */
export const createSupabaseClient = (getToken: () => Promise<string | null>): SupabaseClient | null => {
  if (!supabaseConfigured) return null
  latestGetToken = getToken
  if (!authClient) {
    authClient = createClient(supabaseUrl, supabaseAnonKey, {
      accessToken: () => (latestGetToken ? latestGetToken() : Promise.resolve(null)),
    })
  }
  return authClient
}
