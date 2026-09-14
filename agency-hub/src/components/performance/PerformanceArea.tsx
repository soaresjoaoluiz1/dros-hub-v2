// =====================================================================
// PerformanceArea — UI principal de Performance (tabs + dados)
//
// Usado por:
//  - Performance.tsx (cliente) — fetcha /my-scope pra saber quais tabs mostrar
//  - ClientDetail.tsx (admin)  — passa availablePlatforms + accountIdHint via prop
//
// Cada tab so aparece se o cliente tiver vinculo na plataforma correspondente:
//   Geral, Meta Ads → core_meta_account_id
//   Instagram       → core_ig_page_id
//   Google Ads      → core_gads_customer_id
//   Analytics       → core_ga4_property_id
// =====================================================================
import { useState, useEffect } from 'react'
import { apiFetch } from '../../lib/api'
import {
  fetchAccounts, fetchCompare, fetchDailyCompare,
  type MetaAccount, type CompareResponse, type DailyCompareResponse,
  DAYS_MAP,
} from '../../lib/performanceApi'
import MetricCards from './MetricCards'
import SpendChart from './SpendChart'
import CampaignTable from './CampaignTable'
import FunnelChart from './FunnelChart'
import InstagramView from './InstagramView'
import CRMView from './CRMView'
import KiwifyView from './KiwifyView'
import GoogleAdsView from './GoogleAdsView'
import AnalyticsView from './AnalyticsView'
import OverviewView from './OverviewView'
import { BarChart3, Instagram, LineChart, LayoutDashboard, Calendar } from 'lucide-react'

const DATE_OPTIONS = [
  { label: '7 dias', value: '7d' },
  { label: '14 dias', value: '14d' },
  { label: '30 dias', value: '30d' },
  { label: '90 dias', value: '90d' },
  { label: 'Personalizado', value: 'custom' },
]

type ClientTab = 'overview' | 'ads' | 'instagram' | 'googleads' | 'analytics'

export interface AvailablePlatforms {
  meta?: boolean
  ig?: boolean
  gads?: boolean
  ga4?: boolean
}

interface Props {
  accountNameHint?: string
  accountIdHint?: string
  // Se definido (admin via ClientDetail): so mostra as tabs onde a flag for true.
  // Se undefined (cliente em /performance): fetcha /my-scope pra descobrir.
  availablePlatforms?: AvailablePlatforms
}

