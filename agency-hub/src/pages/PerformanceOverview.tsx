// =====================================================================
// PerformanceOverview — visao agregada de TODOS os clientes vinculados
// Visivel so pra dono/gerente. Cards com metricas-chave + sparkline 7d.
// Click no card abre ClientDetail.tsx > tab Performance daquele cliente.
// =====================================================================
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart3, ArrowUpDown, ExternalLink } from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import {
  fetchAllClientsOverview, formatBRL, formatNumber, pctChange,
  type AllClientsOverviewItem,
} from '../lib/performanceApi'

const PERIOD_OPTIONS = [
  { label: '7 dias', value: 7 },
  { label: '14 dias', value: 14 },
  { label: '30 dias', value: 30 },
  { label: '90 dias', value: 90 },
]

type SortKey = 'name' | 'spend' | 'leads' | 'roas' | 'sessions'

export default function PerformanceOverview() {
  const [days, setDays] = useState(7)
  const [items, setItems] = useState<AllClientsOverviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortKey>('spend')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const navigate = useNavigate()

  useEffect(() => {
    setLoading(true); setError(null)
    fetchAllClientsOverview(days)
      .then(r => setItems(r.clients))
      .catch(e => setError(e?.message || 'Falha ao carregar overview'))
      .finally(() => setLoading(false))
  }, [days])

  const sorted = useMemo(() => {
    const arr = [...items]
    arr.sort((a, b) => {
      const t = (it: AllClientsOverviewItem) => it.overview?.totals
      let av: number | string = 0
      let bv: number | string = 0
      switch (sortBy) {
        case 'name':     av = a.client.name; bv = b.client.name; break
        case 'spend':    av = t(a)?.spend ?? -1; bv = t(b)?.spend ?? -1; break
        case 'leads':    av = t(a)?.leads ?? -1; bv = t(b)?.leads ?? -1; break
        case 'roas':     av = t(a)?.roas ?? -1; bv = t(b)?.roas ?? -1; break
        case 'sessions': av = t(a)?.sessions ?? -1; bv = t(b)?.sessions ?? -1; break
      }
      const cmp = typeof av === 'string'
        ? (av as string).localeCompare(bv as string, 'pt-BR')
        : (av as number) - (bv as number)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [items, sortBy, sortDir])

  return (
    <div>
      <div className="page-header">
        <h1><BarChart3 size={20} style={{ marginRight: 8, verticalAlign: -3 }} /> Performance Geral <span style={{ fontSize: 10, color: '#6B6580', fontWeight: 400, marginLeft: 6 }}>v3 meta+</span></h1>
        <p style={{ color: '#9B96B0', fontSize: 13, marginTop: 4 }}>
          Visao consolidada de todos os clientes vinculados ({items.length})
        </p>
      </div>

      <div className="toolbar" style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="date-selector" style={{ display: 'flex', gap: 4, background: 'var(--bg-card)', borderRadius: 8, padding: 3, border: '1px solid var(--border-subtle)' }}>
          {PERIOD_OPTIONS.map(o => (
            <button key={o.value}
              className={`date-btn ${days === o.value ? 'active' : ''}`}
              onClick={() => setDays(o.value)}>{o.label}</button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <ArrowUpDown size={14} style={{ color: '#9B96B0' }} />
          <select className="input" value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)}
            style={{ padding: '6px 10px', fontSize: 12 }}>
            <option value="spend">Ordenar: Investimento</option>
            <option value="leads">Leads/Conversoes</option>
            <option value="roas">ROAS</option>
            <option value="sessions">Sessoes</option>
            <option value="name">Nome</option>
          </select>
          <button className="btn btn-sm btn-secondary"
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            title={sortDir === 'asc' ? 'Crescente' : 'Decrescente'}
            style={{ padding: '6px 10px', fontSize: 14 }}>
            {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: 16, color: '#FF6B6B', marginBottom: 16 }}>
          Erro: {error}
        </div>
      )}

      {loading ? (
        <ClientGridSkeleton />
      ) : sorted.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: '#9B96B0' }}>
          Nenhum cliente vinculado. Vincule contas (Meta, GAds, GA4, IG) nos dados do cliente.
        </div>
      ) : (
        <div className="clients-perf-grid">
          {sorted.map(it => (
            <ClientPerfCard key={it.client.id} item={it}
              onOpen={() => navigate(`/clients/${it.client.id}?tab=performance`)} />
          ))}
        </div>
      )}
    </div>
  )
}

