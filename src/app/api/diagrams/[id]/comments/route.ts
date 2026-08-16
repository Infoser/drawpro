import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

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
    .select('owner_id, is_public')
    .eq('id', params.id)
    .single()

  if (!diagram) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const isOwner = diagram.owner_id === user.id
  const isPublic = diagram.is_public
  const { data: collab } = await supabase
    .from('diagram_collaborators')
    .select('user_id')
    .eq('diagram_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!isOwner && !isPublic && !collab) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('comments')
    .select(`
      id,
      diagram_id,
      user_id,
      node_id,
      content,
      resolved,
      created_at,
      updated_at,
      profile:profiles!comments_user_id_fkey(username, avatar_url)
    `)
    .eq('diagram_id', params.id)
    .order('created_at', { ascending: false })

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
  const { data: collab } = await supabase
    .from('diagram_collaborators')
    .select('role')
    .eq('diagram_id', params.id)
    .eq('user_id', user.id)
    .single()

  const canComment = isOwner || (collab && ['owner', 'editor', 'commenter'].includes(collab.role))

  if (!canComment) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const nodeId = typeof body.node_id === 'string' ? body.node_id : null

  if (!content) {
    return NextResponse.json({ error: 'Comment cannot be empty' }, { status: 400 })
  }

  if (content.length > 4000) {
    return NextResponse.json({ error: 'Comment is too long' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('comments')
    .insert({
      diagram_id: params.id,
      user_id: user.id,
      node_id: nodeId,
      content,
    })
    .select(`
      id,
      diagram_id,
      user_id,
      node_id,
      content,
      resolved,
      created_at,
      updated_at,
      profile:profiles!comments_user_id_fkey(username, avatar_url)
    `)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}