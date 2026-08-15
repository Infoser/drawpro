// DrawPro Database Types
// Generated from supabase/migrations/001_initial_schema.sql
// Run `supabase gen types typescript --local > src/types/database.ts` to regenerate

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Profile {
  id: string
  username: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface Diagram {
  id: string
  title: string
  owner_id: string
  is_public: boolean
  thumbnail_url: string | null
  created_at: string
  updated_at: string
}

export interface DiagramVersion {
  id: string
  diagram_id: string
  version: number
  nodes: Json
  edges: Json
  viewport: Json | null
  created_by: string | null
  created_at: string
}

export interface DiagramCollaborator {
  diagram_id: string
  user_id: string
  role: 'owner' | 'editor' | 'commenter' | 'viewer'
  invited_by: string | null
  created_at: string
}

export interface Presence {
  id: string
  diagram_id: string
  user_id: string
  cursor_x: number | null
  cursor_y: number | null
  selection: Json | null
  last_seen: string
}

export interface Comment {
  id: string
  diagram_id: string
  user_id: string
  node_id: string | null
  content: string
  resolved: boolean
  created_at: string
  updated_at: string
}

export interface AiGeneration {
  id: string
  diagram_id: string
  user_id: string
  prompt: string
  response: Json
  model: string
  tokens_used: number | null
  created_at: string
}

// Composite types for queries
export interface DiagramWithCollaborators extends Diagram {
  collaborators: DiagramCollaborator[]
  user_role?: 'owner' | 'editor' | 'commenter' | 'viewer'
}

export interface DiagramWithLatestVersion extends Diagram {
  latest_version: DiagramVersion | null
}

export interface CommentWithUser extends Comment {
  user: Profile
}

export interface PresenceWithUser extends Presence {
  user: Profile
}

// API request/response types
export interface CreateDiagramRequest {
  title?: string
}

export interface UpdateDiagramRequest {
  title?: string
  is_public?: boolean
  thumbnail_url?: string
}

export interface InviteCollaboratorRequest {
  email: string
  role: 'editor' | 'commenter' | 'viewer'
}

export interface UpdateCollaboratorRequest {
  role: 'editor' | 'commenter' | 'viewer'
}

export interface CreateCommentRequest {
  node_id?: string
  content: string
}

export interface UpdateCommentRequest {
  content?: string
  resolved?: boolean
}

export interface AiGenerateRequest {
  prompt: string
  diagram_id?: string
}

export interface AiGenerateResponse {
  nodes: FlowNode[]
  edges: FlowEdge[]
  explanation: string
}

export interface FlowNode {
  id: string
  type: 'process' | 'decision' | 'terminator' | 'input' | 'output'
  label: string
  position: { x: number; y: number }
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  label?: string
  type?: 'default' | 'conditional'
}

// Draw.io mxCell types (for editor integration)
export interface MxCell {
  id: string
  value: string
  style: string
  vertex?: 1
  edge?: 1
  parent: string
  geometry?: MxGeometry
  source?: string
  target?: string
}

export interface MxGeometry {
  x?: number
  y?: number
  width?: number
  height?: number
  relative?: 0 | 1
  as?: string
  points?: Array<{ x: number; y: number }>
}