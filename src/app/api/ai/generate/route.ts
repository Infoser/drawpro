import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const NIM_API_KEY = process.env.NVIDIA_NIM_API_KEY
const NIM_BASE_URL = process.env.NVIDIA_NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1'
const NIM_MODEL = process.env.NVIDIA_NIM_MODEL || 'meta/llama-3.3-70b-instruct'

const SYSTEM_PROMPT = `You are a diagram generation engine. Convert the user's request into a flowchart.
Respond with ONLY a JSON object, no markdown, no commentary, in this exact shape:
{
  "nodes": [
    {"id": "n1", "label": "Start", "shape": "terminator|process|decision|input", "x": 0, "y": 0, "w": 120, "h": 60},
    ...
  ],
  "edges": [
    {"from": "n1", "to": "n2", "label": "yes"}
  ]
}
Rules:
- x/y are top-left pixel coordinates; lay nodes out left-to-right or top-to-bottom with 60px gaps.
- Use shape terminator for start/end, process for actions, decision for branches, input for I/O.
- Every edge must reference existing node ids from nodes.
- Keep it under 25 nodes. If the request is not a process/workflow, still produce a sensible diagram.`

interface NimMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function POST(request: NextRequest) {
  if (!NIM_API_KEY) {
    return NextResponse.json(
      { error: 'AI generation is not configured (missing NVIDIA_NIM_API_KEY)' },
      { status: 503 }
    )
  }

  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  const diagramId = typeof body.diagram_id === 'string' ? body.diagram_id : null

  if (!prompt) {
    return NextResponse.json({ error: 'Prompt cannot be empty' }, { status: 400 })
  }

  if (prompt.length > 2000) {
    return NextResponse.json({ error: 'Prompt is too long' }, { status: 400 })
  }

  if (!diagramId) {
    return NextResponse.json({ error: 'Missing diagram_id' }, { status: 400 })
  }

  const { data: diagram } = await supabase
    .from('diagrams')
    .select('owner_id')
    .eq('id', diagramId)
    .single()

  if (!diagram) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const isOwner = diagram.owner_id === user.id
  const { data: collab } = await supabase
    .from('diagram_collaborators')
    .select('role')
    .eq('diagram_id', diagramId)
    .eq('user_id', user.id)
    .single()

  const canEdit = isOwner || (collab && ['owner', 'editor'].includes(collab.role))

  if (!canEdit) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const messages: NimMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ]

  async function callNim(useJsonMode: boolean): Promise<Response> {
    return fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${NIM_API_KEY}`,
      },
      body: JSON.stringify({
        model: NIM_MODEL,
        messages,
        temperature: 0.2,
        max_tokens: 3000,
        ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(60000),
    })
  }

  let nimResponse: Response
  try {
    // Some models on NIM do not support response_format json_object; retry
    // without it and parse the JSON out of the plain text response instead.
    nimResponse = await callNim(true)
    if (!nimResponse.ok) {
      nimResponse = await callNim(false)
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to reach the AI service: ${e instanceof Error ? e.message : 'network error'}` },
      { status: 502 }
    )
  }

  if (!nimResponse.ok) {
    const detail = await nimResponse.text().catch(() => '')
    return NextResponse.json(
      { error: `AI service error (${nimResponse.status}): ${detail.slice(0, 300)}` },
      { status: 502 }
    )
  }

  let nimJson: { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } }
  try {
    nimJson = await nimResponse.json()
  } catch {
    return NextResponse.json({ error: 'Invalid response from AI service' }, { status: 502 })
  }

  const rawContent = nimJson.choices?.[0]?.message?.content || ''
  if (!rawContent) {
    return NextResponse.json({ error: 'Empty response from AI service' }, { status: 502 })
  }

  let parsed: { nodes?: unknown; edges?: unknown }
  try {
    parsed = JSON.parse(rawContent)
  } catch {
    // Models without JSON mode may wrap the object in markdown fences
    const fenced = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenced) {
      try {
        parsed = JSON.parse(fenced[1])
      } catch {
        return NextResponse.json({ error: 'AI returned malformed JSON' }, { status: 502 })
      }
    } else {
      // Last resort: pull out the first balanced {...} block from the text
      const start = rawContent.indexOf('{')
      const end = rawContent.lastIndexOf('}')
      if (start >= 0 && end > start) {
        try {
          parsed = JSON.parse(rawContent.slice(start, end + 1))
        } catch {
          return NextResponse.json({ error: 'AI returned malformed JSON' }, { status: 502 })
        }
      } else {
        return NextResponse.json({ error: 'AI returned malformed JSON' }, { status: 502 })
      }
    }
  }

  if (!Array.isArray(parsed.nodes)) {
    return NextResponse.json({ error: 'AI response missing nodes array' }, { status: 502 })
  }

  await supabase.from('ai_generations').insert({
    diagram_id: diagramId,
    user_id: user.id,
    prompt,
    response: nimJson,
    model: NIM_MODEL,
    tokens_used: nimJson.usage?.total_tokens ?? null,
  })

  return NextResponse.json({
    nodes: parsed.nodes,
    edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    model: NIM_MODEL,
  })
}