function ClientPerfCard({ item, onOpen }: {
  item: AllClientsOverviewItem
  onOpen: () => void
}) {
  const { client, overview, error } = item
  if (error || !overview) {
    return (
      <div className="card client-perf-card error" onClick={onOpen} role="button" tabIndex={0}>
        <CardHeader client={client} />
        <div style={{ padding: 16, color: '#FF6B6B', fontSize: 12 }}>
          {error || 'Sem dados disponiveis'}
        </div>
      </div>
    )
  }
  const t = overview.totals
  const s = overview.sources
  const qualRate = s.crm?.crmTotal
    ? Math.round((s.crm.qualSim / s.crm.crmTotal) * 100)
    : null
  const sparkData = (overview.metaDaily || []).map(d => ({ date: d.date, value: d.spend }))
  const hasSpark = sparkData.length >= 2

  const meta = s.meta
  const fmtPct = (n?: number) => n === undefined || n === null ? '—' : `${n.toFixed(2)}%`
  const fmtNum2 = (n?: number) => n === undefined || n === null ? '—' : n.toFixed(2)
  // Mostrar linha Meta se cliente TEM badge Meta (vinculado), mesmo se payload nao retornou dados
  const showMeta = client.hasMeta

  return (
    <div className="card client-perf-card" onClick={onOpen} role="button" tabIndex={0}>
      <CardHeader client={client} />

      <div className="metric-stack">
        {(showMeta || client.hasGads) && (
          <MetricRow label="Investido" value={formatBRL(t.spend)}
            current={t.spend} previous={t.prevSpend} invert />
        )}
        {showMeta && (
          <MetricRow label="Alcance" value={formatNumber(meta?.reach || 0)}
            current={meta?.reach} previous={meta?.prevReach} />
        )}
        {showMeta && (
          <MetricRow label="Impressoes" value={formatNumber(meta?.impressions || 0)}
            current={meta?.impressions} previous={meta?.prevImpressions} />
        )}
        {(showMeta || client.hasGads) && (
          <MetricRow label="Resultados" value={formatNumber(t.leads)}
            current={t.leads} previous={t.prevLeads} />
        )}
        {(showMeta || t.cpl > 0) && (
          <MetricRow label="CPL" value={formatBRL(t.cpl)}
            current={t.cpl} previous={t.prevCpl} invert />
        )}
        {showMeta && (
          <MetricRow label="CPM" value={formatBRL(meta?.cpm || 0)}
            current={meta?.cpm} previous={meta?.prevCpm} invert />
        )}
        {showMeta && (
          <MetricRow label="CTR Link" value={fmtPct(meta?.ctrLink || 0)}
            current={meta?.ctrLink} previous={meta?.prevCtrLink} />
        )}
        {showMeta && (meta?.hookRate || 0) > 0 && (
          <MetricRow label="Hook Rate" value={fmtPct(meta?.hookRate)}
            current={meta?.hookRate} previous={meta?.prevHookRate} />
        )}
        {showMeta && (
          <MetricRow label="Frequencia" value={fmtNum2(meta?.frequency || 0)}
            current={meta?.frequency} previous={meta?.prevFrequency} invert />
        )}
        {client.hasGA4 && (
          <MetricRow label="Sessoes site" value={formatNumber(t.sessions)}
            current={t.sessions} previous={t.prevSessions} />
        )}
        {t.roas > 0 && (
          <MetricRow label="ROAS" value={`${t.roas.toFixed(1)}x`} />
        )}
        {qualRate !== null && (
          <MetricRow label="Qualif CRM" value={`${qualRate}% (${s.crm!.qualSim}/${s.crm!.crmTotal})`} />
        )}
      </div>

      {hasSpark && (
        <div className="card-sparkline">
          <ResponsiveContainer width="100%" height={40}>
            <AreaChart data={sparkData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
              <defs>
                <linearGradient id={`grad-${client.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FFB300" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#FFB300" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="value" stroke="#FFB300" strokeWidth={1.5} fill={`url(#grad-${client.id})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="card-open-hint">
        <ExternalLink size={11} /> Abrir cliente
      </div>
    </div>
  )
}

function CardHeader({ client }: { client: AllClientsOverviewItem['client'] }) {
  return (
    <div className="card-header-row">
      {client.logo_url
        ? <img src={client.logo_url} alt={client.name} className="client-logo-sm" />
        : <div className="client-logo-sm placeholder">{client.name.charAt(0).toUpperCase()}</div>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="client-name">{client.name}</div>
        <div className="platform-badges">
          {client.hasMeta && <span className="badge meta">Meta</span>}
          {client.hasGads && <span className="badge gads">GAds</span>}
          {client.hasGA4 && <span className="badge ga4">GA4</span>}
          {client.hasIG && <span className="badge ig">IG</span>}
        </div>
      </div>
    </div>
  )
}

function MetricRow({ label, value, current, previous, invert }: {
  label: string
  value: string
  current?: number
  previous?: number
  invert?: boolean
}) {
  const ch = current !== undefined && previous !== undefined
    ? pctChange(current, previous) : null
  const pos = ch === null ? null : invert ? ch <= 0 : ch >= 0
  return (
    <div className="metric-row">
      <span className="metric-row-label">{label}</span>
      <span className="metric-row-value">{value}</span>
      {ch !== null ? (
        <span className={`metric-row-delta ${pos ? 'pos' : 'neg'}`}>
          {ch >= 0 ? '+' : ''}{ch.toFixed(1)}%
        </span>
      ) : <span />}
    </div>
  )
}

function ClientGridSkeleton() {
  return (
    <div className="clients-perf-grid">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card client-perf-card">
          <div className="card-header-row">
            <div className="client-logo-sm placeholder shimmer-line" style={{ width: 36, height: 36 }} />
            <div style={{ flex: 1 }}>
              <div className="shimmer-line" style={{ width: '70%', height: 14 }} />
              <div className="shimmer-line" style={{ width: '40%', height: 10, marginTop: 6 }} />
            </div>
          </div>
          <div className="metric-stack">
            {Array.from({ length: 5 }).map((_, j) => (
              <div key={j} className="shimmer-line" style={{ margin: '8px 0' }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
