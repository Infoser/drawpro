'use client'

import { useEffect, useState } from 'react'
import { getBrowserClient } from '@/lib/supabase/browser'

export default function EditorPage({ params }: { params: { id: string } }) {
  const [loading, setLoading] = useState(true)
  const [peers, setPeers] = useState<{ name: string; email: string; color: string }[]>([])

  useEffect(() => {
    const supabase = getBrowserClient()
    supabase.auth.getUser().then(({ data: { user } }: { data: { user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] } }) => {
      if (!user) {
        window.location.href = '/auth/login'
      } else {
        setLoading(false)
      }
    })
  }, [])

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
          {peers.map((peer) => (
            <div
              key={peer.email}
              style={{ ...styles.avatar, background: peer.color }}
              title={`${peer.email} (viewing)`}
            >
              {peer.name.substring(0, 1).toUpperCase()}
            </div>
          ))}
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

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
}