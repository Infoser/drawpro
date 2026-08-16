import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const VALID_ROLES = ['editor', 'commenter', 'viewer']

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: diagram } = await supabase
    .from('diagrams')
    .select('owner_id')
    .eq('id', params.id)
    .single()

  if (!diagram) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const isOwner = diagram.owner_id === user.id

  const { data: mine } = await supabase
    .from('diagram_collaborators')
    .select('role')
    .eq('diagram_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!isOwner && !mine) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('diagram_collaborators')
    .select(`
      user_id,
      role,
      created_at,
      profile:profiles!diagram_collaborators_user_id_fkey(username, avatar_url)
    `)
    .eq('diagram_id', params.id)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: diagram } = await supabase
    .from('diagrams')
    .select('owner_id')
    .eq('id', params.id)
    .single()

  if (!diagram) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const isOwner = diagram.owner_id === user.id

  const { data: mine } = await supabase
    .from('diagram_collaborators')
    .select('role')
    .eq('diagram_id', params.id)
    .eq('user_id', user.id)
    .single()

  const canManage = isOwner || (mine && ['owner', 'editor'].includes(mine.role))

  if (!canManage) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { email, role = 'viewer' } = body

  if (!email || !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Invalid email or role' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username')
    .ilike('username', email)
    .maybeSingle()

  if (!profile) {
    return NextResponse.json({ error: 'No DrawPro account found for this email' }, { status: 404 })
  }

  if (profile.id === user.id) {
    return NextResponse.json({ error: 'You cannot share a diagram with yourself' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('diagram_collaborators')
    .insert({
      diagram_id: params.id,
      user_id: profile.id,
      role,
      invited_by: user.id,
    })
    .select(`
      user_id,
      role,
      created_at,
      profile:profiles!diagram_collaborators_user_id_fkey(username, avatar_url)
    `)
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'This user is already a collaborator' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: diagram } = await supabase
    .from('diagrams')
    .select('owner_id')
    .eq('id', params.id)
    .single()

  if (!diagram) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Only the owner can change roles
  if (diagram.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { user_id, role } = body

  if (!user_id || !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Invalid user or role' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('diagram_collaborators')
    .update({ role })
    .eq('diagram_id', params.id)
    .eq('user_id', user_id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const targetUserId = searchParams.get('user_id')

  if (!targetUserId) {
    return NextResponse.json({ error: 'Missing user_id' }, { status: 400 })
  }

  const { data: diagram } = await supabase
    .from('diagrams')
    .select('owner_id')
    .eq('id', params.id)
    .single()

  if (!diagram) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const isOwner = diagram.owner_id === user.id
  const isSelf = targetUserId === user.id

  // Owner can remove anyone; collaborators can remove themselves
  if (!isOwner && !isSelf) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await supabase
    .from('diagram_collaborators')
    .delete()
    .eq('diagram_id', params.id)
    .eq('user_id', targetUserId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}