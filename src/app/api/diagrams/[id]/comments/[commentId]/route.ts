import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; commentId: string } }
) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: comment } = await supabase
    .from('comments')
    .select('user_id')
    .eq('id', params.commentId)
    .single()

  if (!comment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (comment.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const update: Record<string, unknown> = {}

  if (typeof body.content === 'string' && body.content.trim()) {
    const content = body.content.trim()
    if (content.length > 4000) {
      return NextResponse.json({ error: 'Comment is too long' }, { status: 400 })
    }
    update.content = content
  }

  if (typeof body.resolved === 'boolean') {
    update.resolved = body.resolved
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('comments')
    .update(update)
    .eq('id', params.commentId)
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

  return NextResponse.json(data)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; commentId: string } }
) {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: comment } = await supabase
    .from('comments')
    .select('user_id')
    .eq('id', params.commentId)
    .single()

  if (!comment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (comment.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await supabase
    .from('comments')
    .delete()
    .eq('id', params.commentId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}