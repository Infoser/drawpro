'use client'

import { useState, useEffect } from 'react'
import { getBrowserClient } from '@/lib/supabase/browser'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Diagram, DiagramWithLatestVersion } from '@/types/database'
import ShareModal from '@/components/ShareModal'

export default function DiagramsPage() {
  const router = useRouter()
  const [diagrams, setDiagrams] = useState<DiagramWithLatestVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'owned' | 'shared' | 'public'>('all')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [shareDiagram, setShareDiagram] = useState<DiagramWithLatestVersion | null>(null)

  useEffect(() => {
    getBrowserClient().auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id || null))
  }, [])

  useEffect(() => {
    fetchDiagrams()
  }, [filter, search])

  const fetchDiagrams = async () => {
    setLoading(true)
    setError('')

    const supabase = getBrowserClient()
    let query = supabase
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
      .order('updated_at', { ascending: false })

    if (filter === 'owned') {
      query = query.eq('owner_id', (await supabase.auth.getUser()).data.user?.id)
    } else if (filter === 'shared') {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: collabs } = await supabase
        .from('diagram_collaborators')
        .select('diagram_id')
        .eq('user_id', user?.id || '')
      const ids = (collabs || []).map((c) => c.diagram_id)
      query = query
        .eq('is_public', false)
        .in('id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'])
    } else if (filter === 'public') {
      query = query.eq('is_public', true)
    }

    const { data, error } = await query

    if (error) {
      setError(error.message)
    } else {
      setDiagrams(
        (data || []).map((d) => ({
          ...d,
          latest_version: Array.isArray(d.latest_version)
            ? d.latest_version.sort((a: { version: number }, b: { version: number }) => b.version - a.version)[0]
            : d.latest_version,
        }))
      )
    }
    setLoading(false)
  }

  const handleCreate = async () => {
    setCreating(true)
    const supabase = getBrowserClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data, error } = await supabase
      .from('diagrams')
      .insert({
        title: 'Untitled Diagram',
        owner_id: user!.id,
      })
      .select()
      .single()

    if (error) {
      setError(error.message)
      setCreating(false)
    } else {
      router.push(`/dashboard/editor/${data.id}`)
    }
  }

  const handleDelete = async (diagramId: string) => {
    if (!confirm('Delete this diagram?')) return

    const supabase = getBrowserClient()
    const { error } = await supabase
      .from('diagrams')
      .delete()
      .eq('id', diagramId)

    if (error) {
      setError(error.message)
    } else {
      setDiagrams(diagrams.filter((d) => d.id !== diagramId))
    }
  }

  const handleRename = async (diagramId: string, newTitle: string) => {
    const supabase = getBrowserClient()
    const { error } = await supabase
      .from('diagrams')
      .update({ title: newTitle })
      .eq('id', diagramId)

    if (!error) {
      setDiagrams(diagrams.map((d) =>
        d.id === diagramId ? { ...d, title: newTitle } : d
      ))
    }
  }

  const filteredDiagrams = diagrams.filter((d) => {
    if (search) {
      return d.title.toLowerCase().includes(search.toLowerCase())
    }
    return true
  })

  const emptyState = {
    all: 'No diagrams yet. Create your first diagram!',
    owned: 'You don\'t own any diagrams yet.',
    shared: 'No diagrams shared with you.',
    public: 'No public diagrams.',
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1>My Diagrams</h1>
        <button onClick={handleCreate} style={styles.createButton} disabled={creating}>
          {creating ? 'Creating...' : '+ New Diagram'}
        </button>
      </div>

      <div style={styles.toolbar}>
        <div style={styles.searchWrapper}>
          <input
            type="text"
            placeholder="Search diagrams..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.searchInput}
          />
        </div>
        <div style={styles.filterWrapper}>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            style={styles.filterSelect}
          >
            <option value="all">All</option>
            <option value="owned">Owned</option>
            <option value="shared">Shared</option>
            <option value="public">Public</option>
          </select>
        </div>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {loading ? (
        <div style={styles.loading}>Loading diagrams...</div>
      ) : filteredDiagrams.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>📄</div>
          <p>{emptyState[filter]}</p>
          {filter === 'all' && (
            <button onClick={handleCreate} style={styles.createButton}>
              Create Your First Diagram
            </button>
          )}
        </div>
      ) : (
        <div style={styles.grid}>
          {filteredDiagrams.map((diagram) => (
            <DiagramCard
              key={diagram.id}
              diagram={diagram}
              onRename={handleRename}
              onDelete={handleDelete}
              onShare={(d) => setShareDiagram(d)}
            />
          ))}
        </div>
      )}

      {shareDiagram && (
        <ShareModal
          diagramId={shareDiagram.id}
          diagramTitle={shareDiagram.title}
          isOwner={shareDiagram.owner_id === currentUserId}
          onClose={() => setShareDiagram(null)}
        />
      )}
    </div>
  )
}

