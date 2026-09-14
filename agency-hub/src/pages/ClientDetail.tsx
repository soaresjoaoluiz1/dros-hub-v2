import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { fetchClient, updateClient, fetchClientCredentials, createClientCredential, updateClientCredential, deleteClientCredential, fetchClientOnboard, fetchServices, fetchClientServices, updateClientServices, apiFetch, generateApprovalToken, revokeApprovalToken, type Client, type ClientCredential, type User as UserT, type Service, type ClientService } from '../lib/api'
import { ArrowLeft, Building2, ExternalLink, Plus, Edit3, Save, X, Trash2, Eye, EyeOff, Key, Users, Lock, ClipboardCopy, FileText, CheckCircle, Briefcase, BarChart3 } from 'lucide-react'
import CoreAccountSelect from '../components/CoreAccountSelect'
import PerformanceArea from '../components/performance/PerformanceArea'

const PLATFORMS = ['Facebook', 'Instagram', 'Google Ads', 'Google Analytics', 'Google Meu Negocio', 'Meta Business', 'TikTok', 'LinkedIn', 'YouTube', 'Twitter/X', 'Pinterest', 'Kiwify', 'Hotmart', 'RD Station', 'Outro']

function PerformanceTab({ client, onGoToInfo }: { client: any; onGoToInfo: () => void }) {
  const hasAny = client?.core_meta_account_id || client?.core_ig_page_id || client?.core_gads_customer_id || client?.core_ga4_property_id
  if (!hasAny) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40, color: '#9B96B0' }}>
        <BarChart3 size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6, color: '#F2F0F7' }}>Nenhuma plataforma vinculada</h3>
        <p style={{ fontSize: 13, marginBottom: 14 }}>
          Vincule pelo menos uma conta (Meta, Instagram, Google Ads ou GA4) na<br />
          secao <strong>"Vinculos do Painel de Performance"</strong> dos dados do cliente.
        </p>
        <button className="btn btn-secondary btn-sm" onClick={onGoToInfo}>Ir pra Dados</button>
      </div>
    )
  }
  return (
    <div>
      <div style={{ fontSize: 12, color: '#9B96B0', marginBottom: 12 }}>
        Painel de <strong style={{ color: '#FFB300' }}>{client.core_client_name || client.name}</strong>
      </div>
      <PerformanceArea
        accountIdHint={client.core_meta_account_id || undefined}
        accountNameHint={client.core_client_name}
        availablePlatforms={{
          meta: !!client.core_meta_account_id,
          ig: !!client.core_ig_page_id,
          gads: !!client.core_gads_customer_id,
          ga4: !!client.core_ga4_property_id,
        }}
      />
    </div>
  )
}

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [client, setClient] = useState<Client | null>(null)
  const [credentials, setCredentials] = useState<ClientCredential[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState<any>({})
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<'info' | 'credentials' | 'users' | 'services' | 'onboard' | 'performance'>(() => {
    const t = searchParams.get('tab')
    return (t === 'performance' || t === 'credentials' || t === 'users' || t === 'services' || t === 'onboard') ? t : 'info'
  })
  const [clientUsers, setClientUsers] = useState<any[]>([])
  const [resetPassId, setResetPassId] = useState<number | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [showNewCred, setShowNewCred] = useState(false)
  const [newCred, setNewCred] = useState({ platform: '', login: '', password: '', observation: '' })
  const [showPasswords, setShowPasswords] = useState<Set<number>>(new Set())
  const [editCredId, setEditCredId] = useState<number | null>(null)
  const [editCredData, setEditCredData] = useState<any>({})
  const [onboardEntries, setOnboardEntries] = useState<any[]>([])
  const [allServices, setAllServices] = useState<Service[]>([])
  const [clientSvcs, setClientSvcs] = useState<{ id: number; config: Record<string, string> }[]>([])
  const [servicesLoaded, setServicesLoaded] = useState(false)
  const [onboardLoading, setOnboardLoading] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [approvalCopied, setApprovalCopied] = useState(false)
  const [approvalLoading, setApprovalLoading] = useState(false)

  const load = async () => {
    if (!id) return
    setLoading(true)
    try {
      const data = await fetchClient(+id)
      setClient(data.client); setCredentials((data as any).credentials || []); setClientUsers((data as any).users || [])
      setEditData({
        name: data.client.name,
        contact_name: data.client.contact_name || '',
        contact_email: data.client.contact_email || '',
        contact_phone: (data.client as any).contact_phone || '',
        drive_folder: (data.client as any).drive_folder || '',
        monthly_fee: (data.client as any).monthly_fee || 0,
        payment_day: (data.client as any).payment_day || 10,
        core_client_name: (data.client as any).core_client_name || '',
        core_meta_account_id: (data.client as any).core_meta_account_id || '',
        core_ig_page_id: (data.client as any).core_ig_page_id || '',
        core_gads_customer_id: (data.client as any).core_gads_customer_id || '',
        core_ga4_property_id: (data.client as any).core_ga4_property_id || '',
      })
    } catch {} finally { setLoading(false) }
  }
  useEffect(() => { load() }, [id])

  const handleSave = async () => { if (id) { await updateClient(+id, editData); setEditing(false); load() } }

  const handleCreateCred = async () => {
    if (!id || !newCred.platform || !newCred.login || !newCred.password) return
    await createClientCredential(+id, newCred)
    setShowNewCred(false); setNewCred({ platform: '', login: '', password: '', observation: '' }); load()
  }

  const handleSaveCred = async () => {
    if (!id || !editCredId) return
    await updateClientCredential(+id, editCredId, editCredData)
    setEditCredId(null); load()
  }

  const handleDeleteCred = async (credId: number) => {
    if (!id || !confirm('Remover este acesso?')) return
    await deleteClientCredential(+id, credId); load()
  }

  const togglePass = (credId: number) => setShowPasswords(prev => { const n = new Set(prev); n.has(credId) ? n.delete(credId) : n.add(credId); return n })

  const loadOnboard = async () => {
    if (!id || onboardEntries.length > 0) return
    setOnboardLoading(true)
    try {
      const res = await fetchClientOnboard(+id)
      setOnboardEntries(res.entries || [])
    } catch {} finally { setOnboardLoading(false) }
  }

  const loadServices = async () => {
    if (!id || servicesLoaded) return
    const [all, mine] = await Promise.all([fetchServices(), fetchClientServices(+id)])
    setAllServices(all); setClientSvcs(mine.map(s => ({ id: s.id, config: s.config || {} }))); setServicesLoaded(true)
  }
  const toggleService = async (sid: number) => {
    const exists = clientSvcs.find(s => s.id === sid)
    const next = exists ? clientSvcs.filter(s => s.id !== sid) : [...clientSvcs, { id: sid, config: {} }]
    setClientSvcs(next)
    await updateClientServices(+id!, next)
  }
  const updateSvcConfig = async (sid: number, key: string, val: string) => {
    const next = clientSvcs.map(s => s.id === sid ? { ...s, config: { ...s.config, [key]: val } } : s)
    setClientSvcs(next)
    await updateClientServices(+id!, next)
  }

  const onboardLink = client ? `${window.location.origin}${import.meta.env.BASE_URL}onboard/${(client as any).onboard_token}` : ''
  const copyLink = () => { navigator.clipboard.writeText(onboardLink); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000) }

  const approvalToken = (client as any)?.approval_token as string | null
  const approvalLink = approvalToken ? `${window.location.origin}${import.meta.env.BASE_URL}approvals/${approvalToken}` : ''
  const copyApprovalLink = () => { navigator.clipboard.writeText(approvalLink); setApprovalCopied(true); setTimeout(() => setApprovalCopied(false), 2000) }
  const handleGenerateApprovalToken = async () => {
    if (!id) return
    setApprovalLoading(true)
    try {
      await generateApprovalToken(+id)
      const data = await fetchClient(+id)
      setClient(data.client)
    } catch {} finally { setApprovalLoading(false) }
  }
  const handleRevokeApprovalToken = async () => {
    if (!id) return
    if (!confirm('Revogar o link? O cliente nao podera mais acessar essa URL.')) return
    setApprovalLoading(true)
    try {
      await revokeApprovalToken(+id)
      const data = await fetchClient(+id)
      setClient(data.client)
    } catch {} finally { setApprovalLoading(false) }
  }
  const shareApprovalWhatsApp = () => {
    const phone = (client as any)?.contact_phone?.replace(/\D/g, '') || ''
    const text = encodeURIComponent(`Ola ${client?.contact_name || ''}! Aqui esta o link para voce aprovar as tarefas: ${approvalLink}`)
    window.open(`https://wa.me/${phone}?text=${text}`, '_blank')
  }

  if (loading) return <div className="loading-container"><div className="spinner" /></div>
  if (!client) return <div className="empty-state"><h3>Cliente nao encontrado</h3></div>

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary btn-icon" onClick={() => navigate('/clients')}><ArrowLeft size={16} /></button>
          <h1><Building2 size={22} style={{ marginRight: 8 }} />{client.name}</h1>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`btn btn-sm ${activeTab === 'info' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('info')}>Dados</button>
          <button className={`btn btn-sm ${activeTab === 'credentials' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('credentials')}><Key size={12} /> Acessos ({credentials.length})</button>
          <button className={`btn btn-sm ${activeTab === 'users' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('users')}><Users size={12} /> Usuarios ({clientUsers.length})</button>
          <button className={`btn btn-sm ${activeTab === 'services' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setActiveTab('services'); loadServices() }}><Briefcase size={12} /> Servicos</button>
          <button className={`btn btn-sm ${activeTab === 'onboard' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setActiveTab('onboard'); loadOnboard() }}><FileText size={12} /> Onboard</button>
          <button className={`btn btn-sm ${activeTab === 'performance' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('performance')}><BarChart3 size={12} /> Performance</button>
        </div>
      </div>

      {/* Info tab */}
      {activeTab === 'info' && (
        <div className="card">
          {!editing ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}><button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}><Edit3 size={12} /> Editar</button></div>
              <div className="lead-info">
                <div className="lead-info-row"><span className="lead-info-label">Nome</span><span className="lead-info-value">{client.name}</span></div>
                <div className="lead-info-row"><span className="lead-info-label">Contato</span><span className="lead-info-value">{client.contact_name || '-'}</span></div>
                <div className="lead-info-row"><span className="lead-info-label">Email</span><span className="lead-info-value">{client.contact_email || '-'}</span></div>
                <div className="lead-info-row"><span className="lead-info-label">Telefone</span><span className="lead-info-value">{(client as any).contact_phone || '-'}</span></div>
                <div className="lead-info-row"><span className="lead-info-label">Pasta do Drive</span><span className="lead-info-value">
                  {(client as any).drive_folder ? <a href={(client as any).drive_folder} target="_blank" rel="noopener noreferrer" style={{ color: '#5DADE2', display: 'flex', alignItems: 'center', gap: 4 }}><ExternalLink size={12} /> Abrir Pasta</a> : '-'}
                </span></div>
                {(client as any).monthly_fee > 0 && <div className="lead-info-row"><span className="lead-info-label">Mensalidade</span><span className="lead-info-value" style={{ color: '#FFB300', fontWeight: 600 }}>R$ {((client as any).monthly_fee || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>}
                {(client as any).payment_day > 0 && <div className="lead-info-row"><span className="lead-info-label">Dia Vencimento</span><span className="lead-info-value">Dia {(client as any).payment_day}</span></div>}
              </div>

              {/* Link de Aprovacao Publica */}
              <div style={{ marginTop: 20, padding: '14px 16px', background: 'linear-gradient(135deg, rgba(52,199,89,0.06), rgba(52,199,89,0.02))', border: '1px solid rgba(52,199,89,0.2)', borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#34C759', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  🔗 Link de Aprovacao Publica
                </div>
                <p style={{ fontSize: 12, color: '#9B96B0', marginBottom: 10 }}>O cliente acessa este link sem login e aprova as tarefas pendentes diretamente.</p>
                {approvalToken ? (
                  <>
                    <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, fontSize: 11, color: '#A8A3B8', wordBreak: 'break-all', fontFamily: 'monospace', marginBottom: 10 }}>
                      {approvalLink}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-primary btn-sm" onClick={copyApprovalLink}>
                        📋 {approvalCopied ? 'Copiado!' : 'Copiar Link'}
                      </button>
                      {(client as any).contact_phone && (
                        <button className="btn btn-secondary btn-sm" style={{ background: '#25D366', color: '#fff', border: 'none' }} onClick={shareApprovalWhatsApp}>
                          💬 Enviar pelo WhatsApp
                        </button>
                      )}
                      <button className="btn btn-secondary btn-sm" onClick={handleGenerateApprovalToken} disabled={approvalLoading} title="Gera um novo token e revoga o anterior">
                        🔄 Regenerar Link
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={handleRevokeApprovalToken} disabled={approvalLoading}>
                        ✕ Revogar
                      </button>
                    </div>
                  </>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={handleGenerateApprovalToken} disabled={approvalLoading}>
                    {approvalLoading ? 'Gerando...' : '+ Gerar Link de Aprovacao'}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="form-group"><label>Nome</label><input className="input" value={editData.name} onChange={e => setEditData((p: any) => ({ ...p, name: e.target.value }))} /></div>
              <div className="form-row">
                <div className="form-group"><label>Nome do Contato</label><input className="input" value={editData.contact_name} onChange={e => setEditData((p: any) => ({ ...p, contact_name: e.target.value }))} /></div>
                <div className="form-group"><label>Email</label><input className="input" value={editData.contact_email} onChange={e => setEditData((p: any) => ({ ...p, contact_email: e.target.value }))} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Telefone</label><input className="input" value={editData.contact_phone} onChange={e => setEditData((p: any) => ({ ...p, contact_phone: e.target.value }))} /></div>
                <div className="form-group"><label>Pasta do Drive</label><input className="input" value={editData.drive_folder} onChange={e => setEditData((p: any) => ({ ...p, drive_folder: e.target.value }))} placeholder="https://drive.google.com/drive/folders/..." /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Mensalidade (R$)</label><input className="input" type="number" step="0.01" value={editData.monthly_fee} onChange={e => setEditData((p: any) => ({ ...p, monthly_fee: parseFloat(e.target.value) || 0 }))} placeholder="0.00" /></div>
                <div className="form-group"><label>Dia de Vencimento</label><input className="input" type="number" min="1" max="31" value={editData.payment_day} onChange={e => setEditData((p: any) => ({ ...p, payment_day: parseInt(e.target.value) || 10 }))} /></div>
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16, marginTop: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#FFB300', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12, display: 'block' }}>Vinculos do Painel de Performance</label>
                <small style={{ color: '#9B96B0', fontSize: 11, marginBottom: 14, display: 'block' }}>
                  Selecione as contas deste cliente em cada plataforma. So aparecera no painel dele.
                </small>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, color: '#9B96B0', display: 'block', marginBottom: 4 }}>Conta Meta Ads</label>
                    <CoreAccountSelect
                      source="meta" mode="id"
                      value={editData.core_meta_account_id || ''}
                      onChange={v => setEditData((p: any) => ({ ...p, core_meta_account_id: v }))}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#9B96B0', display: 'block', marginBottom: 4 }}>Pagina Facebook / Instagram</label>
                    <CoreAccountSelect
                      source="ig" mode="id"
                      value={editData.core_ig_page_id || ''}
                      onChange={v => setEditData((p: any) => ({ ...p, core_ig_page_id: v }))}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#9B96B0', display: 'block', marginBottom: 4 }}>Conta Google Ads</label>
                    <CoreAccountSelect
                      source="gads" mode="id"
                      value={editData.core_gads_customer_id || ''}
                      onChange={v => setEditData((p: any) => ({ ...p, core_gads_customer_id: v }))}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#9B96B0', display: 'block', marginBottom: 4 }}>Property Google Analytics 4</label>
                    <CoreAccountSelect
                      source="ga4" mode="id"
                      value={editData.core_ga4_property_id || ''}
                      onChange={v => setEditData((p: any) => ({ ...p, core_ga4_property_id: v }))}
                    />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ fontSize: 11, color: '#9B96B0', display: 'block', marginBottom: 4 }}>Nome textual (apelido — usado pra CRM Google Sheets e Kiwify)</label>
                    <CoreAccountSelect
                      value={editData.core_client_name || ''}
                      onChange={v => setEditData((p: any) => ({ ...p, core_client_name: v }))}
                      placeholder="Ex: ASK Equipamentos, Sameco, Josi..."
                    />
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                <button className="btn btn-primary btn-sm" onClick={handleSave}><Save size={12} /> Salvar</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}><X size={12} /> Cancelar</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Credentials tab */}
      {activeTab === 'credentials' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn btn-primary btn-sm" onClick={() => setShowNewCred(true)}><Plus size={14} /> Novo Acesso</button>
          </div>

          {credentials.length === 0 ? (
            <div className="empty-state" style={{ minHeight: 200 }}><h3>Nenhum acesso cadastrado</h3></div>
          ) : (
            <div className="table-card">
              <table>
                <thead><tr><th>Plataforma</th><th>Login</th><th>Senha</th><th>Observacao</th><th className="right">Acoes</th></tr></thead>
                <tbody>
                  {credentials.map(cred => editCredId === cred.id ? (
                    <tr key={cred.id}>
                      <td><select className="select" value={editCredData.platform} onChange={e => setEditCredData((p: any) => ({ ...p, platform: e.target.value }))} style={{ padding: '4px 8px' }}>{PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}</select></td>
                      <td><input className="input" value={editCredData.login} onChange={e => setEditCredData((p: any) => ({ ...p, login: e.target.value }))} style={{ padding: '4px 8px' }} /></td>
                      <td><input className="input" value={editCredData.password} onChange={e => setEditCredData((p: any) => ({ ...p, password: e.target.value }))} style={{ padding: '4px 8px' }} /></td>
                      <td><input className="input" value={editCredData.observation || ''} onChange={e => setEditCredData((p: any) => ({ ...p, observation: e.target.value }))} style={{ padding: '4px 8px' }} /></td>
                      <td className="right" style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn btn-primary btn-sm btn-icon" onClick={handleSaveCred}><Save size={12} /></button>
                        <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setEditCredId(null)}><X size={12} /></button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={cred.id}>
                      <td className="name">{cred.platform}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{cred.login}</td>
                      <td>
                        <span style={{ fontFamily: 'monospace', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {showPasswords.has(cred.id) ? cred.password : '••••••••'}
                          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B6580', padding: 2 }} onClick={() => togglePass(cred.id)}>
                            {showPasswords.has(cred.id) ? <EyeOff size={12} /> : <Eye size={12} />}
                          </button>
                        </span>
                      </td>
                      <td style={{ color: '#6B6580', fontSize: 12 }}>{cred.observation || '-'}</td>
                      <td className="right" style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn btn-secondary btn-sm btn-icon" onClick={() => { setEditCredId(cred.id); setEditCredData({ ...cred }) }}><Edit3 size={12} /></button>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDeleteCred(cred.id)}><Trash2 size={12} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* New credential modal */}
          {showNewCred && (
            <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setShowNewCred(false))() }}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                <h2>Novo Acesso</h2>
                <div className="form-group"><label>Plataforma *</label>
                  <select className="select" value={newCred.platform} onChange={e => setNewCred(p => ({ ...p, platform: e.target.value }))}>
                    <option value="">Selecione...</option>
                    {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="form-row">
                  <div className="form-group"><label>Login *</label><input className="input" value={newCred.login} onChange={e => setNewCred(p => ({ ...p, login: e.target.value }))} placeholder="email@exemplo.com" /></div>
                  <div className="form-group"><label>Senha *</label><input className="input" value={newCred.password} onChange={e => setNewCred(p => ({ ...p, password: e.target.value }))} /></div>
                </div>
                <div className="form-group"><label>Observacao</label><input className="input" value={newCred.observation} onChange={e => setNewCred(p => ({ ...p, observation: e.target.value }))} placeholder="Ex: conta principal, conta de backup..." /></div>
                <div className="modal-actions">
                  <button className="btn btn-secondary" onClick={() => setShowNewCred(false)}>Cancelar</button>
                  <button className="btn btn-primary" onClick={handleCreateCred}>Criar Acesso</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Users tab */}
      {activeTab === 'users' && (
        <div>
          {clientUsers.length === 0 ? (
            <div className="empty-state" style={{ minHeight: 200 }}>
              <h3>Nenhum usuario vinculado</h3>
              <p>Este cliente ainda nao tem acesso ao sistema.</p>
              <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => { setResetPassId(-1); setNewPassword('') }}><Plus size={14} /> Criar Acesso</button>
            </div>
          ) : (
            <div className="table-card">
              <table>
                <thead><tr><th>Nome</th><th>Email</th><th>Role</th><th>Status</th><th className="right">Acoes</th></tr></thead>
                <tbody>
                  {clientUsers.map((u: any) => (
                    <tr key={u.id}>
                      <td className="name">{u.name}</td>
                      <td>{u.email}</td>
                      <td><span className="stage-badge" style={{ background: 'rgba(255,179,0,0.1)', color: '#F5A623' }}>{u.role}</span></td>
                      <td><span style={{ color: u.is_active ? '#22C55E' : '#EF4444' }}>{u.is_active ? 'Ativo' : 'Inativo'}</span></td>
                      <td className="right">
                        <button className="btn btn-secondary btn-sm" onClick={() => { setResetPassId(u.id); setNewPassword('') }}>
                          <Lock size={12} /> Resetar Senha
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Reset password / Create access modal */}
          {resetPassId && (
            <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setResetPassId(null))() }}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                {resetPassId === -1 ? (
                  <>
                    <h2>Criar Acesso para o Cliente</h2>
                    <p style={{ fontSize: 13, color: '#A8A3B8', marginBottom: 16 }}>
                      Um usuario sera criado com o email <strong>{client?.contact_email}</strong> para acessar o sistema.
                    </p>
                    <div className="form-group">
                      <label>Senha de Acesso</label>
                      <input className="input" type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Defina uma senha..." />
                    </div>
                    <div className="modal-actions">
                      <button className="btn btn-secondary" onClick={() => setResetPassId(null)}>Cancelar</button>
                      <button className="btn btn-primary" disabled={!newPassword.trim() || !client?.contact_email} onClick={async () => {
                        await apiFetch('/api/users', { method: 'POST', body: JSON.stringify({ name: client?.contact_name || client?.name, email: client?.contact_email, password: newPassword, role: 'cliente', client_id: client?.id }) })
                        setResetPassId(null); setNewPassword('')
                        load()
                      }}>Criar Acesso</button>
                    </div>
                  </>
                ) : (
                  <>
                    <h2>Resetar Senha</h2>
                    <p style={{ fontSize: 13, color: '#A8A3B8', marginBottom: 16 }}>
                      Defina uma nova senha para <strong>{clientUsers.find((u: any) => u.id === resetPassId)?.name}</strong>
                    </p>
                    <div className="form-group">
                      <label>Nova Senha</label>
                      <input className="input" type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Digite a nova senha..." />
                    </div>
                    <div className="modal-actions">
                      <button className="btn btn-secondary" onClick={() => setResetPassId(null)}>Cancelar</button>
                      <button className="btn btn-primary" disabled={!newPassword.trim()} onClick={async () => {
                        await apiFetch(`/api/users/${resetPassId}`, { method: 'PUT', body: JSON.stringify({ password: newPassword }) })
                        setResetPassId(null); setNewPassword('')
                        alert('Senha alterada com sucesso!')
                      }}>Salvar Nova Senha</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Services tab */}
      {activeTab === 'services' && (
        <div className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Servicos contratados</h3>
          {allServices.length === 0 ? (
            <p style={{ color: '#9B96B0', fontSize: 13 }}>Nenhum servico cadastrado ainda. Crie servicos na area de configuracoes.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {allServices.map(s => {
                const svc = clientSvcs.find(cs => cs.id === s.id)
                const isOn = !!svc
                const fields = (s as any).fields || []
                return (
                  <div key={s.id} style={{ borderRadius: 10, border: `1px solid ${isOn ? s.color : 'rgba(255,255,255,0.08)'}`, background: isOn ? `${s.color}10` : 'rgba(255,255,255,0.02)', overflow: 'hidden' }}>
                    <button onClick={() => toggleService(s.id)}
                      style={{ width: '100%', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', color: isOn ? s.color : '#9B96B0', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', fontWeight: isOn ? 600 : 400, textAlign: 'left' }}>
                      <span style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${isOn ? s.color : 'rgba(255,255,255,0.12)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, background: isOn ? s.color : 'transparent', color: isOn ? '#06040C' : 'transparent', flexShrink: 0 }}>{isOn ? '\u2713' : ''}</span>
                      {s.name}
                    </button>
                    {isOn && fields.length > 0 && (
                      <div style={{ padding: '0 16px 12px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {fields.map((f: any) => {
                          const key = f.name.toLowerCase().replace(/\s+/g, '_')
                          if (f.type === 'quantity') return (
                            <div key={key} style={{ minWidth: 120 }}>
                              <label style={{ fontSize: 11, color: '#6E6887', display: 'block', marginBottom: 4 }}>{f.name}/mes</label>
                              <input className="input" style={{ padding: '6px 10px', fontSize: 13 }} value={svc?.config[key] || ''} onChange={e => updateSvcConfig(s.id, key, e.target.value)} placeholder="Qtd" />
                            </div>
                          )
                          const checked = svc?.config[key] === 'sim'
                          return (
                            <button key={key} onClick={() => updateSvcConfig(s.id, key, checked ? '' : 'sim')}
                              style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${checked ? '#34C759' : 'rgba(255,255,255,0.08)'}`, background: checked ? 'rgba(52,199,89,0.1)' : 'transparent', color: checked ? '#34C759' : '#9B96B0', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                              {checked ? '\u2713 ' : ''}{f.name}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Onboard tab */}
      {activeTab === 'onboard' && (
        <div>
          {/* Link do formulario */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Link do Formulario de Entrada</h3>
                <p style={{ fontSize: 12, color: '#9B96B0' }}>Envie este link para o cliente preencher o briefing.</p>
              </div>
              <button className="btn btn-primary btn-sm" onClick={copyLink} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ClipboardCopy size={12} /> {linkCopied ? 'Copiado!' : 'Copiar Link'}
              </button>
            </div>
            <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, fontSize: 12, color: '#6E6887', wordBreak: 'break-all', fontFamily: 'monospace' }}>
              {onboardLink}
            </div>
          </div>

          {/* Respostas */}
          {onboardLoading ? (
            <div className="loading-container"><div className="spinner" /></div>
          ) : onboardEntries.length > 0 ? (
            onboardEntries.map((entry, idx) => {
              // Agrupamento em secoes baseado nas keys mais comuns
              const SECTIONS: { title: string; keys: string[] }[] = [
                { title: 'Contato',       keys: ['seu_nome', 'nome', 'whatsapp', 'telefone', 'email', 'cidade', 'estado'] },
                { title: 'Negocio',       keys: ['o_que_vende', 'tempo_mercado', 'quem_compra'] },
                { title: 'Cliente ideal', keys: ['descreva_cliente', 'por_que_compram', 'por_que_nao_compram', 'objecoes'] },
                { title: 'Atendimento',   keys: ['como_chega', 'quem_atende', 'como_registra', 'demora_responder', 'faz_followup'] },
                { title: 'Financeiro',    keys: ['faturamento_mes', 'ticket_medio', 'vendas_mes', 'meta_faturamento'] },
                { title: 'Concorrentes',  keys: ['concorrentes', 'diferencial', 'preco_vs_concorrente'] },
              ]
              const data = entry.data as Record<string, string>
              const allEntries = Object.entries(data).filter(([_, v]) => v && String(v).trim())
              // Descobre em qual secao cada key entra + acumula "outros" pra keys nao mapeadas
              const usedKeys = new Set<string>()
              const sectionData = SECTIONS.map(sec => {
                const items = sec.keys
                  .map(k => {
                    const val = data[k]
                    if (val && String(val).trim()) { usedKeys.add(k); return [k, val] as [string, string] }
                    return null
                  })
                  .filter(Boolean) as [string, string][]
                return { ...sec, items }
              }).filter(s => s.items.length > 0)
              const otherItems = allEntries.filter(([k]) => !usedKeys.has(k) && !k.startsWith('acesso_'))
              const accessItems = allEntries.filter(([k]) => k.startsWith('acesso_'))
              if (otherItems.length > 0) sectionData.push({ title: 'Outros', keys: [], items: otherItems })
              if (accessItems.length > 0) sectionData.push({ title: 'Acessos', keys: [], items: accessItems })

              const formatLabel = (k: string) => k.replace(/^acesso_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
              const isLongText = (v: string) => v.length > 80 || v.includes('\n')

              return (
                <div className="card" key={entry.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, paddingBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <CheckCircle size={16} style={{ color: '#34C759' }} />
                      <h3 style={{ fontSize: 14, fontWeight: 600 }}>Resposta {onboardEntries.length > 1 ? `#${onboardEntries.length - idx}` : ''}</h3>
                    </div>
                    <span style={{ fontSize: 11, color: '#6E6887' }}>{new Date(entry.created_at).toLocaleString('pt-BR')}</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                    {sectionData.map(sec => (
                      <div key={sec.title}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.12em', color: '#FFB300', marginBottom: 10 }}>
                          {sec.title}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
                          {sec.items.map(([key, val]) => {
                            const long = isLongText(String(val))
                            return (
                              <div key={key} style={{
                                padding: '10px 12px',
                                background: 'rgba(255,255,255,0.025)',
                                borderRadius: 8,
                                border: '1px solid rgba(255,255,255,0.05)',
                                gridColumn: long ? '1 / -1' : 'auto',
                              }}>
                                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9B96B0', marginBottom: 4 }}>
                                  {formatLabel(key)}
                                </div>
                                <div style={{ fontSize: 13, color: '#fff', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                  {String(val)}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: 32, color: '#9B96B0' }}>
              <FileText size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
              <p>Formulario ainda nao respondido pelo cliente.</p>
            </div>
          )}
        </div>
      )}

      {/* Performance tab — embeda /core via iframe com auto-login */}
      {activeTab === 'performance' && <PerformanceTab client={client} onGoToInfo={() => setActiveTab('info')} />}
    </div>
  )
}
