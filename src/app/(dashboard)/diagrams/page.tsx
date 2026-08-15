'use client'

import { useState, useEffect } from 'react'
import { getBrowserClient } from '@/lib/supabase/browser'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Diagram, DiagramWithLatestVersion } from '@/types/database'

export default function DiagramsPage() {
  const router = useRouter()
  const [diagrams, setDiagrams] = useState<DiagramWithLatestVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'owned' | 'shared' | 'public'>('all')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)

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
        latest_version:diagram_versions!diagram_id(order=version.desc)(
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
      query = query.eq('is_public', false)
      // This would need a more complex query for shared diagrams
    } else if (filter === 'public') {
      query = query.eq('is_public', true)
    }

    const { data, error } = await query

    if (error) {
      setError(error.message)
    } else {
      setDiagrams(data || [])
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
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DiagramCard({
  diagram,
  onRename,
  onDelete,
}: {
  diagram: DiagramWithLatestVersion
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
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
          <div style={styles.nodeCount}>
            {diagram.latest_version.nodes.length} nodes
          </div>
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