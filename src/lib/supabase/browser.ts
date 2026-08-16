// Supabase Browser Client
// Use in client components only

import { createBrowserClient } from '@supabase/ssr'

export const createClient = () => {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Singleton for client-side usage
let browserClient: ReturnType<typeof createClient> | null = null

export const getBrowserClient = () => {
  if (!browserClient) {
    browserClient = createClient()
  }
  return browserClient
}