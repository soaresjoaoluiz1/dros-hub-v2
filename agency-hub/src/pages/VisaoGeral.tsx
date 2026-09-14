import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchClients, formatBRL, formatNumber, type Client } from '../lib/api'
import { Table2, ExternalLink, Search } from 'lucide-react'

type SortKey = 'name' | 'mrr' | 'tasks' | 'since'
type SortDir = 'asc' | 'desc'

export default function VisaoGeral() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const navigate = useNavigate()

  useEffect(() => {
    setLoading(true)
    fetchClients().then(setClients).finally(() => setLoading(false))
  }, [])

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? clients.filter(c =>
          c.name?.toLowerCase().includes(q) ||
          c.contact_name?.toLowerCase().includes(q) ||
          c.contact_email?.toLowerCase().includes(q) ||
          (c as any).segmento?.toLowerCase().includes(q)
        )
      : clients

    const mult = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'name': return mult * (a.name || '').localeCompare(b.name || '')
        case 'mrr': return mult * (((a as any).monthly_fee || 0) - ((b as any).monthly_fee || 0))
        case 'tasks': return mult * ((a.task_count || 0) - (b.task_count || 0))
        case 'since': {
          const da = (a as any).contrato_inicio || ''
          const db = (b as any).contrato_inicio || ''
          return mult * da.localeCompare(db)
        }
      }
    })
  }, [clients, query, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const totals = useMemo(() => {
    const mrr = clients.reduce((s, c) => s + ((c as any).monthly_fee || 0), 0)
    const tasks = clients.reduce((s, c) => s + (c.task_count || 0), 0)
    return { mrr, tasks, count: clients.length }
  }, [clients])

  const sortIndicator = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  const formatSince = (iso: string | undefined | null) => {
    if (!iso) return '-'
    const d = new Date(iso + (iso.includes('T') ? '' : 'T00:00:00'))
    if (isNaN(d.getTime())) return '-'
    const now = new Date()
    const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
    if (months < 1) return 'este mes'
    if (months < 12) return `${months} ${months === 1 ? 'mes' : 'meses'}`
    const years = Math.floor(months / 12)
    const remMonths = months % 12
    return remMonths === 0
      ? `${years} ${years === 1 ? 'ano' : 'anos'}`
      : `${years}a ${remMonths}m`
  }

  return (
    <div>
      <div className="page-header">
        <h1><Table2 size={22} style={{ marginRight: 8 }} /> Visao Geral</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div style={{ background: 'var(--card-bg, #FFFFFF)', border: '1px solid var(--border-subtle, #E5E7EB)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: '#9B96B0', textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.4 }}>Clientes ativos</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{totals.count}</div>
        </div>
        <div style={{ background: 'var(--card-bg, #FFFFFF)', border: '1px solid var(--border-subtle, #E5E7EB)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: '#9B96B0', textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.4 }}>MRR total</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{formatBRL(totals.mrr)}</div>
        </div>
        <div style={{ background: 'var(--card-bg, #FFFFFF)', border: '1px solid var(--border-subtle, #E5E7EB)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: '#9B96B0', textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.4 }}>Tarefas em aberto</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{formatNumber(totals.tasks)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9B96B0' }} />
          <input
            className="input"
            placeholder="Buscar cliente, contato, email, segmento..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ paddingLeft: 30 }}
          />
        </div>
        <span style={{ fontSize: 12, color: '#9B96B0' }}>{sorted.length} de {clients.length}</span>
      </div>

      {loading ? (
        <div className="loading-container"><div className="spinner" /></div>
      ) : sorted.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#6B6580' }}>
          {query ? 'Nenhum cliente bate com essa busca' : 'Nenhum cliente ativo'}
        </div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('name')}>Cliente{sortIndicator('name')}</th>
                <th>Contato</th>
                <th>Segmento</th>
                <th className="right" style={{ cursor: 'pointer' }} onClick={() => toggleSort('mrr')}>MRR{sortIndicator('mrr')}</th>
                <th className="right" style={{ cursor: 'pointer' }} onClick={() => toggleSort('tasks')}>Tarefas{sortIndicator('tasks')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('since')}>Cliente ha{sortIndicator('since')}</th>
                <th className="right">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(c => {
                const monthlyFee = (c as any).monthly_fee || 0
                const segmento = (c as any).segmento || '-'
                const contratoInicio = (c as any).contrato_inicio
                return (
                  <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/clients/${c.id}`)}>
                    <td className="name">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {c.logo_url && <img src={c.logo_url} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }} />}
                        {c.name}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: 12 }}>{c.contact_name || '-'}</div>
                      {c.contact_email && <div style={{ fontSize: 11, color: '#9B96B0' }}>{c.contact_email}</div>}
                    </td>
                    <td style={{ fontSize: 12, color: '#6B6580' }}>{segmento}</td>
                    <td className="right" style={{ fontWeight: 600 }}>{monthlyFee > 0 ? formatBRL(monthlyFee) : '-'}</td>
                    <td className="right">{formatNumber(c.task_count || 0)}</td>
                    <td style={{ fontSize: 12, color: '#6B6580' }}>{formatSince(contratoInicio)}</td>
                    <td className="right" onClick={e => e.stopPropagation()}>
                      <button className="btn btn-secondary btn-sm btn-icon" onClick={() => navigate(`/clients/${c.id}`)} title="Abrir cliente"><ExternalLink size={12} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
