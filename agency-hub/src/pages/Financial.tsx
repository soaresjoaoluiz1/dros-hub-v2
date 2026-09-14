import { useState, useEffect } from 'react'
import {
  fetchFinancialOverview, fetchFinancialDashboard, recordPayment, fetchExpenses, fetchExpenseCategories,
  createExpense, updateExpense, deleteExpense, copyRecurringExpenses, fetchDRE, formatBRL,
  fetchInstallments, createInstallment, deleteInstallment,
  fetchExtraRevenue, createExtraRevenue, deleteExtraRevenue, fetchClients,
  type FinancialOverview, type FinancialClient, type MonthlyRevenue, type ExpenseCategory, type ExpensesByCategory, type DRE,
  type Installment, type ExtraRevenue, type Client
} from '../lib/api'
import { DollarSign, AlertTriangle, CheckCircle, Clock, Plus, Trash2, TrendingUp, TrendingDown, Copy, CreditCard, Receipt, Edit3 } from 'lucide-react'
import BankSelect from '../components/BankSelect'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from 'recharts'

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
function currentMonth() { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}` }
function formatMonth(m: string) { const [y, mo] = m.split('-'); return `${MONTH_NAMES[parseInt(mo) - 1]} ${y}` }

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#130A24', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
      <p style={{ color: '#9B96B0', marginBottom: 4 }}>{label}</p>
      {payload.map((p: any) => <p key={p.name} style={{ color: p.fill || p.color || '#fff', fontWeight: 700 }}>{p.name}: {formatBRL(p.value)}</p>)}
    </div>
  )
}

type Tab = 'receita' | 'despesas' | 'parcelas' | 'extras' | 'dre'

export default function Financial() {
  const [tab, setTab] = useState<Tab>('receita')
  const [month, setMonth] = useState(currentMonth())
  const [year, setYear] = useState(new Date().getFullYear())

  // Receita state
  const [overview, setOverview] = useState<FinancialOverview | null>(null)
  const [dashboard, setDashboard] = useState<MonthlyRevenue[]>([])
  const [payModal, setPayModal] = useState<FinancialClient | null>(null)
  const [payDate, setPayDate] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payBank, setPayBank] = useState('')
  const [saving, setSaving] = useState(false)
  const [sortField, setSortField] = useState<string>('status')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Despesas state
  const [expCategories, setExpCategories] = useState<ExpenseCategory[]>([])
  const [expByCategory, setExpByCategory] = useState<ExpensesByCategory[]>([])
  const [expTotal, setExpTotal] = useState({ fixed: 0, variable: 0, total: 0 })
  const [showNewExp, setShowNewExp] = useState(false)
  const [editingExpId, setEditingExpId] = useState<number | null>(null)
  const [newExp, setNewExp] = useState({ category_id: '', description: '', amount: '', is_recurring: false, paid_at: '', bank: '' })

  // DRE state
  const [dre, setDre] = useState<DRE | null>(null)

  // Parcelas state
  const [installments, setInstallments] = useState<Installment[]>([])
  const [showNewInst, setShowNewInst] = useState(false)
  const [newInst, setNewInst] = useState({ name: '', total_amount: '', installment_count: '', start_month: '', category_id: '', bank: '' })

  // Extras state
  const [extras, setExtras] = useState<ExtraRevenue[]>([])
  const [extrasTotal, setExtrasTotal] = useState(0)
  const [clients, setClients] = useState<Client[]>([])
  const [showNewExtra, setShowNewExtra] = useState(false)
  const [newExtra, setNewExtra] = useState({ client_id: '', description: '', amount: '', paid_at: '', bank: '' })

  const [loading, setLoading] = useState(true)

  const loadReceita = async () => {
    const [ov, dash] = await Promise.all([
      fetchFinancialOverview(month).catch(() => null),
      fetchFinancialDashboard(year).catch(() => ({ months: [] }))
    ])
    setOverview(ov)
    setDashboard(dash?.months || [])
  }

  const loadDespesas = async () => {
    const [cats, exps] = await Promise.all([
      fetchExpenseCategories().catch(() => []),
      fetchExpenses(month).catch(() => ({ byCategory: [], totalFixed: 0, totalVariable: 0, total: 0 }))
    ])
    setExpCategories(cats as ExpenseCategory[])
    setExpByCategory((exps as any).byCategory || [])
    setExpTotal({ fixed: (exps as any).totalFixed || 0, variable: (exps as any).totalVariable || 0, total: (exps as any).total || 0 })
  }

  const loadDRE = async () => {
    const d = await fetchDRE(month).catch(() => null)
    setDre(d)
  }

  const loadParcelas = async () => {
    const items = await fetchInstallments().catch(() => [])
    setInstallments(items as Installment[])
  }

  const loadExtras = async () => {
    const [data, cls] = await Promise.all([
      fetchExtraRevenue(month).catch(() => ({ items: [], total: 0 })),
      fetchClients().catch(() => [])
    ])
    setExtras((data as any).items || []); setExtrasTotal((data as any).total || 0); setClients(cls as Client[])
  }

  const load = async () => {
    setLoading(true)
    await Promise.all([loadReceita(), loadDespesas(), loadDRE(), loadParcelas(), loadExtras()])
    setLoading(false)
  }

  useEffect(() => { load() }, [month, year])

  const handlePay = async () => {
    if (!payModal || !payDate || !payAmount) return
    setSaving(true)
    await recordPayment({ client_id: payModal.id, amount: parseFloat(payAmount), reference_month: month, paid_at: payDate, bank: payBank || undefined })
    setSaving(false); setPayModal(null); setPayBank(''); load()
  }

  const openPayModal = (c: FinancialClient) => {
    const today = new Date()
    setPayDate(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`)
    setPayAmount(String(c.total_due)); setPayModal(c)
  }

  const handleAddExpense = async () => {
    if (!newExp.category_id || !newExp.amount) return
    const refMonth = newExp.paid_at ? newExp.paid_at.slice(0, 7) : month
    if (editingExpId) {
      await updateExpense(editingExpId, { category_id: +newExp.category_id, description: newExp.description, amount: parseFloat(newExp.amount), paid_at: newExp.paid_at || null, reference_month: refMonth, bank: newExp.bank || null })
    } else {
      await createExpense({ category_id: +newExp.category_id, description: newExp.description, amount: parseFloat(newExp.amount), reference_month: refMonth, is_recurring: newExp.is_recurring, paid_at: newExp.paid_at || undefined, bank: newExp.bank || undefined })
    }
    setShowNewExp(false); setEditingExpId(null); setNewExp({ category_id: '', description: '', amount: '', is_recurring: false, paid_at: '', bank: '' }); load()
  }

  const openEditExpense = (e: any) => {
    setEditingExpId(e.id)
    setNewExp({
      category_id: String(e.category_id),
      description: e.description || '',
      amount: String(e.amount),
      is_recurring: e.is_recurring === 1,
      paid_at: e.paid_at || '',
      bank: e.bank || '',
    })
    setShowNewExp(true)
  }

  const handleDeleteExpense = async (id: number) => {
    if (!confirm('Remover esta despesa?')) return
    await deleteExpense(id); load()
  }

  const handleAddInstallment = async () => {
    if (!newInst.name || !newInst.total_amount || !newInst.installment_count || !newInst.start_month) return
    await createInstallment({ name: newInst.name, total_amount: parseFloat(newInst.total_amount), installment_count: parseInt(newInst.installment_count), start_month: newInst.start_month, category_id: newInst.category_id ? +newInst.category_id : undefined, bank: newInst.bank || undefined })
    setShowNewInst(false); setNewInst({ name: '', total_amount: '', installment_count: '', start_month: '', category_id: '', bank: '' }); load()
  }

  const handleDeleteInstallment = async (id: number) => {
    if (!confirm('Remover parcelamento e todas as parcelas associadas?')) return
    await deleteInstallment(id); load()
  }

  const handleAddExtra = async () => {
    if (!newExtra.description || !newExtra.amount) return
    const refMonth = newExtra.paid_at ? newExtra.paid_at.slice(0, 7) : month
    await createExtraRevenue({ client_id: newExtra.client_id ? +newExtra.client_id : undefined, description: newExtra.description, amount: parseFloat(newExtra.amount), reference_month: refMonth, paid_at: newExtra.paid_at || undefined, bank: newExtra.bank || undefined })
    setShowNewExtra(false); setNewExtra({ client_id: '', description: '', amount: '', paid_at: '', bank: '' }); load()
  }

  const handleDeleteExtra = async (id: number) => {
    if (!confirm('Remover esta receita extra?')) return
    await deleteExtraRevenue(id); load()
  }

  const handleCopyRecurring = async () => {
    const [y, m] = month.split('-').map(Number)
    const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
    const result = await copyRecurringExpenses(prevMonth, month) as any
    alert(`${result.copied} despesas recorrentes copiadas de ${formatMonth(prevMonth)}`)
    load()
  }

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }
  const sortedClients = [...(overview?.clients || [])].filter(c => c.monthly_fee > 0).sort((a: any, b: any) => {
    const order = { late: 0, pending: 1, paid: 2 }
    let va: any, vb: any
    if (sortField === 'status') { va = order[a.status]; vb = order[b.status] }
    else if (sortField === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase() }
    else { va = a[sortField] || 0; vb = b[sortField] || 0 }
    return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
  })
  const SortHead = ({ field, children, right }: { field: string; children: any; right?: boolean }) => (
    <th className={right ? 'right' : ''} style={{ cursor: 'pointer' }} onClick={() => toggleSort(field)}>
      {children} {sortField === field && <span style={{ color: '#FFB300', fontSize: 10 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  )

  const s = overview?.summary
  const chartData = dashboard.map((d: any) => ({ name: MONTH_NAMES[parseInt(d.month.split('-')[1]) - 1], Receita: d.revenue, Despesas: d.expenses }))

  const monthOptions: string[] = []
  const now = new Date()
  for (let i = -12; i <= 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    monthOptions.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  if (loading && !overview) return <div className="loading-container"><div className="spinner" /><span>Carregando financeiro...</span></div>

  return (
    <div>
      <div className="page-header">
        <h1><DollarSign size={22} style={{ marginRight: 8 }} /> Financeiro</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="select" style={{ width: 160 }} value={month} onChange={e => setMonth(e.target.value)}>
            {monthOptions.map(m => <option key={m} value={m}>{formatMonth(m)}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        <button className={`btn btn-sm ${tab === 'receita' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('receita')}>Receita</button>
        <button className={`btn btn-sm ${tab === 'extras' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('extras')}><Receipt size={12} /> Receitas Extras</button>
        <button className={`btn btn-sm ${tab === 'despesas' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('despesas')}>Despesas</button>
        <button className={`btn btn-sm ${tab === 'parcelas' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('parcelas')}><CreditCard size={12} /> Parcelas</button>
        <button className={`btn btn-sm ${tab === 'dre' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('dre')}>DRE</button>
      </div>

      {/* ========== RECEITA TAB ========== */}
      {tab === 'receita' && <>
        {s && (
          <div className="metrics-grid" style={{ marginBottom: 20 }}>
            <div className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#6B6580', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Previsto</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-heading)' }}>{formatBRL(s.expected)}</div>
            </div>
            <div className="card" style={{ textAlign: 'center', borderColor: 'rgba(52,199,89,0.2)' }}>
              <div style={{ fontSize: 11, color: '#34C759', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Recebido</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-heading)', color: '#34C759' }}>{formatBRL(s.received)}</div>
              {(s.received_extra ?? 0) > 0 && (
                <div style={{ fontSize: 10, color: '#6B6580', marginTop: 6, lineHeight: 1.4 }}>
                  Mensalidades: {formatBRL(s.received_recurring ?? 0)}<br />
                  Extras: <span style={{ color: '#34C759' }}>{formatBRL(s.received_extra ?? 0)}</span>
                </div>
              )}
            </div>
            <div className="card" style={{ textAlign: 'center', borderColor: 'rgba(251,188,4,0.2)' }}>
              <div style={{ fontSize: 11, color: '#FBBC04', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Pendente</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-heading)', color: '#FBBC04' }}>{formatBRL(s.pending)}</div>
            </div>
            <div className="card" style={{ textAlign: 'center', borderColor: 'rgba(255,107,107,0.2)' }}>
              <div style={{ fontSize: 11, color: '#FF6B6B', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Atrasado ({s.lateCount})</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-heading)', color: '#FF6B6B' }}>{formatBRL(s.late)}</div>
            </div>
          </div>
        )}

        <section className="dash-section" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="section-title" style={{ margin: 0 }}>Receita vs Despesas</div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setYear(y => y - 1)}>&larr;</button>
              <span style={{ padding: '4px 12px', fontSize: 13, color: '#A8A3B8' }}>{year}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setYear(y => y + 1)}>&rarr;</button>
            </div>
          </div>
          <div className="card" style={{ padding: 20 }}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="name" tick={{ fill: '#6B6580', fontSize: 11 }} />
                <YAxis tick={{ fill: '#6B6580', fontSize: 11 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="Receita" fill="#34C759" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Despesas" fill="#FF6B6B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8 }}>
              <span style={{ fontSize: 11, color: '#34C759', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#34C759' }} /> Receita</span>
              <span style={{ fontSize: 11, color: '#FF6B6B', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#FF6B6B' }} /> Despesas</span>
            </div>
          </div>
        </section>

        <section className="dash-section">
          <div className="section-title">Clientes — {formatMonth(month)}</div>
          <div className="table-card">
            <div style={{ overflowX: 'auto' }}>
              <table className="campaign-table">
                <thead><tr><SortHead field="name">Cliente</SortHead><SortHead field="monthly_fee" right>Mensalidade</SortHead><SortHead field="payment_day" right>Venc.</SortHead><SortHead field="status">Status</SortHead><SortHead field="days_late" right>Atraso</SortHead><SortHead field="penalty" right>Multa</SortHead><SortHead field="total_due" right>Total</SortHead><th className="right">Pago em</th><th>Banco</th><th></th></tr></thead>
                <tbody>
                  {sortedClients.map(c => (
                    <tr key={c.id} style={{ background: c.status === 'late' ? 'rgba(255,107,107,0.03)' : undefined }}>
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      <td className="right">{formatBRL(c.monthly_fee)}</td>
                      <td className="right">{c.payment_day}</td>
                      <td>
                        {c.status === 'paid' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 6, background: 'rgba(52,199,89,0.12)', color: '#34C759', fontSize: 11, fontWeight: 700 }}><CheckCircle size={10} /> Pago</span>}
                        {c.status === 'pending' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 6, background: 'rgba(251,188,4,0.12)', color: '#FBBC04', fontSize: 11, fontWeight: 700 }}><Clock size={10} /> Pendente</span>}
                        {c.status === 'late' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 6, background: 'rgba(255,107,107,0.12)', color: '#FF6B6B', fontSize: 11, fontWeight: 700 }}><AlertTriangle size={10} /> Atrasado</span>}
                      </td>
                      <td className="right" style={{ color: c.days_late > 0 ? '#FF6B6B' : '#6B6580' }}>{c.days_late > 0 ? `${c.days_late}d` : '-'}</td>
                      <td className="right" style={{ color: c.penalty > 0 ? '#FF6B6B' : '#6B6580' }}>{c.penalty > 0 ? formatBRL(c.penalty) : '-'}</td>
                      <td className="right" style={{ fontWeight: 700, color: c.status === 'late' ? '#FF6B6B' : '#A8A3B8' }}>{formatBRL(c.total_due)}</td>
                      <td className="right" style={{ color: '#6B6580', fontSize: 12 }}>{c.paid_at || '-'}</td>
                      <td style={{ fontSize: 11, color: '#5DADE2' }}>{c.bank || '-'}</td>
                      <td className="right">{c.status !== 'paid' ? <button className="btn btn-primary btn-sm" onClick={() => openPayModal(c)} style={{ fontSize: 11, padding: '4px 10px' }}>Pagar</button> : <span style={{ fontSize: 11, color: '#34C759' }}>&#10003;</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </>}

      {/* ========== DESPESAS TAB ========== */}
      {tab === 'despesas' && <>
        <div className="metrics-grid" style={{ marginBottom: 20, gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#6B6580', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Fixas</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-heading)', color: '#FFAA83' }}>{formatBRL(expTotal.fixed)}</div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#6B6580', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Variaveis</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-heading)', color: '#9B59B6' }}>{formatBRL(expTotal.variable)}</div>
          </div>
          <div className="card" style={{ textAlign: 'center', borderColor: 'rgba(255,107,107,0.2)' }}>
            <div style={{ fontSize: 11, color: '#FF6B6B', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Total Despesas</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-heading)', color: '#FF6B6B' }}>{formatBRL(expTotal.total)}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className="btn btn-primary btn-sm" onClick={() => { const t = new Date(); setEditingExpId(null); setNewExp({ category_id: '', description: '', amount: '', is_recurring: false, paid_at: `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`, bank: '' }); setShowNewExp(true) }}><Plus size={14} /> Nova Despesa</button>
          <button className="btn btn-secondary btn-sm" onClick={handleCopyRecurring}><Copy size={14} /> Copiar Recorrentes do Mes Anterior</button>
        </div>

        {expByCategory.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 40, color: '#6B6580' }}>Nenhuma despesa cadastrada para {formatMonth(month)}.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {expByCategory.map(cat => (
              <div key={cat.name} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: cat.color }} />
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{cat.name}</span>
                    <span style={{ fontSize: 11, color: '#6B6580', padding: '2px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 4 }}>{cat.type === 'fixed' ? 'Fixa' : 'Variavel'}</span>
                  </div>
                  <span style={{ fontWeight: 700, color: '#FF6B6B' }}>{formatBRL(cat.total)}</span>
                </div>
                {cat.items.map(e => (
                  <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.04)', fontSize: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: '#A8A3B8' }}>{e.description || '-'}</span>
                      {e.is_recurring === 1 && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'rgba(93,173,226,0.12)', color: '#5DADE2' }}>RECORRENTE</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {e.bank && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(93,173,226,0.10)', color: '#5DADE2', fontWeight: 600 }}>{e.bank}</span>}
                      <span style={{ color: '#6B6580', fontSize: 11 }}>{e.paid_at || '-'}</span>
                      <span style={{ fontWeight: 600 }}>{formatBRL(e.amount)}</span>
                      <button onClick={() => openEditExpense(e)} title="Editar" style={{ background: 'transparent', border: 'none', color: '#6B6580', cursor: 'pointer', padding: 4 }}><Edit3 size={12} /></button>
                      <button onClick={() => handleDeleteExpense(e.id)} title="Apagar" style={{ background: 'transparent', border: 'none', color: '#6B6580', cursor: 'pointer', padding: 4 }}><Trash2 size={12} /></button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </>}

      {/* ========== PARCELAS TAB ========== */}
      {tab === 'parcelas' && <>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className="btn btn-primary btn-sm" onClick={() => { setNewInst(p => ({ ...p, start_month: month })); setShowNewInst(true) }}><Plus size={14} /> Novo Parcelamento</button>
        </div>
        {installments.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 40, color: '#6B6580' }}>Nenhum parcelamento cadastrado.</div>
        ) : (
          <div className="table-card"><div style={{ overflowX: 'auto' }}>
            <table className="campaign-table">
              <thead><tr><th>Nome</th><th className="right">Total</th><th className="right">Parcelas</th><th className="right">Valor Parcela</th><th>Inicio</th><th>Fim</th><th>Categoria</th><th></th></tr></thead>
              <tbody>
                {installments.map(inst => {
                  const [y, m] = inst.start_month.split('-').map(Number)
                  const endDate = new Date(y, m - 1 + inst.installment_count - 1, 1)
                  const endMonth = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`
                  return (
                    <tr key={inst.id}>
                      <td style={{ fontWeight: 600 }}>{inst.name}</td>
                      <td className="right">{formatBRL(inst.total_amount)}</td>
                      <td className="right">{inst.installment_count}x</td>
                      <td className="right" style={{ fontWeight: 600, color: '#FF6B6B' }}>{formatBRL(inst.installment_amount)}</td>
                      <td>{formatMonth(inst.start_month)}</td>
                      <td>{formatMonth(endMonth)}</td>
                      <td>{inst.category_name ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: inst.category_color }} />{inst.category_name}</span> : '-'}</td>
                      <td className="right"><button onClick={() => handleDeleteInstallment(inst.id)} style={{ background: 'transparent', border: 'none', color: '#FF6B6B', cursor: 'pointer' }}><Trash2 size={14} /></button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div></div>
        )}
      </>}

      {/* ========== EXTRAS TAB ========== */}
      {tab === 'extras' && <>
        <div className="metrics-grid" style={{ marginBottom: 20, gridTemplateColumns: '1fr' }}>
          <div className="card" style={{ textAlign: 'center', borderColor: 'rgba(52,199,89,0.2)' }}>
            <div style={{ fontSize: 11, color: '#34C759', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Total Receitas Extras — {formatMonth(month)}</div>
            <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-heading)', color: '#34C759' }}>{formatBRL(extrasTotal)}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNewExtra(true)}><Plus size={14} /> Nova Receita Extra</button>
        </div>

        {extras.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 40, color: '#6B6580' }}>Nenhuma receita extra em {formatMonth(month)}.</div>
        ) : (
          <div className="table-card"><div style={{ overflowX: 'auto' }}>
            <table className="campaign-table">
              <thead><tr><th>Descricao</th><th>Cliente</th><th className="right">Valor</th><th>Pago em</th><th>Banco</th><th></th></tr></thead>
              <tbody>
                {extras.map(e => (
                  <tr key={e.id}>
                    <td style={{ fontWeight: 600 }}>{e.description}</td>
                    <td style={{ color: '#9B96B0' }}>{e.client_name || '-'}</td>
                    <td className="right" style={{ fontWeight: 700, color: '#34C759' }}>{formatBRL(e.amount)}</td>
                    <td style={{ color: '#6B6580', fontSize: 12 }}>{e.paid_at || '-'}</td>
                    <td style={{ fontSize: 11, color: '#5DADE2' }}>{e.bank || '-'}</td>
                    <td className="right"><button onClick={() => handleDeleteExtra(e.id)} style={{ background: 'transparent', border: 'none', color: '#FF6B6B', cursor: 'pointer' }}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        )}
      </>}

      {/* ========== DRE TAB ========== */}
      {tab === 'dre' && dre && <>
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>DRE — {formatMonth(month)}</h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', fontWeight: 700, fontSize: 15 }}>
              <span style={{ color: '#34C759' }}>RECEITA BRUTA</span>
              <span style={{ color: '#34C759' }}>{formatBRL(dre.revenue)}</span>
            </div>
            {(dre as any).mensalidades > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 6px 16px', fontSize: 13, color: '#A8A3B8' }}><span>Mensalidades</span><span>{formatBRL((dre as any).mensalidades)}</span></div>}
            {(dre as any).extraRevenue > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 6px 16px', fontSize: 13, color: '#A8A3B8' }}><span>Receitas Extras</span><span>{formatBRL((dre as any).extraRevenue)}</span></div>}

            <div style={{ padding: '8px 0 4px', fontSize: 11, color: '#6B6580', textTransform: 'uppercase', letterSpacing: 1, marginTop: 12 }}>Despesas Fixas</div>
            {dre.categories.filter(c => c.type === 'fixed').map(c => (
              <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 8px 16px', borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: 13 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: c.color }} />{c.name}</span>
                <span style={{ color: '#FF6B6B' }}>- {formatBRL(c.total)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontWeight: 600, fontSize: 13, color: '#FFAA83' }}>
              <span>Total Fixas</span><span>- {formatBRL(dre.totalFixed)}</span>
            </div>

            <div style={{ padding: '8px 0 4px', fontSize: 11, color: '#6B6580', textTransform: 'uppercase', letterSpacing: 1, marginTop: 8 }}>Despesas Variaveis</div>
            {dre.categories.filter(c => c.type === 'variable').map(c => (
              <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 8px 16px', borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: 13 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: c.color }} />{c.name}</span>
                <span style={{ color: '#FF6B6B' }}>- {formatBRL(c.total)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontWeight: 600, fontSize: 13, color: '#9B59B6' }}>
              <span>Total Variaveis</span><span>- {formatBRL(dre.totalVariable)}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderTop: '2px solid rgba(255,255,255,0.08)', marginTop: 12, fontWeight: 700, fontSize: 13 }}>
              <span style={{ color: '#FF6B6B' }}>TOTAL DESPESAS</span>
              <span style={{ color: '#FF6B6B' }}>- {formatBRL(dre.totalExpenses)}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 0', borderTop: '2px solid rgba(255,255,255,0.12)', marginTop: 4, fontWeight: 800, fontSize: 18, fontFamily: 'var(--font-heading)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                RESULTADO
                {dre.profit >= 0 ? <TrendingUp size={18} style={{ color: '#34C759' }} /> : <TrendingDown size={18} style={{ color: '#FF6B6B' }} />}
              </span>
              <span style={{ color: dre.profit >= 0 ? '#34C759' : '#FF6B6B' }}>{formatBRL(dre.profit)}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 13, color: '#6B6580' }}>
              <span>Margem</span>
              <span style={{ color: dre.margin >= 20 ? '#34C759' : dre.margin >= 0 ? '#FBBC04' : '#FF6B6B', fontWeight: 700 }}>{dre.margin}%</span>
            </div>
          </div>
        </div>

        {/* Pie chart */}
        {dre.categories.length > 0 && (
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Distribuicao de Despesas</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={dre.categories} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} style={{ fontSize: 10 }}>
                  {dre.categories.map((c, i) => <Cell key={i} fill={c.color} />)}
                </Pie>
                <Tooltip content={<ChartTip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </>}

      {/* ========== MODALS ========== */}

      {/* Pay Modal */}
      {payModal && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setPayModal(null))() }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <h2>Registrar Pagamento</h2>
            <p style={{ color: '#9B96B0', fontSize: 13, marginBottom: 16 }}>{payModal.name} — {formatMonth(month)}</p>
            <div className="form-group"><label>Valor (R$)</label><input className="input" type="number" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} /></div>
            <div className="form-group"><label>Data do Pagamento</label><input className="input" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} /></div>
            <div className="form-group"><label>Banco (opcional)</label><BankSelect value={payBank} onChange={setPayBank} /></div>
            {payModal.penalty > 0 && <div style={{ padding: '8px 12px', background: 'rgba(255,107,107,0.08)', borderRadius: 8, fontSize: 12, color: '#FF6B6B', marginBottom: 12 }}><AlertTriangle size={12} /> Multa: {formatBRL(payModal.penalty)} ({payModal.days_late} dias)</div>}
            <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setPayModal(null)}>Cancelar</button><button className="btn btn-primary" onClick={handlePay} disabled={saving}>{saving ? 'Salvando...' : 'Confirmar'}</button></div>
          </div>
        </div>
      )}

      {/* New Installment Modal */}
      {showNewInst && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setShowNewInst(false))() }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 450 }}>
            <h2>Novo Parcelamento</h2>
            <div className="form-group"><label>Nome</label><input className="input" value={newInst.name} onChange={e => setNewInst(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Camera Sony A7III, Notebook Dell..." /></div>
            <div className="form-row">
              <div className="form-group"><label>Valor Total (R$)</label><input className="input" type="number" step="0.01" value={newInst.total_amount} onChange={e => setNewInst(p => ({ ...p, total_amount: e.target.value }))} /></div>
              <div className="form-group"><label>Parcelas</label><input className="input" type="number" value={newInst.installment_count} onChange={e => setNewInst(p => ({ ...p, installment_count: e.target.value }))} placeholder="12" /></div>
            </div>
            {newInst.total_amount && newInst.installment_count && <p style={{ fontSize: 13, color: '#FFB300', marginBottom: 12 }}>Parcela: {formatBRL(parseFloat(newInst.total_amount) / parseInt(newInst.installment_count || '1'))}/mes</p>}
            <div className="form-row">
              <div className="form-group"><label>Mes Inicio</label><input className="input" type="month" value={newInst.start_month} onChange={e => setNewInst(p => ({ ...p, start_month: e.target.value }))} /></div>
              <div className="form-group"><label>Categoria</label>
                <select className="select" value={newInst.category_id} onChange={e => setNewInst(p => ({ ...p, category_id: e.target.value }))}>
                  <option value="">Emprestimos/Parcelas</option>
                  {expCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group"><label>Banco (opcional)</label><BankSelect value={newInst.bank} onChange={v => setNewInst(p => ({ ...p, bank: v }))} /></div>
            <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setShowNewInst(false)}>Cancelar</button><button className="btn btn-primary" onClick={handleAddInstallment}>Criar Parcelamento</button></div>
          </div>
        </div>
      )}

      {/* New Extra Revenue Modal */}
      {showNewExtra && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setShowNewExtra(false))() }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 450 }}>
            <h2>Nova Receita Extra — {formatMonth(month)}</h2>
            <div className="form-group"><label>Cliente (opcional)</label>
              <select className="select" value={newExtra.client_id} onChange={e => setNewExtra(p => ({ ...p, client_id: e.target.value }))}>
                <option value="">Sem cliente</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Descricao</label><input className="input" value={newExtra.description} onChange={e => setNewExtra(p => ({ ...p, description: e.target.value }))} placeholder="Ex: Criacao de site, servico extra, consultoria..." /></div>
            <div className="form-row">
              <div className="form-group"><label>Valor (R$)</label><input className="input" type="number" step="0.01" value={newExtra.amount} onChange={e => setNewExtra(p => ({ ...p, amount: e.target.value }))} /></div>
              <div className="form-group"><label>Data Pagamento</label><input className="input" type="date" value={newExtra.paid_at} onChange={e => setNewExtra(p => ({ ...p, paid_at: e.target.value }))} /></div>
            </div>
            <div className="form-group"><label>Banco (opcional)</label><BankSelect value={newExtra.bank} onChange={v => setNewExtra(p => ({ ...p, bank: v }))} /></div>
            <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setShowNewExtra(false)}>Cancelar</button><button className="btn btn-primary" onClick={handleAddExtra}>Adicionar</button></div>
          </div>
        </div>
      )}

      {/* New / Edit Expense Modal */}
      {showNewExp && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => { setShowNewExp(false); setEditingExpId(null) })() }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 450 }}>
            <h2>{editingExpId ? 'Editar Despesa' : `Nova Despesa — ${formatMonth(month)}`}</h2>
            <div className="form-group"><label>Categoria</label>
              <select className="select" value={newExp.category_id} onChange={e => setNewExp(p => ({ ...p, category_id: e.target.value }))}>
                <option value="">Selecione</option>
                {expCategories.map(c => <option key={c.id} value={c.id}>{c.name} ({c.type === 'fixed' ? 'Fixa' : 'Variavel'})</option>)}
              </select>
            </div>
            <div className="form-group"><label>Descricao</label><input className="input" value={newExp.description} onChange={e => setNewExp(p => ({ ...p, description: e.target.value }))} placeholder="Ex: Salario Graziele, Adobe CC..." /></div>
            <div className="form-row">
              <div className="form-group"><label>Valor (R$)</label><input className="input" type="number" step="0.01" value={newExp.amount} onChange={e => setNewExp(p => ({ ...p, amount: e.target.value }))} /></div>
              <div className="form-group"><label>Data do Pagamento</label><input className="input" type="date" value={newExp.paid_at} onChange={e => setNewExp(p => ({ ...p, paid_at: e.target.value }))} /></div>
            </div>
            <div className="form-group"><label>Banco (opcional)</label><BankSelect value={newExp.bank} onChange={v => setNewExp(p => ({ ...p, bank: v }))} /></div>
            {!editingExpId && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#A8A3B8', cursor: 'pointer', marginBottom: 16 }}>
                <input type="checkbox" checked={newExp.is_recurring} onChange={e => setNewExp(p => ({ ...p, is_recurring: e.target.checked }))} />
                Despesa recorrente (copiar automaticamente pro proximo mes)
              </label>
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowNewExp(false); setEditingExpId(null) }}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleAddExpense}>{editingExpId ? 'Salvar' : 'Adicionar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
