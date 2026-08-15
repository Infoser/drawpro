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

  // Check diagram access first
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
    .from('diagram_versions')
    .select('*')
    .eq('diagram_id', params.id)
    .order('version', { ascending: false })

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

  // Check edit permission
  const { data: diagram } = await supabase
    .from('diagrams')
    .select('owner_id, is_public')
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

  const canEdit = isOwner || (collab && ['owner', 'editor'].includes(collab.role))

  if (!canEdit) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { nodes, edges, viewport } = body

  // Get latest version number
  const { data: latestVersion } = await supabase
    .from('diagram_versions')
    .select('version')
    .eq('diagram_id', params.id)
    .order('version', { ascending: false })
    .limit(1)
    .single()

  const nextVersion = (latestVersion?.version || 0) + 1

  const { data, error } = await supabase
    .from('diagram_versions')
    .insert({
      diagram_id: params.id,
      version: nextVersion,
      nodes,
      edges,
      viewport,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Update diagram updated_at
  await supabase
    .from('diagrams')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', params.id)

  return NextResponse.json(data, { status: 201 })
}