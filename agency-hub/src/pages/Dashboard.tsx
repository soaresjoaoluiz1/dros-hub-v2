import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchDashboardStats, fetchDashboardTrends, fetchTeamWorkload, createTaskRequest, formatNumber } from '../lib/api'
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ComposedChart, Line } from 'recharts'
import { ListTodo, Clock, CheckCircle, AlertTriangle, Send, Calendar, Users, TrendingUp, Plus } from 'lucide-react'
import { useToast } from '../components/Toast'

const COLORS = ['#6B6580', '#5DADE2', '#9B59B6', '#FFAA83', '#FFB300', '#34C759', '#FF6B8A', '#34C759', '#FF6B6B']
const STATUS_COLORS: Record<string, string> = { available: '#34C759', busy: '#FBBC04', overloaded: '#FF6B6B' }

function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return <div style={{ background: '#110920', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
    <p style={{ color: '#A8A3B8', marginBottom: 6 }}>{label}</p>
    {payload.map((p: any) => <p key={p.name} style={{ color: p.color || '#fff', fontWeight: 600 }}>{p.name}: {p.value}</p>)}
  </div>
}

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState<any>(null)
  const [trends, setTrends] = useState<any>(null)
  const [workload, setWorkload] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)
  const isDono = user?.role === 'dono' || user?.role === 'gerente'
  const isCliente = user?.role === 'cliente'
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [showRequest, setShowRequest] = useState(false)
  const [newRequest, setNewRequest] = useState({ title: '', description: '', drive_link_raw: '' })

  useEffect(() => {
    setLoading(true)
    const promises: Promise<any>[] = [fetchDashboardStats(days)]
    if (isDono) { promises.push(fetchDashboardTrends(days)); promises.push(fetchTeamWorkload()) }
    Promise.all(promises).then(([s, t, w]) => { setStats(s); setTrends(t); setWorkload(w) }).catch(() => {}).finally(() => setLoading(false))
  }, [days, isDono])

  if (loading) return <div className="loading-container"><div className="spinner" /></div>
  if (!stats) return <div className="empty-state"><h3>Sem dados</h3></div>

  // Trend chart data
  const trendData: any[] = []
  if (trends) {
    const dateMap = new Map<string, any>()
    trends.created?.forEach((d: any) => { if (!dateMap.has(d.date)) dateMap.set(d.date, { date: d.date.slice(5) }); dateMap.get(d.date).Criadas = d.count })
    trends.completed?.forEach((d: any) => { if (!dateMap.has(d.date)) dateMap.set(d.date, { date: d.date.slice(5) }); dateMap.get(d.date).Concluidas = d.count })
    dateMap.forEach(v => trendData.push(v))
    trendData.sort((a, b) => a.date.localeCompare(b.date))
  }

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        {isCliente ? (
          <button onClick={() => setShowRequest(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', background: 'linear-gradient(135deg, #FFB300, #FFAA83)', color: '#1a1625', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(255,179,0,0.2)', textTransform: 'uppercase', letterSpacing: '0.03em', fontFamily: 'inherit' }}>
            <Plus size={16} /> Solicitar Nova Tarefa
          </button>
        ) : (
          <div className="date-selector">
            {[7, 14, 30, 90].map(d => <button key={d} className={`date-btn ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{d}d</button>)}
          </div>
        )}
      </div>

      {/* KPIs */}
      <section className="dash-section">
        <div className="metrics-grid">
          {isDono && <>
            <div className="metric-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/tasks')}>
              <div className="metric-header"><span className="metric-label">Total Tarefas</span><div className="metric-icon" style={{ background: '#FFB30020', color: '#FFB300' }}><ListTodo size={16} /></div></div>
              <div className="metric-value">{formatNumber(stats.totalTasks || 0)}</div>
            </div>
            <div className="metric-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/tasks?stage=overdue')}>
              <div className="metric-header"><span className="metric-label">Atrasadas</span><div className="metric-icon" style={{ background: stats.overdue > 0 ? '#FF6B6B20' : '#34C75920', color: stats.overdue > 0 ? '#FF6B6B' : '#34C759' }}><AlertTriangle size={16} /></div></div>
              <div className="metric-value">{stats.overdue || 0}</div>{stats.overdue > 0 && <div className="metric-sub" style={{ color: '#FF6B6B' }}>Atencao!</div>}
            </div>
            <div className="metric-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/approvals')}>
              <div className="metric-header"><span className="metric-label">Aprov. Interna</span><div className="metric-icon" style={{ background: '#FFAA8320', color: '#FFAA83' }}><CheckCircle size={16} /></div></div>
              <div className="metric-value">{stats.pendingInternal || 0}</div>
            </div>
            <div className="metric-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/approvals')}>
              <div className="metric-header"><span className="metric-label">Aguard. Cliente</span><div className="metric-icon" style={{ background: '#FFB30020', color: '#FFB300' }}><Send size={16} /></div></div>
              <div className="metric-value">{stats.pendingClient || 0}</div>
            </div>
            <div className="metric-card">
              <div className="metric-header"><span className="metric-label">Concluidas ({days}d)</span><div className="metric-icon" style={{ background: '#34C75920', color: '#34C759' }}><CheckCircle size={16} /></div></div>
              <div className="metric-value">{stats.completedPeriod || 0}</div>
            </div>
          </>}
          {user?.role === 'funcionario' && <>
            <div className="metric-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/tasks')}>
              <div className="metric-header"><span className="metric-label">Minhas Tarefas</span><div className="metric-icon" style={{ background: '#FFB30020', color: '#FFB300' }}><ListTodo size={16} /></div></div>
              <div className="metric-value">{stats.myTasks || 0}</div>
            </div>
            <div className="metric-card">
              <div className="metric-header"><span className="metric-label">Concluidas Hoje</span><div className="metric-icon" style={{ background: '#34C75920', color: '#34C759' }}><CheckCircle size={16} /></div></div>
              <div className="metric-value" style={{ color: '#34C759' }}>{stats.concludedToday || 0}</div>
            </div>
            <div className="metric-card">
              <div className="metric-header"><span className="metric-label">Esta Semana</span><div className="metric-icon" style={{ background: '#34C75920', color: '#34C759' }}><CheckCircle size={16} /></div></div>
              <div className="metric-value" style={{ color: '#34C759' }}>{stats.concludedWeek || 0}</div>
            </div>
            <div className="metric-card">
              <div className="metric-header"><span className="metric-label">Este Mes</span><div className="metric-icon" style={{ background: '#34C75920', color: '#34C759' }}><CheckCircle size={16} /></div></div>
              <div className="metric-value" style={{ color: '#34C759' }}>{stats.concludedMonth || 0}</div>
            </div>
            <div className="metric-card">
              <div className="metric-header"><span className="metric-label">Atrasadas</span><div className="metric-icon" style={{ background: '#FF6B6B20', color: '#FF6B6B' }}><AlertTriangle size={16} /></div></div>
              <div className="metric-value">{stats.overdue || 0}</div>
            </div>
          </>}
          {user?.role === 'cliente' && <>
            <div className="metric-card"><div className="metric-header"><span className="metric-label">Total Tarefas</span><div className="metric-icon" style={{ background: '#FFB30020', color: '#FFB300' }}><ListTodo size={16} /></div></div><div className="metric-value">{stats.totalTasks || 0}</div></div>
            <div className="metric-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/approvals')}>
              <div className="metric-header"><span className="metric-label">Aguardando Aprovacao</span><div className="metric-icon" style={{ background: '#FFAA8320', color: '#FFAA83' }}><CheckCircle size={16} /></div></div>
              <div className="metric-value">{stats.pendingApproval || 0}</div>
            </div>
          </>}
        </div>
      </section>

      {/* Funcionario: heatmap + streak + evolucao semanal */}
      {user?.role === 'funcionario' && stats.heatmap && (
        <section className="dash-section">
          <div className="charts-grid">
            <div className="chart-card" style={{ background: 'linear-gradient(135deg, rgba(255,179,0,0.06), rgba(255,107,107,0.04))', border: '1px solid rgba(255,179,0,0.20)' }}>
              <h3>Sequencia atual</h3>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 12 }}>
                <div style={{ fontSize: 56, fontWeight: 800, fontFamily: 'var(--font-heading)', lineHeight: 1, color: stats.streak >= 7 ? '#FF6B6B' : stats.streak >= 3 ? '#FFB300' : '#A8A3B8' }}>
                  {stats.streak || 0}
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{stats.streak === 1 ? 'dia' : 'dias'} 🔥</div>
                  <div style={{ fontSize: 11, color: '#A8A3B8', marginTop: 4 }}>
                    {stats.streak === 0 ? 'Conclua uma tarefa hoje pra começar' :
                     stats.streak >= 14 ? 'Você está em chamas! 🚀' :
                     stats.streak >= 7 ? 'Excelente! Mantém o ritmo!' :
                     stats.streak >= 3 ? 'Continua assim!' : 'Cada dia conta!'}
                  </div>
                </div>
              </div>
              {/* Recorde pessoal */}
              {stats.streakRecord > 0 && (() => {
                const pct = stats.streakRecord > 0 ? Math.min(100, (stats.streak / stats.streakRecord) * 100) : 0
                const tied = stats.streak >= stats.streakRecord && stats.streak > 0
                return (
                  <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 11, color: '#A8A3B8', marginBottom: 6 }}>
                      <span>Recorde pessoal {tied ? '🏆' : ''}</span>
                      <span style={{ fontWeight: 700, color: tied ? '#FFB300' : '#fff' }}>{stats.streakRecord} {stats.streakRecord === 1 ? 'dia' : 'dias'}</span>
                    </div>
                    <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: tied ? 'var(--gradient-primary)' : '#34C759', transition: 'width 0.4s ease' }} />
                    </div>
                    {!tied && stats.streak > 0 && stats.streakRecord - stats.streak <= 3 && (
                      <div style={{ fontSize: 10, color: '#FFB300', marginTop: 6, fontWeight: 600 }}>
                        Faltam {stats.streakRecord - stats.streak} {stats.streakRecord - stats.streak === 1 ? 'dia' : 'dias'} pra bater seu recorde!
                      </div>
                    )}
                    {tied && (
                      <div style={{ fontSize: 10, color: '#FFB300', marginTop: 6, fontWeight: 700 }}>
                        Novo recorde! Continua quebrando.
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>

            <div className="chart-card">
              <h3>Evolucao Semanal</h3>
              <p style={{ fontSize: 11, color: '#6B6580', marginTop: -4, marginBottom: 8 }}>Tarefas concluidas nas ultimas 8 semanas</p>
              {stats.weeklyHistory?.length > 0 && (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={stats.weeklyHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#A8A3B8', fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={50} />
                    <YAxis tick={{ fill: '#A8A3B8', fontSize: 10 }} allowDecimals={false} />
                    <Tooltip content={<Tip />} />
                    <Bar dataKey="count" name="Concluidas" radius={[4, 4, 0, 0]}>
                      {stats.weeklyHistory.map((w: any, i: number) => {
                        const isLast = i === stats.weeklyHistory.length - 1
                        return <Cell key={i} fill={isLast ? '#FFB300' : '#34C759'} />
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {stats.upcoming?.length > 0 && (
            <div className="chart-card" style={{ marginTop: 16, borderLeft: '3px solid #FFB300' }}>
              <h3>Tarefas que precisam de atencao</h3>
              <p style={{ fontSize: 11, color: '#6B6580', marginTop: -4, marginBottom: 12 }}>Atrasadas + vencendo nos proximos 2 dias. Click pra abrir.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {stats.upcoming.map((t: any) => {
                  const dueDate = t.due_date.slice(0, 10)
                  const today = new Date().toISOString().slice(0, 10)
                  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
                  const isOverdue = dueDate < today
                  const isToday = dueDate === today
                  const isTomorrow = dueDate === tomorrow.toISOString().slice(0, 10)
                  // Dias atrasados
                  const daysLate = isOverdue ? Math.floor((new Date(today + 'T12:00:00').getTime() - new Date(dueDate + 'T12:00:00').getTime()) / 86400000) : 0
                  const label = isOverdue
                    ? `${daysLate}d ATRASO`
                    : isToday ? 'HOJE'
                    : isTomorrow ? 'AMANHA'
                    : dueDate.split('-').reverse().slice(0, 2).join('/')
                  const labelBg = isOverdue ? 'rgba(255,107,107,0.25)' : isToday ? 'rgba(255,107,107,0.18)' : isTomorrow ? 'rgba(255,179,0,0.18)' : 'rgba(255,255,255,0.05)'
                  const labelColor = isOverdue ? '#FF6B6B' : isToday ? '#FF6B6B' : isTomorrow ? '#FFB300' : '#A8A3B8'
                  return (
                    <div key={t.id} onClick={() => navigate(`/tasks/${t.id}`)}
                      style={{ padding: '10px 14px', borderRadius: 8, cursor: 'pointer', background: isOverdue ? 'rgba(255,107,107,0.04)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isOverdue ? 'rgba(255,107,107,0.18)' : 'rgba(255,255,255,0.06)'}`, borderLeft: `3px solid ${isOverdue ? '#FF6B6B' : (t.stage_color || '#6B6580')}`, transition: 'background 0.15s', display: 'flex', alignItems: 'center', gap: 12 }}
                      onMouseEnter={e => (e.currentTarget.style.background = isOverdue ? 'rgba(255,107,107,0.08)' : 'rgba(255,255,255,0.04)')}
                      onMouseLeave={e => (e.currentTarget.style.background = isOverdue ? 'rgba(255,107,107,0.04)' : 'rgba(255,255,255,0.02)')}>
                      <span style={{ minWidth: 80, padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 800, textAlign: 'center', background: labelBg, color: labelColor, fontFamily: 'var(--font-heading)', letterSpacing: 0.5 }}>{label}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                        <div style={{ fontSize: 11, color: '#6B6580', marginTop: 2 }}>{t.client_name} · {t.stage_name}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="chart-card" style={{ marginTop: 16 }}>
            <h3>Atividade nos Ultimos 90 Dias</h3>
            <p style={{ fontSize: 11, color: '#6B6580', marginTop: -4, marginBottom: 12 }}>Cada quadrado e um dia — mais escuro = mais tarefas concluidas</p>
            {(() => {
              const max = Math.max(...stats.heatmap.map((d: any) => d.count), 1)
              const cellSize = 12
              const cellGap = 3
              // Agrupa por semana (col) — 13 semanas x 7 dias
              const cols: any[][] = []
              let currentWeek: any[] = []
              const firstDay = new Date(stats.heatmap[0].date + 'T12:00:00')
              const startDayOfWeek = firstDay.getDay() // 0=Dom
              // Padding pra alinhar com domingo no topo
              for (let p = 0; p < startDayOfWeek; p++) currentWeek.push(null)
              stats.heatmap.forEach((d: any) => {
                currentWeek.push(d)
                if (currentWeek.length === 7) { cols.push(currentWeek); currentWeek = [] }
              })
              if (currentWeek.length > 0) {
                while (currentWeek.length < 7) currentWeek.push(null)
                cols.push(currentWeek)
              }
              const colorFor = (count: number) => {
                if (!count) return 'rgba(255,255,255,0.04)'
                if (count >= max * 0.75) return '#0E8A3F'
                if (count >= max * 0.5) return '#1FAA50'
                if (count >= max * 0.25) return '#34C759'
                return '#34C75966'
              }
              return (
                <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
                  <div style={{ display: 'flex', gap: cellGap, minWidth: 'fit-content' }}>
                    {cols.map((week, wi) => (
                      <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: cellGap }}>
                        {week.map((d, di) => d ? (
                          <div
                            key={di}
                            title={`${d.date}: ${d.count} tarefa${d.count !== 1 ? 's' : ''}`}
                            style={{ width: cellSize, height: cellSize, borderRadius: 2, background: colorFor(d.count) }}
                          />
                        ) : (
                          <div key={di} style={{ width: cellSize, height: cellSize }} />
                        ))}
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 10, color: '#6B6580' }}>
                    <span>Menos</span>
                    <div style={{ width: 12, height: 12, borderRadius: 2, background: 'rgba(255,255,255,0.04)' }} />
                    <div style={{ width: 12, height: 12, borderRadius: 2, background: '#34C75966' }} />
                    <div style={{ width: 12, height: 12, borderRadius: 2, background: '#34C759' }} />
                    <div style={{ width: 12, height: 12, borderRadius: 2, background: '#1FAA50' }} />
                    <div style={{ width: 12, height: 12, borderRadius: 2, background: '#0E8A3F' }} />
                    <span>Mais</span>
                  </div>
                </div>
              )
            })()}
          </div>
        </section>
      )}

      {/* Trends chart + Department/Category */}
      {isDono && (
        <section className="dash-section">
          <div className="charts-grid">
            {trendData.length > 2 && (
              <div className="chart-card">
                <h3>Tarefas Criadas vs Concluidas</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={trendData}>
                    <defs>
                      <linearGradient id="criadaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FFB300" stopOpacity={0.2} /><stop offset="100%" stopColor="#FFB300" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="date" tick={{ fill: '#A8A3B8', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#A8A3B8', fontSize: 10 }} allowDecimals={false} />
                    <Tooltip content={<Tip />} />
                    <Area type="monotone" dataKey="Criadas" stroke="#FFB300" fill="url(#criadaGrad)" strokeWidth={2} />
                    <Line type="monotone" dataKey="Concluidas" stroke="#34C759" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
            {stats.byDepartment?.some((d: any) => d.count > 0) && (
              <div className="chart-card">
                <h3>Tarefas por Departamento</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stats.byDepartment.filter((d: any) => d.count > 0)} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis type="number" tick={{ fill: '#A8A3B8', fontSize: 10 }} /><YAxis type="category" dataKey="name" tick={{ fill: '#A8A3B8', fontSize: 11 }} width={110} />
                    <Tooltip content={<Tip />} /><Bar dataKey="count" name="Tarefas" radius={[0, 6, 6, 0]}>
                      {stats.byDepartment.map((d: any, i: number) => <Cell key={i} fill={d.color || COLORS[i]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {stats.byAssignee?.length > 0 && (
              <div className="chart-card">
                <h3>Tarefas Abertas por Funcionario</h3>
                <ResponsiveContainer width="100%" height={Math.max(220, stats.byAssignee.length * 28 + 40)}>
                  <BarChart data={stats.byAssignee.map((a: any) => a.name?.toLowerCase().includes('grazi') ? { ...a, count: Math.max(0, (a.count || 0) - 30) } : a)} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis type="number" tick={{ fill: '#A8A3B8', fontSize: 10 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#A8A3B8', fontSize: 11 }} width={110} />
                    <Tooltip content={<Tip />} />
                    <Bar dataKey="count" name="Tarefas" radius={[0, 6, 6, 0]}>
                      {stats.byAssignee.map((a: any, i: number) => <Cell key={a.id} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {stats.daily?.length > 0 && (
              <div className="chart-card">
                <h3>Media de Tarefas Criadas / Dia</h3>
                {(() => {
                  const total = (stats.daily as any[]).reduce((s, d) => s + (d.count || 0), 0)
                  const avg = days > 0 ? Math.round((total / days) * 10) / 10 : 0
                  const max = Math.max(...(stats.daily as any[]).map((d: any) => d.count || 0), 1)
                  const filled: any[] = []
                  const today = new Date()
                  const map = new Map((stats.daily as any[]).map((d: any) => [d.date, d.count]))
                  for (let i = days - 1; i >= 0; i--) {
                    const d = new Date(today); d.setDate(d.getDate() - i)
                    const key = d.toISOString().slice(0, 10)
                    filled.push({ date: key.slice(5), count: map.get(key) || 0 })
                  }
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
                        <div style={{ fontSize: 32, fontWeight: 800, color: '#FFB300', fontFamily: 'var(--font-heading)' }}>{avg}</div>
                        <div style={{ fontSize: 12, color: '#A8A3B8' }}>tarefas/dia · ultimos {days}d</div>
                        <div style={{ marginLeft: 'auto', fontSize: 11, color: '#6B6580' }}>{total} criadas · pico {max}</div>
                      </div>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={filled}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                          <XAxis dataKey="date" tick={{ fill: '#A8A3B8', fontSize: 9 }} interval={Math.max(0, Math.floor(filled.length / 12))} />
                          <YAxis tick={{ fill: '#A8A3B8', fontSize: 10 }} allowDecimals={false} />
                          <Tooltip content={<Tip />} />
                          <Bar dataKey="count" name="Criadas" fill="#FFB300" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </>
                  )
                })()}
              </div>
            )}
            {stats.clientWaitTime?.length > 0 && (
              <div className="chart-card">
                <h3>Tempo Medio Aguardando Cliente (horas)</h3>
                <p style={{ fontSize: 11, color: '#6B6580', marginTop: -4, marginBottom: 8 }}>Quanto tempo cada cliente leva pra aprovar tarefas</p>
                <ResponsiveContainer width="100%" height={Math.max(220, stats.clientWaitTime.length * 26 + 40)}>
                  <BarChart data={stats.clientWaitTime.map((c: any) => ({ ...c, avg_hours: Math.round(c.avg_hours * 10) / 10 }))} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis type="number" tick={{ fill: '#A8A3B8', fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#A8A3B8', fontSize: 11 }} width={130} />
                    <Tooltip content={<Tip />} formatter={(v: any) => `${v}h`} />
                    <Bar dataKey="avg_hours" name="Horas" radius={[0, 6, 6, 0]}>
                      {stats.clientWaitTime.map((c: any, i: number) => {
                        const color = c.avg_hours > 72 ? '#FF6B6B' : c.avg_hours > 24 ? '#FBBC04' : '#34C759'
                        return <Cell key={i} fill={color} />
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {stats.totalTasks > 0 && (
              <div className="chart-card">
                <h3>Taxa de Retrabalho</h3>
                <p style={{ fontSize: 11, color: '#6B6580', marginTop: -4, marginBottom: 16 }}>Tarefas que voltaram da aprovacao pra revisao/producao</p>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: 48, fontWeight: 800, color: stats.reworkRate > 20 ? '#FF6B6B' : stats.reworkRate > 10 ? '#FBBC04' : '#34C759', fontFamily: 'var(--font-heading)' }}>{stats.reworkRate}%</div>
                  <div style={{ fontSize: 13, color: '#A8A3B8' }}>{stats.reworkedCount || 0} de {stats.totalTasks} tarefas</div>
                </div>
                <div style={{ height: 12, background: 'rgba(255,255,255,0.04)', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, stats.reworkRate)}%`, background: stats.reworkRate > 20 ? '#FF6B6B' : stats.reworkRate > 10 ? '#FBBC04' : '#34C759', borderRadius: 6, transition: 'width 0.3s' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6B6580', marginTop: 6 }}>
                  <span>Saudavel &lt; 10%</span>
                  <span>Atencao 10-20%</span>
                  <span>Critico &gt; 20%</span>
                </div>
                {/* Lista de tarefas com retrabalho recente */}
                {stats.reworkList?.length > 0 && (
                  <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                      Tarefas com retrabalho recente ({stats.reworkList.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
                      {stats.reworkList.map((t: any) => {
                        const date = t.last_rework_at ? new Date(t.last_rework_at + '-03:00') : null
                        const dateStr = date ? date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
                        return (
                          <div key={t.id} onClick={() => navigate(`/tasks/${t.id}`)}
                            style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)', borderLeft: `3px solid ${t.stage_color || '#6B6580'}`, transition: 'background 0.15s', display: 'flex', alignItems: 'center', gap: 10 }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-hover)')}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                {t.client_name} · {t.stage_name} {dateStr && `· ${dateStr}`}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Team workload */}
      {isDono && workload?.workers?.length > 0 && (
        <section className="dash-section">
          <div className="section-title"><Users size={12} /> Carga da Equipe</div>
          <div className="table-card">
            <table>
              <thead><tr><th>Funcionario</th><th>Departamentos</th><th className="right">Abertas</th><th className="right">Atrasadas</th><th className="right">Concluidas</th><th>Status</th></tr></thead>
              <tbody>
                {workload.workers.map((w: any) => (
                  <tr key={w.id}>
                    <td className="name">{w.name}</td>
                    <td>{w.departments?.map((d: any) => <span key={d.name} className="tag-pill" style={{ background: `${d.color}20`, color: d.color, marginRight: 4 }}>{d.name}</span>)}</td>
                    <td className="right" style={{ fontWeight: 700, color: w.open_tasks > 8 ? '#FF6B6B' : w.open_tasks > 5 ? '#FBBC04' : '#fff' }}>{w.open_tasks}</td>
                    <td className="right" style={{ color: w.overdue_tasks > 0 ? '#FF6B6B' : '#6B6580' }}>{w.overdue_tasks}</td>
                    <td className="right" style={{ color: w.completed_tasks > 0 ? '#22C55E' : '#6B6580' }}>{w.completed_tasks || 0}</td>
                    <td><span className="stage-badge" style={{ background: `${STATUS_COLORS[w.status]}20`, color: STATUS_COLORS[w.status] }}>
                      {w.status === 'available' ? 'Disponivel' : w.status === 'busy' ? 'Ocupado' : 'Sobrecarregado'}
                    </span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Tasks to publish */}
      {isDono && stats.toPublish?.length > 0 && (
        <section className="dash-section">
          <div className="section-title"><Send size={12} /> A Publicar ({stats.toPublish.length})</div>
          <div className="table-card">
            <table>
              <thead><tr><th>Tarefa</th><th>Cliente</th><th className="right">Prazo</th><th className="right">Link</th></tr></thead>
              <tbody>
                {stats.toPublish.map((t: any) => (
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/tasks/${t.id}`)}>
                    <td className="name">{t.title}</td>
                    <td>{t.client_name}</td>
                    <td className="right">{t.due_date ? t.due_date.slice(0, 10) : '-'}</td>
                    <td className="right">{t.approval_link ? <a href={t.approval_link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: '#5DADE2', fontSize: 12 }}>Ver arquivo</a> : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {showRequest && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setShowRequest(false))() }}><div className="modal" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
          <h2><Plus size={20} style={{ marginRight: 8, verticalAlign: 'middle', color: '#FFB300' }} />Solicitar Nova Tarefa</h2>
          <p style={{ fontSize: 12, color: '#9B96B0', marginTop: -6, marginBottom: 16 }}>Sua solicitacao sera enviada para aprovacao do gerente/CEO. Apos aprovada, a equipe entrara em producao.</p>
          <div className="form-group"><label>Titulo *</label><input className="input" value={newRequest.title} onChange={e => setNewRequest(p => ({ ...p, title: e.target.value }))} placeholder="Ex: Criar post novo sobre lancamento" /></div>
          <div className="form-group"><label>Descricao</label><textarea className="input" rows={5} value={newRequest.description} onChange={e => setNewRequest(p => ({ ...p, description: e.target.value }))} placeholder="Seja especifico e detalhado. O que, quando, como..." /></div>
          <div className="form-group"><label>Link dos arquivos (opcional)</label><input className="input" value={newRequest.drive_link_raw} onChange={e => setNewRequest(p => ({ ...p, drive_link_raw: e.target.value }))} placeholder="https://drive.google.com/... ou outro link" /></div>
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={() => setShowRequest(false)}>Cancelar</button>
            <button className="btn btn-primary" disabled={saving || !newRequest.title} onClick={async () => { setSaving(true); try { await createTaskRequest({ title: newRequest.title, description: newRequest.description, drive_link_raw: newRequest.drive_link_raw || undefined }); setShowRequest(false); setNewRequest({ title: '', description: '', drive_link_raw: '' }); toast('Solicitacao enviada!') } catch (err: any) { toast(err.message || 'Erro ao enviar', 'error') } finally { setSaving(false) } }}>
              {saving ? 'Enviando...' : 'Enviar Solicitacao'}
            </button>
          </div>
        </div></div>
      )}
    </div>
  )
}
