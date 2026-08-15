// Supabase Admin Client
// Use for admin operations (bypasses RLS)
// Only use in trusted server environments (API routes, server actions)

import { createClient } from '@supabase/supabase-js'

export const createAdminClient = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

// Singleton for admin operations
let adminClient: ReturnType<typeof createAdminClient> | null = null

export const getAdminClient = () => {
  if (!adminClient) {
    adminClient = createAdminClient()
  }
  return adminClient
}