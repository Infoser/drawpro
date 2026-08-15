// Supabase Browser Client
// Use in client components only

import { createPagesBrowserClient } from '@supabase/auth-helpers-nextjs'

export const createClient = () => {
  return createPagesBrowserClient({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  })
}

// Singleton for client-side usage
let browserClient: ReturnType<typeof createClient> | null = null

export const getBrowserClient = () => {
  if (!browserClient) {
    browserClient = createClient()
  }
  return browserClient
}