function DiagramCard({
  diagram,
  onRename,
  onDelete,
  onShare,
}: {
  diagram: DiagramWithLatestVersion
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onShare: (diagram: DiagramWithLatestVersion) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [newTitle, setNewTitle] = useState(diagram.title)

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (newTitle.trim() && newTitle !== diagram.title) {
      onRename(diagram.id, newTitle.trim())
    }
    setRenaming(false)
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        {renaming ? (
          <form onSubmit={handleRenameSubmit} style={styles.renameForm}>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              style={styles.renameInput}
              autoFocus
              onBlur={() => setRenaming(false)}
            />
          </form>
        ) : (
          <h3 style={styles.title} onDoubleClick={() => setRenaming(true)}>
            {diagram.title}
          </h3>
        )}
        <div style={styles.badge}>
          {diagram.is_public && <span style={styles.badgePublic}>Public</span>}
          {diagram.owner_id !== '' && !diagram.is_public && (
            <span style={styles.badgePrivate}>Private</span>
          )}
        </div>
      </div>

      <div style={styles.preview}>
        {diagram.latest_version?.nodes && Array.isArray(diagram.latest_version.nodes) && diagram.latest_version.nodes.length > 0 ? (
          <Thumbnail
            nodes={diagram.latest_version.nodes as any[]}
            edges={(diagram.latest_version.edges as any[]) || []}
          />
        ) : (
          <div style={styles.emptyPreview}>Empty diagram</div>
        )}
      </div>

      <div style={styles.cardFooter}>
        <span style={styles.updatedAt}>
          Updated {formatDate(diagram.updated_at)}
        </span>
        <div style={styles.actions}>
          <Link
            href={`/dashboard/editor/${diagram.id}`}
            style={styles.actionButton}
          >
            Edit
          </Link>
          <button
            onClick={() => setRenaming(true)}
            style={styles.actionButton}
          >
            Rename
          </button>
          <button
            onClick={() => onShare(diagram)}
            style={styles.actionButton}
          >
            Share
          </button>
          <button
            onClick={() => onDelete(diagram.id)}
            style={{ ...styles.actionButton, ...styles.actionButtonDanger }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

function Thumbnail({ nodes, edges }: { nodes: any[]; edges: any[] }) {
  const W = 300
  const H = 120
  const PAD = 14

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const n of nodes) {
    const x = n.position?.x || 0
    const y = n.position?.y || 0
    const w = n.size?.width || 120
    const h = n.size?.height || 60
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
  }

  if (minX === Infinity) {
    return <div style={{ color: '#ccc', fontSize: '14px' }}>Empty diagram</div>
  }

  const scale = Math.min((W - 2 * PAD) / (maxX - minX || 1), (H - 2 * PAD) / (maxY - minY || 1), 2.5)
  const ox = PAD - minX * scale
  const oy = PAD - minY * scale

  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const fill = (style: string) => {
    const m = /fillColor=#([0-9a-fA-F]{6})/.exec(style || '')
    return m ? `#${m[1]}` : '#1f77b4'
  }

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ background: '#fafafa' }}>
      {edges.map((e, i) => {
        const s = nodeById.get(e.source)
        const t = nodeById.get(e.target)
        if (!s || !t) return null
        const sx = ox + ((s.position?.x || 0) + (s.size?.width || 120) / 2) * scale
        const sy = oy + ((s.position?.y || 0) + (s.size?.height || 60) / 2) * scale
        const tx = ox + ((t.position?.x || 0) + (t.size?.width || 120) / 2) * scale
        const ty = oy + ((t.position?.y || 0) + (t.size?.height || 60) / 2) * scale
        return (
          <line
            key={i}
            x1={sx}
            y1={sy}
            x2={tx}
            y2={ty}
            stroke="#94a3b8"
            strokeWidth={1}
          />
        )
      })}
      {nodes.map((n) => {
        const x = ox + (n.position?.x || 0) * scale
        const y = oy + (n.position?.y || 0) * scale
        const w = Math.max((n.size?.width || 120) * scale, 6)
        const h = Math.max((n.size?.height || 60) * scale, 6)
        const label = (n.label || '').toString()
        const fontSize = Math.min(Math.max(h * 0.3, 5), 13)
        const visible = w > 24 && h > 14
        return (
          <g key={n.id}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={Math.min(4, w / 5)}
              fill={fill(n.style)}
              stroke="#475569"
              strokeWidth={0.75}
            />
            {visible && (
              <text
                x={x + w / 2}
                y={y + h / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#ffffff"
                fontSize={fontSize}
                fontFamily="system-ui, sans-serif"
              >
                {label.length > 24 ? label.slice(0, 23) + '…' : label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function formatDate(dateString: string) {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return date.toLocaleDateString()
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  },
  createButton: {
    padding: '12px 24px',
    background: '#1f77b4',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  toolbar: {
    display: 'flex',
    gap: '16px',
    marginBottom: '24px',
    flexWrap: 'wrap',
  },
  searchWrapper: {
    flex: 1,
    minWidth: '200px',
  },
  searchInput: {
    width: '100%',
    padding: '10px 16px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    fontSize: '14px',
    outline: 'none',
  },
  filterWrapper: {
    minWidth: '150px',
  },
  filterSelect: {
    width: '100%',
    padding: '10px 16px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    fontSize: '14px',
    outline: 'none',
    background: 'white',
  },
  error: {
    background: '#fee',
    color: '#c00',
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  loading: {
    textAlign: 'center',
    padding: '40px',
    color: '#999',
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    color: '#999',
  },
  emptyIcon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '16px',
  },
  card: {
    background: 'white',
    borderRadius: '12px',
    border: '1px solid #e0e0e0',
    overflow: 'hidden',
    transition: 'box-shadow 0.2s, transform 0.2s',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px',
    borderBottom: '1px solid #f0f0f0',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
    color: '#333',
    cursor: 'pointer',
  },
  renameForm: {
    width: '100%',
  },
  renameInput: {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #1f77b4',
    borderRadius: '4px',
    fontSize: '16px',
    fontWeight: '600',
    outline: 'none',
  },
  badge: {
    display: 'flex',
    gap: '8px',
  },
  badgePublic: {
    padding: '2px 8px',
    background: '#eef4ff',
    color: '#1f77b4',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  badgePrivate: {
    padding: '2px 8px',
    background: '#f5f5f5',
    color: '#999',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  preview: {
    height: '120px',
    background: '#fafafa',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottom: '1px solid #f0f0f0',
  },
  emptyPreview: {
    color: '#ccc',
    fontSize: '14px',
  },
  nodeCount: {
    color: '#666',
    fontSize: '14px',
  },
  cardFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    background: '#fafafa',
  },
  updatedAt: {
    fontSize: '12px',
    color: '#999',
  },
  actions: {
    display: 'flex',
    gap: '8px',
  },
  actionButton: {
    padding: '6px 12px',
    background: 'white',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '500',
    color: '#333',
    cursor: 'pointer',
    textDecoration: 'none',
    transition: 'all 0.2s',
  },
  actionButtonDanger: {
    color: '#dc3545',
    borderColor: '#f5c6cb',
  },
}