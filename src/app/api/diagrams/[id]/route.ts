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

  const { data, error } = await supabase
    .from('diagrams')
    .select(`
      *,
      latest_version:diagram_versions!diagram_id(
        version,
        nodes,
        edges,
        viewport,
        created_at
      ),
      diagram_collaborators!diagram_id(user_id, role)
    `)
    .eq('id', params.id)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }

  if (data.latest_version && Array.isArray(data.latest_version)) {
    data.latest_version.sort((a: any, b: any) => b.version - a.version)
  }

  // Check access
  const isOwner = data.owner_id === user.id
  const isPublic = data.is_public
  const isCollaborator = data.diagram_collaborators?.some((c: any) => c.user_id === user.id)

  if (!isOwner && !isPublic && !isCollaborator) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json(data)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { title, is_public, thumbnail_url } = body

  const { data: diagram, error: fetchError } = await supabase
    .from('diagrams')
    .select('owner_id')
    .eq('id', params.id)
    .single()

  if (fetchError || !diagram) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Only owner can update metadata
  if (diagram.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('diagrams')
    .update({ title, is_public, thumbnail_url })
    .eq('id', params.id)
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

  const { data: diagram, error: fetchError } = await supabase
    .from('diagrams')
    .select('owner_id')
    .eq('id', params.id)
    .single()

  if (fetchError || !diagram) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Only owner can delete
  if (diagram.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await supabase
    .from('diagrams')
    .delete()
    .eq('id', params.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}