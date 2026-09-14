import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchNotifications, markNotificationRead, markAllNotificationsRead, type AppNotification } from '../lib/api'
import { Bell, CheckCircle, XCircle, MessageCircle, UserPlus, Eye, AlertTriangle, Clock, AtSign, CheckCheck } from 'lucide-react'

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

export default function Notifications() {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const load = () => {
    setLoading(true)
    fetchNotifications(page, filter === 'unread').then(d => { setNotifications(d.notifications); setTotal(d.total) }).finally(() => setLoading(false))
  }
  useEffect(load, [page, filter])

  const handleClick = async (n: AppNotification) => {
    if (!n.is_read) await markNotificationRead(n.id)
    if (n.task_id) navigate(`/tasks/${n.task_id}`)
    else load()
  }

  const handleReadAll = async () => { await markAllNotificationsRead(); load() }

  return (
    <div>
      <div className="page-header">
        <h1><Bell size={22} style={{ marginRight: 8 }} /> Notificacoes</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setFilter('all'); setPage(1) }}>Todas</button>
          <button className={`btn btn-sm ${filter === 'unread' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setFilter('unread'); setPage(1) }}>Nao lidas</button>
          <button className="btn btn-secondary btn-sm" onClick={handleReadAll}><CheckCheck size={12} /> Marcar todas lidas</button>
        </div>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : notifications.length === 0 ? (
        <div className="empty-state"><div className="icon">🔔</div><h3>Sem notificacoes</h3></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {notifications.map(n => {
            const Icon = ICON_MAP[n.type] || Bell
            const color = COLOR_MAP[n.type] || '#6B6580'
            return (
              <div key={n.id} onClick={() => handleClick(n)} className="card" style={{ cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'flex-start', padding: '14px 18px', background: n.is_read ? undefined : 'rgba(255,179,0,0.03)', borderColor: n.is_read ? undefined : 'rgba(255,179,0,0.12)' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={16} style={{ color }} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ fontSize: 14, fontWeight: n.is_read ? 400 : 700, color: n.is_read ? '#A8A3B8' : '#F0EDF5', fontFamily: 'var(--font-heading)' }}>{n.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: '#6B6580' }}>{timeAgo(n.created_at)}</span>
                      {!n.is_read && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FFB300' }} />}
                    </div>
                  </div>
                  {n.message && <div style={{ fontSize: 13, color: '#A8A3B8', marginTop: 2 }}>{n.message}</div>}
                  <div style={{ fontSize: 11, color: '#6B6580', marginTop: 4 }}>
                    {n.triggered_by_name && <span>{n.triggered_by_name}</span>}
                    {n.task_title && <span> · {n.task_title}</span>}
                  </div>
                </div>
              </div>
            )
          })}
          {total > 20 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 12 }}>
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</button>
              <span style={{ fontSize: 12, color: '#A8A3B8', padding: '6px 12px' }}>Pag {page}/{Math.ceil(total / 20)}</span>
              <button className="btn btn-secondary btn-sm" disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(p => p + 1)}>Proxima</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
