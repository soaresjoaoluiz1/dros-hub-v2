import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useSSE } from '../context/SSEContext'

export default function TimerCheck() {
  const [popup, setPopup] = useState<{ taskId: number; taskTitle: string; elapsed: number } | null>(null)
  const navigate = useNavigate()

  // Listen for server-sent timer:check events
  useSSE('timer:check', useCallback((data: any) => {
    setPopup({ taskId: data.taskId, taskTitle: data.taskTitle, elapsed: data.elapsed })
    // Also try to show browser notification
    if (Notification.permission === 'granted') {
      new Notification('Ainda esta produzindo?', { body: `Timer ativo: ${data.taskTitle}`, icon: 'https://drosagencia.com.br/hub/logo-dros-bg-blue.png' })
    }
  }, []))

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60
    return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  const handleYes = () => setPopup(null)

  const handleNo = async () => {
    if (popup) {
      try {
        await apiFetch(`/api/tasks/${popup.taskId}/time/stop`, { method: 'POST', body: JSON.stringify({}) })
        await apiFetch(`/api/tasks/${popup.taskId}/stage`, { method: 'PUT', body: JSON.stringify({ stage: 'backlog' }) })
      } catch {}
    }
    setPopup(null)
  }

  if (!popup) return null

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#16102A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '32px 28px', maxWidth: 380, width: '90%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>&#9202;</div>
        <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Ainda esta produzindo?</h2>
        <p style={{ color: '#9B96B0', fontSize: 14, marginBottom: 6 }}>Timer ativo ha <strong style={{ color: '#FFB300' }}>{formatTime(popup.elapsed)}</strong></p>
        <p style={{ color: '#6B6580', fontSize: 12, marginBottom: 20 }}>"{popup.taskTitle}"</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={handleYes} style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #FFB300, #FFAA83)', color: '#0A0118', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', minWidth: 120 }}>Sim, continuar</button>
          <button onClick={handleNo} style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: '#FF6B6B', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', minWidth: 120 }}>Nao, parar</button>
        </div>
      </div>
    </div>
  )
}
