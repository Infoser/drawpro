'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getBrowserClient } from '@/lib/supabase/browser'

interface CommentItem {
  id: string
  user_id: string
  node_id: string | null
  content: string
  resolved: boolean
  created_at: string
  updated_at: string
  profile: { username: string; avatar_url: string | null } | null
}

export default function EditorPage({ params }: { params: { id: string } }) {
  const [loading, setLoading] = useState(true)
  const [peers, setPeers] = useState<{ name: string; email: string; color: string }[]>([])
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comments, setComments] = useState<CommentItem[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [myId, setMyId] = useState<string | null>(null)
  const loadedRef = useRef(false)

  useEffect(() => {
    const supabase = getBrowserClient()
    supabase.auth.getUser().then(({ data: { user } }: { data: { user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] } }) => {
      if (!user) {
        window.location.href = '/auth/login'
      } else {
        setMyId(user.id)
        setLoading(false)
      }
    })
  }, [])

  const loadComments = useCallback(async () => {
    setCommentsLoading(true)
    try {
      const res = await fetch(`/api/diagrams/${params.id}/comments`)
      if (res.ok) {
        setComments((await res.json()) as CommentItem[])
      }
    } finally {
      setCommentsLoading(false)
    }
  }, [params.id])

  useEffect(() => {
    const supabase = getBrowserClient()

    const channel = supabase
      .channel(`comments:${params.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments', filter: `diagram_id=eq.${params.id}` },
        (payload) => {
          const row = payload.new as CommentItem
          setComments((prev) => [row, ...prev])
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'comments', filter: `diagram_id=eq.${params.id}` },
        (payload) => {
          const row = payload.new as CommentItem
          setComments((prev) => prev.map((c) => (c.id === row.id ? row : c)))
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'comments', filter: `diagram_id=eq.${params.id}` },
        (payload) => {
          const old = payload.old as { id: string }
          setComments((prev) => prev.filter((c) => c.id !== old.id))
        }
      )
      .subscribe()

    if (!loadedRef.current) {
      loadedRef.current = true
      loadComments()
    }

    return () => {
      supabase.removeChannel(channel)
    }
  }, [params.id, loadComments])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (data && data.source === 'drawpro-editor' && data.type === 'presence') {
        setPeers(data.users || [])
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const sendComment = async () => {
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/diagrams/${params.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (res.ok) {
        setDraft('')
      }
    } finally {
      setSending(false)
    }
  }

  const toggleResolved = async (comment: CommentItem) => {
    await fetch(`/api/diagrams/${params.id}/comments/${comment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved: !comment.resolved }),
    })
  }

  const deleteComment = async (comment: CommentItem) => {
    await fetch(`/api/diagrams/${params.id}/comments/${comment.id}`, { method: 'DELETE' })
  }

  if (loading) {
    return (
      <div style={styles.loading}>
        <div style={styles.spinner}></div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      {peers.length > 0 && (
        <div style={styles.avatars}>
          {peers.map((peer, i) => (
            <div
              key={`${peer.email}-${i}`}
              style={{ ...styles.avatar, background: peer.color }}
              title={`${peer.email} (viewing)`}
            >
              {peer.name.substring(0, 1).toUpperCase()}
            </div>
          ))}
        </div>
      )}
      <button
        onClick={() => setCommentsOpen((v) => !v)}
        style={{ ...styles.commentsToggle, right: commentsOpen ? '336px' : '66px', background: commentsOpen ? '#1f77b4' : '#ffffff' }}
        title="Comments"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill={commentsOpen ? '#ffffff' : '#1f77b4'}>
          <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" />
        </svg>
      </button>
      {commentsOpen && (
        <div style={styles.panel}>
          <div style={styles.panelHeader}>Comments</div>
          <div style={styles.commentList}>
            {commentsLoading && comments.length === 0 ? (
              <div style={styles.empty}>Loading…</div>
            ) : comments.length === 0 ? (
              <div style={styles.empty}>No comments yet.</div>
            ) : (
              comments.map((comment) => (
                <div key={comment.id} style={{ ...styles.comment, opacity: comment.resolved ? 0.55 : 1 }}>
                  <div style={styles.commentHeader}>
                    <div style={styles.commentAuthor}>
                      <span style={{ ...styles.commentAvatar, background: colorFor(comment.user_id) }}>
                        {(comment.profile?.username || '?').substring(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <div style={styles.commentName}>{comment.profile?.username || 'Unknown'}</div>
                        <div style={styles.commentTime}>{timeAgo(comment.created_at)}</div>
                      </div>
                    </div>
                    {comment.user_id === myId && (
                      <div style={styles.commentActions}>
                        <button style={styles.actionButton} title={comment.resolved ? 'Reopen' : 'Resolve'} onClick={() => toggleResolved(comment)}>
                          {comment.resolved ? '↺' : '✓'}
                        </button>
                        <button style={styles.actionButton} title="Delete" onClick={() => deleteComment(comment)}>
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                  <div style={styles.commentBody}>{comment.content}</div>
                </div>
              ))
            )}
          </div>
          <div style={styles.composer}>
            <textarea
              style={styles.input}
              placeholder="Add a comment…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendComment()
                }
              }}
            />
            <button style={{ ...styles.sendButton, opacity: draft.trim() && !sending ? 1 : 0.5 }} onClick={sendComment} disabled={sending}>
              Send
            </button>
          </div>
        </div>
      )}
      <iframe
        src={`/editor.html?id=${params.id}`}
        style={styles.iframe}
        title="DrawPro Editor"
        allowFullScreen
      />
    </div>
  )
}

function colorFor(id: string): string {
  const palette = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#17becf']
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return palette[hash % palette.length]
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: '60px',
    background: 'white',
  },
  loading: {
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #f3f3f3',
    borderTop: '3px solid #1f77b4',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  iframe: {
    width: '100%',
    height: '100%',
    border: 'none',
  },
  avatars: {
    position: 'fixed',
    top: '12px',
    right: '16px',
    zIndex: 100,
    display: 'flex',
    gap: '6px',
  },
  avatar: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 'bold',
    boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
    cursor: 'default',
  },
  commentsToggle: {
    position: 'fixed',
    top: '12px',
    zIndex: 300,
    transition: 'right 0.15s ease',
    width: '34px',
    height: '34px',
    borderRadius: '8px',
    border: '1px solid #d0d7de',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  },
  panel: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: '320px',
    background: '#ffffff',
    borderLeft: '1px solid #d0d7de',
    zIndex: 200,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '-2px 0 8px rgba(0,0,0,0.1)',
  },
  panelHeader: {
    padding: '14px 16px',
    fontWeight: 600,
    fontSize: '14px',
    borderBottom: '1px solid #eaeef2',
    color: '#24292f',
  },
  commentList: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px',
  },
  empty: {
    color: '#8c959f',
    fontSize: '13px',
    textAlign: 'center',
    marginTop: '24px',
  },
  comment: {
    border: '1px solid #eaeef2',
    borderRadius: '8px',
    padding: '10px 12px',
    marginBottom: '10px',
  },
  commentHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  commentAuthor: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  commentAvatar: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: 'bold',
    flexShrink: 0,
  },
  commentName: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#24292f',
  },
  commentTime: {
    fontSize: '11px',
    color: '#8c959f',
  },
  commentActions: {
    display: 'flex',
    gap: '4px',
  },
  actionButton: {
    border: 'none',
    background: 'none',
    color: '#8c959f',
    fontSize: '12px',
    cursor: 'pointer',
    padding: '2px 4px',
  },
  commentBody: {
    marginTop: '8px',
    fontSize: '13px',
    color: '#24292f',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  composer: {
    borderTop: '1px solid #eaeef2',
    padding: '12px',
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    minHeight: '36px',
    maxHeight: '120px',
    resize: 'none',
    border: '1px solid #d0d7de',
    borderRadius: '8px',
    padding: '8px 10px',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  sendButton: {
    border: 'none',
    background: '#1f77b4',
    color: '#fff',
    borderRadius: '8px',
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
}