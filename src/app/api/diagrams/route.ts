import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const filter = searchParams.get('filter') || 'all'
  const search = searchParams.get('search') || ''

  let query = supabase
    .from('diagrams')
    .select(`
      *,
      latest_version:diagram_versions!diagram_id(
        nodes,
        edges,
        viewport,
        created_at
      ),
      collaborators!diagram_id(user_id, role)
    `)
    .order('updated_at', { ascending: false })

  if (filter === 'owned') {
    query = query.eq('owner_id', user.id)
  } else if (filter === 'shared') {
    query = query
      .eq('is_public', false)
      .neq('owner_id', user.id)
  } else if (filter === 'public') {
    query = query.eq('is_public', true)
  }

  if (search) {
    query = query.ilike('title', `%${search}%`)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { title = 'Untitled Diagram' } = body

  const { data, error } = await supabase
    .from('diagrams')
    .insert({
      title,
      owner_id: user.id,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Create initial version
  await supabase
    .from('diagram_versions')
    .insert({
      diagram_id: data.id,
      version: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      created_by: user.id,
    })

  return NextResponse.json(data, { status: 201 })
}