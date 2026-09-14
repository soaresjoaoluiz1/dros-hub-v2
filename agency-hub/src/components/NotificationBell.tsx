import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSSE } from '../context/SSEContext'
import { fetchUnreadCount, fetchNotifications, markNotificationRead, markAllNotificationsRead, type AppNotification } from '../lib/api'
import { Bell, CheckCircle, XCircle, MessageCircle, UserPlus, Eye, AlertTriangle, Clock, AtSign } from 'lucide-react'

const ICON_MAP: Record<string, any> = {
  task_assigned: UserPlus, task_reassigned: UserPlus, comment_added: MessageCircle, comment_mention: AtSign,
  task_approved: CheckCircle, task_rejected: XCircle, client_rejected: XCircle,
  task_ready_for_approval: Eye, task_submitted_review: Eye, task_completed: CheckCircle,
  task_overdue: AlertTriangle, task_deadline_approaching: Clock,
}
const COLOR_MAP: Record<string, string> = {
  task_assigned: '#5DADE2', task_approved: '#34C759', task_completed: '#34C759',
  task_rejected: '#FF6B6B', client_rejected: '#FF6B6B', task_overdue: '#FF6B6B',
  task_ready_for_approval: '#FFB300', task_submitted_review: '#FFAA83',
  comment_added: '#9B59B6', comment_mention: '#FFB300', task_deadline_approaching: '#FBBC04',
}

function timeAgo(d: string) {
  const [datePart, timePartRaw] = d.split(/[ T]/)
  const [y, mo, da] = datePart.split('-').map(Number)
  const [h, mi, s] = ((timePartRaw || '00:00:00').split(':').map(Number)) as [number, number, number]
  const utcMs = Date.UTC(y, (mo || 1) - 1, da || 1, (h || 0) + 3, mi || 0, s || 0)
  const m = Math.floor((Date.now() - utcMs) / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `${m}m`
  const hr = Math.floor(m / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.floor(hr / 24)}d`
}

export default function NotificationBell() {
  const navigate = useNavigate()
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [toast, setToast] = useState<AppNotification | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { fetchUnreadCount().then(setCount).catch(() => {}) }, [])

  useSSE('notification:new', useCallback((data: any) => {
    setCount(c => c + 1)
    setToast(data)
    setTimeout(() => setToast(null), 5000)
  }, []))

  const handleOpen = async () => {
    if (!open) {
      const data = await fetchNotifications(1)
      setNotifications(data.notifications)
    }
    setOpen(!open)
  }

  const handleClick = async (n: AppNotification) => {
    if (!n.is_read) { await markNotificationRead(n.id); setCount(c => Math.max(0, c - 1)) }
    setOpen(false)
    if (n.task_id) navigate(`/tasks/${n.task_id}`)
  }

  const handleReadAll = async () => {
    await markAllNotificationsRead()
    setCount(0); setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })))
  }

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler); return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <>
      <div ref={ref} style={{ position: 'relative' }}>
        <button onClick={handleOpen} style={{ background: 'none', border: 'none', cursor: 'pointer', position: 'relative', padding: 8, borderRadius: 8, color: count > 0 ? '#FFB300' : '#6B6580', transition: '0.2s' }}>
          <Bell size={20} />
          {count > 0 && <span style={{ position: 'absolute', top: 2, right: 2, background: '#FF6B6B', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10, minWidth: 16, textAlign: 'center' }}>{count > 99 ? '99+' : count}</span>}
        </button>

        {open && (
          <div style={{ position: 'fixed', left: 70, top: 10, width: 340, maxHeight: 440, background: '#16102A', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, boxShadow: '0 12px 48px rgba(0,0,0,0.7)', zIndex: 99999, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-heading)' }}>Notificacoes</span>
              {count > 0 && <button onClick={handleReadAll} style={{ background: 'none', border: 'none', color: '#FFB300', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Marcar todas lidas</button>}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', maxHeight: 380 }}>
              {notifications.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center', color: '#6B6580', fontSize: 13 }}>Nenhuma notificacao</div>
              ) : notifications.map(n => {
                const Icon = ICON_MAP[n.type] || Bell
                const color = COLOR_MAP[n.type] || '#6B6580'
                return (
                  <div key={n.id} onClick={() => handleClick(n)} style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start', background: n.is_read ? 'transparent' : 'rgba(255,179,0,0.04)', transition: '0.2s' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={14} style={{ color }} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: n.is_read ? 400 : 600, color: n.is_read ? '#A8A3B8' : '#F0EDF5' }}>{n.title}</div>
                      {n.message && <div style={{ fontSize: 11, color: '#6B6580', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.message}</div>}
                      <div style={{ fontSize: 10, color: '#6B6580', marginTop: 2 }}>{n.triggered_by_name && `${n.triggered_by_name} · `}{timeAgo(n.created_at)}</div>
                    </div>
                    {!n.is_read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FFB300', flexShrink: 0, marginTop: 6 }} />}
                  </div>
                )
              })}
            </div>
            <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
              <button onClick={() => { setOpen(false); navigate('/notifications') }} style={{ background: 'none', border: 'none', color: '#FFB300', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Ver todas</button>
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div onClick={() => { if (toast.task_id) navigate(`/tasks/${toast.task_id}`); setToast(null) }} style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 300, background: '#16102A', border: '1px solid rgba(255,179,0,0.25)', borderRadius: 12, padding: '14px 18px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.5)', cursor: 'pointer', maxWidth: 340, display: 'flex', gap: 10, alignItems: 'center', animation: 'slideIn 0.3s ease',
        }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: `${COLOR_MAP[toast.type] || '#FFB300'}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {(() => { const Icon = ICON_MAP[toast.type] || Bell; return <Icon size={16} style={{ color: COLOR_MAP[toast.type] || '#FFB300' }} /> })()}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{toast.title}</div>
            {toast.message && <div style={{ fontSize: 11, color: '#A8A3B8' }}>{toast.message}</div>}
          </div>
        </div>
      )}
    </>
  )
}
