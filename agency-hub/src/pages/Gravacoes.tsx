import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchGravacoes, type GravacaoEvent } from '../lib/api'
import { Video, ChevronLeft, ChevronRight, Building2, User, Clock } from 'lucide-react'

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom']
const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

function getMonthStr(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1)
  // Monday=0, Sunday=6
  let startOffset = firstDay.getDay() - 1
  if (startOffset < 0) startOffset = 6
  const daysInMonth = new Date(year, month, 0).getDate()
  const days: (number | null)[] = []
  for (let i = 0; i < startOffset; i++) days.push(null)
  for (let d = 1; d <= daysInMonth; d++) days.push(d)
  // Pad to complete last week
  while (days.length % 7 !== 0) days.push(null)
  return days
}

export default function Gravacoes() {
  const navigate = useNavigate()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [gravacoes, setGravacoes] = useState<GravacaoEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchGravacoes(getMonthStr(year, month)).then(setGravacoes).catch(() => {}).finally(() => setLoading(false))
  }, [year, month])

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear(y => y + 1) } else setMonth(m => m + 1) }
  const goToday = () => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1) }

  const days = getCalendarDays(year, month)
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  // Group gravacoes by day
  const byDay: Record<number, GravacaoEvent[]> = {}
  for (const g of gravacoes) {
    const day = parseInt(g.recording_datetime.slice(8, 10), 10)
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(g)
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1><Video size={22} style={{ marginRight: 8, verticalAlign: 'middle', color: '#FFB300' }} />Gravacoes</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={prevMonth}><ChevronLeft size={16} /></button>
          <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-heading)', minWidth: 180, textAlign: 'center' }}>
            {MONTH_NAMES[month - 1]} {year}
          </span>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={nextMonth}><ChevronRight size={16} /></button>
          <button className="btn btn-secondary btn-sm" onClick={goToday} style={{ marginLeft: 8 }}>Hoje</button>
        </div>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, minWidth: 700 }}>
            {/* Header */}
            {WEEKDAYS.map(d => (
              <div key={d} style={{ padding: '10px 6px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#6B6580', textTransform: 'uppercase', letterSpacing: '0.06em', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-subtle)' }}>
                {d}
              </div>
            ))}
            {/* Days */}
            {days.map((day, i) => {
              if (day === null) return <div key={`e${i}`} style={{ minHeight: 110, background: 'rgba(0,0,0,0.1)', borderRadius: 4 }} />
              const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const isToday = dateStr === todayStr
              const dayGravacoes = byDay[day] || []
              return (
                <div key={day} style={{ minHeight: 110, padding: 6, background: isToday ? 'rgba(255,179,0,0.06)' : 'rgba(255,255,255,0.015)', border: isToday ? '1px solid rgba(255,179,0,0.3)' : '1px solid rgba(255,255,255,0.04)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: isToday ? 800 : 600, color: isToday ? '#FFB300' : '#A8A3B8', fontFamily: 'var(--font-heading)' }}>{day}</div>
                  {dayGravacoes.map(g => {
                    const time = g.recording_datetime.slice(11, 16)
                    const isDone = g.stage === 'concluido'
                    return (
                      <div key={g.id} onClick={() => navigate(`/tasks/${g.id}`)}
                        style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: isDone ? 'rgba(52,199,89,0.08)' : 'rgba(255,179,0,0.08)', border: `1px solid ${isDone ? 'rgba(52,199,89,0.2)' : 'rgba(255,179,0,0.2)'}`, fontSize: 11, transition: 'background 0.15s' }}
                        onMouseEnter={e => (e.currentTarget.style.background = isDone ? 'rgba(52,199,89,0.15)' : 'rgba(255,179,0,0.15)')}
                        onMouseLeave={e => (e.currentTarget.style.background = isDone ? 'rgba(52,199,89,0.08)' : 'rgba(255,179,0,0.08)')}>
                        {time && <div style={{ fontWeight: 700, color: '#FFB300', fontSize: 12 }}>{time}</div>}
                        <div style={{ fontWeight: 600, color: '#F2F0F7', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <Building2 size={9} style={{ marginRight: 3 }} />{g.client_name}
                        </div>
                        {g.assigned_name && <div style={{ color: '#9B96B0', marginTop: 1 }}><User size={9} /> {g.assigned_name}</div>}
                        {isDone && <div style={{ color: '#34C759', fontSize: 9, fontWeight: 700, marginTop: 2 }}>CONCLUIDA</div>}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {/* Summary */}
          <div style={{ marginTop: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Video size={18} style={{ color: '#FFB300' }} />
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-heading)' }}>{gravacoes.length}</div>
                <div style={{ fontSize: 11, color: '#6B6580' }}>Gravacoes no mes</div>
              </div>
            </div>
            <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Clock size={18} style={{ color: '#34C759' }} />
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-heading)', color: '#34C759' }}>{gravacoes.filter(g => g.stage === 'concluido').length}</div>
                <div style={{ fontSize: 11, color: '#6B6580' }}>Concluidas</div>
              </div>
            </div>
            <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Video size={18} style={{ color: '#FFAA83' }} />
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-heading)', color: '#FFAA83' }}>{gravacoes.filter(g => g.stage !== 'concluido').length}</div>
                <div style={{ fontSize: 11, color: '#6B6580' }}>Pendentes</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
