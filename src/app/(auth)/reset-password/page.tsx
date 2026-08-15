'use client'

import { useState } from 'react'
import { getBrowserClient } from '@/lib/supabase/browser'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

export default function ResetPasswordPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const code = searchParams.get('code')
  const isUpdate = !!code
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = getBrowserClient()

    if (isUpdate) {
      if (password !== confirmPassword) {
        setError('Passwords do not match')
        setLoading(false)
        return
      }
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setError(error.message)
      } else {
        setSuccess(true)
        setTimeout(() => router.push('/auth/login'), 2000)
      }
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      })
      if (error) {
        setError(error.message)
      } else {
        setSuccess(true)
      }
    }
    setLoading(false)
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>
          {isUpdate ? 'Set New Password' : 'Reset Password'}
        </h1>
        <p style={styles.subtitle}>
          {isUpdate
            ? 'Enter your new password below'
            : 'Enter your email to receive a reset link'}
        </p>

        {error && <div style={styles.error}>{error}</div>}
        {success && !isUpdate && (
          <div style={styles.success}>
            Check your email for the reset link
          </div>
        )}
        {success && isUpdate && (
          <div style={styles.success}>
            Password updated! Redirecting to login...
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          {!isUpdate && (
            <div style={styles.field}>
              <label htmlFor="email" style={styles.label}>Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={styles.input}
                required
                disabled={loading || success}
              />
            </div>
          )}

          {isUpdate && (
            <>
              <div style={styles.field}>
                <label htmlFor="password" style={styles.label}>New Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={styles.input}
                  required
                  disabled={loading}
                  minLength={8}
                />
              </div>
              <div style={styles.field}>
                <label htmlFor="confirmPassword" style={styles.label}>Confirm Password</label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={styles.input}
                  required
                  disabled={loading}
                />
              </div>
            </>
          )}

          <button type="submit" style={styles.button} disabled={loading || success}>
            {loading
              ? 'Processing...'
              : isUpdate
              ? 'Update Password'
              : 'Send Reset Link'}
          </button>
        </form>

        <p style={styles.footer}>
          <Link href="/auth/login" style={styles.link}>
            Back to Sign In
          </Link>
        </p>
      </div>
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f5f5f5',
    padding: '20px',
  },
  card: {
    background: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    padding: '40px',
    width: '100%',
    maxWidth: '400px',
  },
  title: {
    margin: '0 0 8px',
    fontSize: '28px',
    fontWeight: '600',
    color: '#1f77b4',
  },
  subtitle: {
    margin: '0 0 24px',
    color: '#666',
    fontSize: '16px',
  },
  error: {
    background: '#fee',
    color: '#c00',
    padding: '12px',
    borderRadius: '4px',
    marginBottom: '16px',
    fontSize: '14px',
  },
  success: {
    background: '#efe',
    color: '#080',
    padding: '12px',
    borderRadius: '4px',
    marginBottom: '16px',
    fontSize: '14px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  label: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#333',
  },
  input: {
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '16px',
    outline: 'none',
  },
  button: {
    padding: '12px',
    background: '#1f77b4',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '16px',
    fontWeight: '500',
    cursor: 'pointer',
    marginTop: '8px',
  },
  footer: {
    marginTop: '20px',
    textAlign: 'center',
    fontSize: '14px',
    color: '#666',
  },
  link: {
    color: '#1f77b4',
    textDecoration: 'none',
    fontWeight: '500',
  },
}