'use client'

import { useState, useEffect } from 'react'

interface Collaborator {
  user_id: string
  role: string
  created_at: string
  profile: { username: string | null; avatar_url: string | null } | null
}

interface ShareModalProps {
  diagramId: string
  diagramTitle: string
  isOwner: boolean
  onClose: () => void
}

const ROLES = ['editor', 'commenter', 'viewer']

export default function ShareModal({ diagramId, diagramTitle, isOwner, onClose }: ShareModalProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [loading, setLoading] = useState(true)
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const fetchCollaborators = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/diagrams/${diagramId}/collaborators`)
      if (!res.ok) throw new Error('Failed to load collaborators')
      setCollaborators(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load collaborators')
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchCollaborators()
  }, [diagramId])

  const handleInvite = async () => {
    if (!email.trim()) return
    setInviting(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch(`/api/diagrams/${diagramId}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to invite')
      setEmail('')
      setSuccess(`Invited ${email.trim()} as ${role}`)
      await fetchCollaborators()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to invite')
    }
    setInviting(false)
  }

  const handleRoleChange = async (userId: string, newRole: string) => {
    setError('')
    const res = await fetch(`/api/diagrams/${diagramId}/collaborators`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, role: newRole }),
    })
    if (!res.ok) {
      const body = await res.json()
      setError(body.error || 'Failed to update role')
      return
    }
    setCollaborators(collaborators.map((c) =>
      c.user_id === userId ? { ...c, role: newRole } : c
    ))
  }

  const handleRemove = async (userId: string) => {
    if (!confirm('Remove this collaborator?')) return
    setError('')
    const res = await fetch(`/api/diagrams/${diagramId}/collaborators?user_id=${userId}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      const body = await res.json()
      setError(body.error || 'Failed to remove')
      return
    }
    setCollaborators(collaborators.filter((c) => c.user_id !== userId))
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>Share "{diagramTitle}"</h3>
          <button onClick={onClose} style={styles.closeButton}>×</button>
        </div>

        <div style={styles.body}>
          {isOwner && (
            <div style={styles.inviteRow}>
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                style={styles.input}
              />
              <select value={role} onChange={(e) => setRole(e.target.value)} style={styles.select}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <button onClick={handleInvite} disabled={inviting || !email.trim()} style={styles.inviteButton}>
                {inviting ? 'Inviting...' : 'Invite'}
              </button>
            </div>
          )}

          {error && <div style={styles.error}>{error}</div>}
          {success && <div style={styles.success}>{success}</div>}

          <div style={styles.list}>
            {loading ? (
              <div style={styles.empty}>Loading...</div>
            ) : collaborators.length === 0 ? (
              <div style={styles.empty}>No collaborators yet</div>
            ) : (
              collaborators.map((c) => (
                <div key={c.user_id} style={styles.row}>
                  <div style={styles.avatar}>
                    {c.profile?.avatar_url ? (
                      <img src={c.profile.avatar_url} alt="" style={styles.avatarImg} />
                    ) : (
                      <span style={styles.avatarLetter}>
                        {(c.profile?.username || '?').charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div style={styles.rowInfo}>
                    <div style={styles.rowName}>{c.profile?.username || c.user_id}</div>
                    <div style={styles.rowMeta}>Role: {c.role}</div>
                  </div>
                  {isOwner && (
                    <div style={styles.rowActions}>
                      <select
                        value={c.role}
                        onChange={(e) => handleRoleChange(c.user_id, e.target.value)}
                        style={styles.selectSmall}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <button onClick={() => handleRemove(c.user_id)} style={styles.removeButton}>Remove</button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: 'white',
    borderRadius: '12px',
    width: '480px',
    maxWidth: '90vw',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid #f0f0f0',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
    color: '#333',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '22px',
    cursor: 'pointer',
    color: '#999',
    padding: '0 4px',
  },
  body: {
    padding: '20px',
    overflowY: 'auto',
  },
  inviteRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px',
  },
  input: {
    flex: 1,
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    outline: 'none',
  },
  select: {
    padding: '8px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    background: 'white',
  },
  inviteButton: {
    padding: '8px 14px',
    background: '#1f77b4',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  error: {
    padding: '10px 12px',
    background: '#fef2f2',
    color: '#dc3545',
    borderRadius: '6px',
    fontSize: '13px',
    marginBottom: '12px',
  },
  success: {
    padding: '10px 12px',
    background: '#f0fdf4',
    color: '#16a34a',
    borderRadius: '6px',
    fontSize: '13px',
    marginBottom: '12px',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  empty: {
    textAlign: 'center',
    padding: '24px',
    color: '#999',
    fontSize: '14px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    border: '1px solid #f0f0f0',
    borderRadius: '8px',
  },
  avatar: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    background: '#eef4ff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  avatarImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  avatarLetter: {
    color: '#1f77b4',
    fontSize: '15px',
    fontWeight: '600',
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#333',
  },
  rowMeta: {
    fontSize: '12px',
    color: '#999',
  },
  rowActions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  selectSmall: {
    padding: '4px 6px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '13px',
    background: 'white',
  },
  removeButton: {
    padding: '5px 10px',
    background: 'white',
    border: '1px solid #f5c6cb',
    borderRadius: '6px',
    fontSize: '13px',
    color: '#dc3545',
    cursor: 'pointer',
  },
}