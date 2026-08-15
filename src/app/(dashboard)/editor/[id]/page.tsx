'use client'

import { useEffect, useState } from 'react'
import { getBrowserClient } from '@/lib/supabase/browser'

export default function EditorPage({ params }: { params: { id: string } }) {
  const [loading, setLoading] = useState(true)

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

  if (loading) {
    return (
      <div style={styles.loading}>
        <div style={styles.spinner}></div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
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
}