export default function PerformanceArea({ accountNameHint, accountIdHint, availablePlatforms }: Props) {
  const [scope, setScope] = useState<(AvailablePlatforms & { name?: string }) | null>(availablePlatforms || null)
  const [scopeLoading, setScopeLoading] = useState(!availablePlatforms)
  const [accounts, setAccounts] = useState<MetaAccount[]>([])
  const [selectedAccount, setSelectedAccount] = useState<MetaAccount | null>(null)
  const [clientTab, setClientTab] = useState<ClientTab | null>(null)
  const [datePeriod, setDatePeriod] = useState('7d')
  const [customDateFrom, setCustomDateFrom] = useState('')
  const [customDateTo, setCustomDateTo] = useState('')
  const [showCustomDates, setShowCustomDates] = useState(false)
  const [compareData, setCompareData] = useState<CompareResponse | null>(null)
  const [campaignCompare, setCampaignCompare] = useState<CompareResponse | null>(null)
  const [dailyCompare, setDailyCompare] = useState<DailyCompareResponse | null>(null)
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [loadingData, setLoadingData] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  // 1) Resolve scope (quais plataformas disponiveis + nome textual de fallback)
  useEffect(() => {
    if (availablePlatforms) {
      setScope({ ...availablePlatforms, name: accountNameHint })
      setScopeLoading(false)
      return
    }
    setScopeLoading(true)
    apiFetch('/api/performance/my-scope')
      .then((d: any) => setScope({ meta: !!d.meta, ig: !!d.ig, gads: !!d.gads, ga4: !!d.ga4, name: d.name || '' }))
      .catch(() => setScope({ meta: true, ig: true, gads: true, ga4: true, name: '' }))
      .finally(() => setScopeLoading(false))
  }, [availablePlatforms, accountNameHint])

  // 2) Se tem Meta vinculo, fetcha contas Meta. Senao, pula.
  useEffect(() => {
    if (!scope) return
    if (!scope.meta) { setAccounts([]); setSelectedAccount(null); return }
    setLoadingAccounts(true)
    fetchAccounts()
      .then((accs) => {
        setAccounts(accs)
        if (accs.length === 0) { setSelectedAccount(null); return }
        if (accountIdHint) {
          const match = accs.find(a => a.id === accountIdHint)
          setSelectedAccount(match || accs[0])
        } else if (accountNameHint) {
          const q = accountNameHint.toLowerCase()
          const match = accs.find(a => (a.name || '').toLowerCase().includes(q))
          setSelectedAccount(match || accs[0])
        } else {
          setSelectedAccount(accs[0])
        }
      })
      .catch(() => { setAccounts([]); setSelectedAccount(null) })
      .finally(() => setLoadingAccounts(false))
  }, [scope, accountNameHint, accountIdHint])

  // 3) Define tab inicial baseado no que ta disponivel
  useEffect(() => {
    if (!scope || clientTab !== null) return
    if (scope.meta) setClientTab('overview')
    else if (scope.ig) setClientTab('instagram')
    else if (scope.gads) setClientTab('googleads')
    else if (scope.ga4) setClientTab('analytics')
  }, [scope, clientTab])

  const getEffectiveDays = (): number => {
    if (datePeriod === 'custom' && customDateFrom && customDateTo) {
      const diff = Math.ceil((new Date(customDateTo).getTime() - new Date(customDateFrom).getTime()) / 86400000) + 1
      return Math.max(diff, 1)
    }
    return DAYS_MAP[datePeriod] || 7
  }

  // 4) Fetch Meta Ads data quando entra na tab 'ads'
  useEffect(() => {
    if (!selectedAccount || clientTab !== 'ads') return
    if (datePeriod === 'custom' && (!customDateFrom || !customDateTo)) return
    setLoadingData(true)
    const days = getEffectiveDays()
    const since = datePeriod === 'custom' ? customDateFrom : undefined
    const until = datePeriod === 'custom' ? customDateTo : undefined
    Promise.all([
      fetchCompare(selectedAccount.id, days, 'account', since, until).catch(() => null),
      fetchCompare(selectedAccount.id, days, 'campaign', since, until).catch(() => null),
      fetchDailyCompare(selectedAccount.id, days, since, until).catch(() => null),
    ])
      .then(([acct, camp, daily]) => {
        setCompareData(acct); setCampaignCompare(camp); setDailyCompare(daily)
        setLastUpdate(new Date())
      })
      .finally(() => setLoadingData(false))
  }, [selectedAccount, datePeriod, clientTab, customDateFrom, customDateTo])

  if (scopeLoading || loadingAccounts) {
    return (
      <div className="loading-container" style={{ minHeight: 400 }}>
        <div className="spinner" /><span>Carregando...</span>
      </div>
    )
  }

  // Nenhuma plataforma vinculada
  const hasAnyPlatform = scope && (scope.meta || scope.ig || scope.gads || scope.ga4)
  if (!hasAnyPlatform) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40, color: '#9B96B0', maxWidth: 600, margin: '60px auto' }}>
        <BarChart3 size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6, color: '#F2F0F7' }}>Painel de Performance</h3>
        <p style={{ fontSize: 13 }}>Nenhuma plataforma vinculada ainda. Fale com a agencia pra configurar.</p>
      </div>
    )
  }

  const current = compareData?.current?.[0] || null
  const previous = compareData?.previous?.[0] || null
  const showAccountPicker = accounts.length > 1
  // accountName usado pelos sub-views (IG/GAds/Analytics) — vem da conta Meta selecionada
  // ou do nome textual (core_client_name) como fallback quando nao tem Meta
  const contextName = selectedAccount?.name || scope?.name || ''
  const titleName = selectedAccount?.name || scope?.name || 'Painel de Performance'

  return (
    <div className="performance-area">
      {/* Header */}
      <div className="performance-header" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{titleName}</h2>
        {showAccountPicker && selectedAccount && (
          <select
            className="input"
            value={selectedAccount.id}
            onChange={(e) => {
              const acc = accounts.find(a => a.id === e.target.value)
              if (acc) setSelectedAccount(acc)
            }}
            style={{ padding: '6px 10px', fontSize: 12, maxWidth: 280 }}
          >
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <div className="client-tabs" style={{ display: 'flex', gap: 4, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {scope?.meta && (
            <button className={`client-tab ${clientTab === 'overview' ? 'active' : ''}`} onClick={() => setClientTab('overview')}>
              <LayoutDashboard size={14} /><span>Geral</span>
            </button>
          )}
          {scope?.meta && (
            <button className={`client-tab ${clientTab === 'ads' ? 'active' : ''}`} onClick={() => setClientTab('ads')}>
              <BarChart3 size={14} /><span>Meta Ads</span>
            </button>
          )}
          {scope?.ig && (
            <button className={`client-tab ${clientTab === 'instagram' ? 'active' : ''}`} onClick={() => setClientTab('instagram')}>
              <Instagram size={14} /><span>Instagram</span>
            </button>
          )}
          {scope?.gads && (
            <button className={`client-tab ${clientTab === 'googleads' ? 'active' : ''}`} onClick={() => setClientTab('googleads')}>
              <BarChart3 size={14} /><span>Google Ads</span>
            </button>
          )}
          {scope?.ga4 && (
            <button className={`client-tab ${clientTab === 'analytics' ? 'active' : ''}`} onClick={() => setClientTab('analytics')}>
              <LineChart size={14} /><span>Analytics</span>
            </button>
          )}
        </div>
      </div>

      {/* Date selector */}
      <div className="date-bar" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="date-selector" style={{ display: 'flex', gap: 4 }}>
          {DATE_OPTIONS.map((opt) => (
            <button key={opt.value} className={`date-btn ${datePeriod === opt.value ? 'active' : ''}`} onClick={() => {
              setDatePeriod(opt.value)
              setShowCustomDates(opt.value === 'custom')
            }}>
              {opt.value === 'custom' ? <><Calendar size={11} /> {opt.label}</> : opt.label}
            </button>
          ))}
        </div>
        {showCustomDates && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="date" className="input" value={customDateFrom} onChange={e => setCustomDateFrom(e.target.value)} style={{ width: 140, padding: '6px 10px', fontSize: 12 }} />
            <span style={{ color: '#6E6887', fontSize: 11 }}>ate</span>
            <input type="date" className="input" value={customDateTo} onChange={e => setCustomDateTo(e.target.value)} style={{ width: 140, padding: '6px 10px', fontSize: 12 }} />
          </div>
        )}
      </div>

      {/* Overview — requer Meta vinculo */}
      {clientTab === 'overview' && selectedAccount && (
        <OverviewView
          accountId={selectedAccount.id}
          accountName={selectedAccount.name}
          days={getEffectiveDays()}
          since={datePeriod === 'custom' ? customDateFrom : undefined}
          until={datePeriod === 'custom' ? customDateTo : undefined}
        />
      )}

      {/* Meta Ads */}
      {clientTab === 'ads' && selectedAccount && (
        <>
          {loadingData ? (
            <div className="loading-container"><div className="spinner" /><span>Carregando dados...</span></div>
          ) : !current ? (
            <div className="card" style={{ textAlign: 'center', padding: 32, color: '#9B96B0' }}>
              <p>Sem dados de Meta Ads nos ultimos {getEffectiveDays()} dias.</p>
            </div>
          ) : (
            <>
              <section className="dash-section">
                <MetricCards current={current} previous={previous} />
              </section>
              <section className="dash-section">
                <div className="section-title">Desempenho no Periodo</div>
                <div className="charts-grid">
                  <div className="chart-card">
                    {selectedAccount.name.toLowerCase().includes('sameco') ? (
                      <>
                        <h3>Leads</h3>
                        <SpendChart currentData={dailyCompare?.current || []} previousData={dailyCompare?.previous || []} dataKey="leads" label="Leads" />
                      </>
                    ) : (
                      <>
                        <h3>Conversas Iniciadas</h3>
                        <SpendChart currentData={dailyCompare?.current || []} previousData={dailyCompare?.previous || []} dataKey="messaging" label="Conversas" />
                      </>
                    )}
                  </div>
                  <div className="chart-card">
                    <h3>Funil de Conversao</h3>
                    <FunnelChart insight={current} />
                  </div>
                </div>
                <div className="charts-grid">
                  <div className="chart-card full-width">
                    <h3>Valor Investido</h3>
                    <SpendChart currentData={dailyCompare?.current || []} previousData={dailyCompare?.previous || []} dataKey="spend" label="Investimento" />
                  </div>
                </div>
              </section>
              <section className="dash-section">
                <div className="section-title">Campanhas</div>
                <CampaignTable currentCampaigns={campaignCompare?.current || []} previousCampaigns={campaignCompare?.previous || []} />
              </section>
              <CRMView accountId={selectedAccount.id} accountName={selectedAccount.name} days={getEffectiveDays()} adSpend={current ? parseFloat(current.spend) : undefined} />
              <KiwifyView accountName={selectedAccount.name} days={getEffectiveDays()} adSpend={current ? parseFloat(current.spend) : undefined} />
            </>
          )}
        </>
      )}

      {clientTab === 'instagram' && <InstagramView accountName={contextName} />}
      {clientTab === 'googleads' && <GoogleAdsView accountName={contextName} days={getEffectiveDays()} since={datePeriod === 'custom' ? customDateFrom : undefined} until={datePeriod === 'custom' ? customDateTo : undefined} />}
      {clientTab === 'analytics' && <AnalyticsView accountName={contextName} days={getEffectiveDays()} since={datePeriod === 'custom' ? customDateFrom : undefined} until={datePeriod === 'custom' ? customDateTo : undefined} />}

      {lastUpdate && (
        <div style={{ marginTop: 24, textAlign: 'right', fontSize: 11, color: '#6E6887' }}>
          Ultima atualizacao: {lastUpdate.toLocaleString('pt-BR')}
        </div>
      )}
    </div>
  )
}
