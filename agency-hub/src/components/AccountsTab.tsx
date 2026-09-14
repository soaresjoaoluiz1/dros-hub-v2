// =====================================================================
// Configuracoes -> aba Contas do Painel
// Lista todos clientes do Painel de Performance (clients table do Hub),
// com IDs vinculados das 4 plataformas (Meta/IG/GAds/GA4).
// Permite criar nova conta, editar IDs e arquivar (soft delete via is_active=0).
//
// Reusa CoreAccountSelect (mode='id') que ja faz search nas APIs Meta/Google.
// =====================================================================
import { useEffect, useMemo, useState } from 'react'
import { fetchClients, createClient, updateClient, type Client } from '../lib/api'
import CoreAccountSelect from './CoreAccountSelect'
import { Plus, Pencil, Archive, ArchiveRestore, Search, X, Check, Loader2 } from 'lucide-react'
import { useToast } from './Toast'

interface FormState {
  id?: number
  name: string
  slug: string
  contact_email: string
  core_meta_account_id: string
  core_ig_page_id: string
  core_gads_customer_id: string
  core_ga4_property_id: string
}

const BLANK_FORM: FormState = {
  name: '', slug: '', contact_email: '',
  core_meta_account_id: '', core_ig_page_id: '', core_gads_customer_id: '', core_ga4_property_id: '',
}

function slugify(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function AccountsTab() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<FormState>(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  const load = () => {
    setLoading(true)
    fetchClients({ inactive: showInactive })
      .then(setClients)
      .catch(e => toast(e?.message || 'Erro ao carregar', 'error'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [showInactive])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clients
    return clients.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.slug || '').toLowerCase().includes(q) ||
      (c.core_meta_account_id || '').includes(q) ||
      (c.core_ga4_property_id || '').includes(q) ||
      (c.core_gads_customer_id || '').includes(q) ||
      (c.core_ig_page_id || '').includes(q)
    )
  }, [clients, search])

  const openNew = () => {
    setForm(BLANK_FORM)
    setModalOpen(true)
  }
  const openEdit = (c: Client) => {
    setForm({
      id: c.id,
      name: c.name,
      slug: c.slug,
      contact_email: c.contact_email || '',
      core_meta_account_id: c.core_meta_account_id || '',
      core_ig_page_id: c.core_ig_page_id || '',
      core_gads_customer_id: c.core_gads_customer_id || '',
      core_ga4_property_id: c.core_ga4_property_id || '',
    })
    setModalOpen(true)
  }
  const close = () => { setModalOpen(false); setForm(BLANK_FORM) }

  const hasAnyId = (f: FormState) => !!(f.core_meta_account_id || f.core_ig_page_id || f.core_gads_customer_id || f.core_ga4_property_id)

  const handleSave = async () => {
    if (!form.name.trim()) { toast('Nome obrigatorio', 'error'); return }
    if (!hasAnyId(form)) { toast('Vincule pelo menos 1 plataforma (Meta/IG/GAds/GA4)', 'error'); return }
    const slug = form.slug.trim() || slugify(form.name)
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        slug,
        contact_email: form.contact_email.trim() || null,
        core_meta_account_id: form.core_meta_account_id || null,
        core_ig_page_id: form.core_ig_page_id || null,
        core_gads_customer_id: form.core_gads_customer_id || null,
        core_ga4_property_id: form.core_ga4_property_id || null,
      }
      if (form.id) {
        await updateClient(form.id, payload as any)
        toast('Conta atualizada')
      } else {
        await createClient(payload as any)
        toast('Conta criada')
      }
      close(); load()
    } catch (e: any) { toast(e?.message || 'Erro ao salvar', 'error') }
    finally { setSaving(false) }
  }

  const handleArchive = async (c: Client) => {
    const action = c.is_active ? 'arquivar' : 'reativar'
    if (!confirm(`Tem certeza que quer ${action} "${c.name}"?`)) return
    try {
      await updateClient(c.id, { is_active: c.is_active ? 0 : 1 } as any)
      toast(`Conta ${action === 'arquivar' ? 'arquivada' : 'reativada'}`)
      load()
    } catch (e: any) { toast(e?.message || 'Erro', 'error') }
  }

  const platformBadge = (label: string, has: boolean, color: string) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 7px', fontSize: 10, fontWeight: 600,
      borderRadius: 4,
      background: has ? `${color}22` : 'rgba(255,255,255,0.04)',
      color: has ? color : 'var(--text-muted)',
      border: `1px solid ${has ? color + '55' : 'var(--border-subtle)'}`,
      opacity: has ? 1 : 0.4,
    }}>{label}</span>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#6B6580' }} />
          <input className="input" placeholder="Buscar por nome, slug ou ID..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Mostrar arquivadas
        </label>
        <button className="btn btn-primary btn-sm" onClick={openNew}><Plus size={14} /> Nova Conta</button>
      </div>

      {loading ? (
        <div className="loading-container" style={{ minHeight: 200 }}><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          {search ? 'Nenhuma conta encontrada com esse filtro.' : 'Nenhuma conta cadastrada. Clique em "Nova Conta" pra comecar.'}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="campaign-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Nome / Slug</th>
                <th>Plataformas vinculadas</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.55 }}>
                  <td>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{c.slug}</div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {platformBadge('Meta', !!c.core_meta_account_id, '#1877F2')}
                      {platformBadge('IG', !!c.core_ig_page_id, '#E4405F')}
                      {platformBadge('GAds', !!c.core_gads_customer_id, '#4285F4')}
                      {platformBadge('GA4', !!c.core_ga4_property_id, '#F9AB00')}
                    </div>
                  </td>
                  <td style={{ fontSize: 11 }}>
                    {c.is_active
                      ? <span style={{ color: 'var(--positive)' }}>Ativa</span>
                      : <span style={{ color: 'var(--text-muted)' }}>Arquivada</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)} title="Editar IDs" style={{ padding: '4px 8px' }}><Pencil size={12} /></button>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleArchive(c)} title={c.is_active ? 'Arquivar' : 'Reativar'} style={{ padding: '4px 8px' }}>
                        {c.is_active ? <Archive size={12} /> : <ArchiveRestore size={12} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
          <div className="modal" style={{ maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h2>{form.id ? 'Editar Conta' : 'Nova Conta'}</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px 0' }}>
              Vincule a conta a pelo menos 1 plataforma. Os campos que aparecem aqui dependem dos tokens configurados na aba "Tokens".
            </p>

            <div className="form-row">
              <div className="form-group">
                <label>Nome *</label>
                <input className="input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value, slug: p.slug || slugify(e.target.value) }))} placeholder="Ex: Box Paper Embalagens" />
              </div>
              <div className="form-group">
                <label>Slug</label>
                <input className="input" value={form.slug} onChange={e => setForm(p => ({ ...p, slug: e.target.value }))} placeholder="auto-gerado do nome" />
              </div>
            </div>

            <div className="form-group">
              <label>Email contato (opcional)</label>
              <input className="input" type="email" value={form.contact_email} onChange={e => setForm(p => ({ ...p, contact_email: e.target.value }))} placeholder="contato@cliente.com" />
            </div>

            <div style={{ padding: '14px 16px', background: 'rgba(255,179,0,0.04)', border: '1px solid rgba(255,179,0,0.15)', borderRadius: 10, marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Vinculos do Painel de Performance
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Meta Ads (account_id)</span>
                  {form.core_meta_account_id && <button type="button" onClick={() => setForm(p => ({ ...p, core_meta_account_id: '' }))} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10 }}>limpar</button>}
                </label>
                <CoreAccountSelect mode="id" source="meta" value={form.core_meta_account_id} onChange={v => setForm(p => ({ ...p, core_meta_account_id: v }))} />
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Instagram (page_id vinculado a IG business)</span>
                  {form.core_ig_page_id && <button type="button" onClick={() => setForm(p => ({ ...p, core_ig_page_id: '' }))} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10 }}>limpar</button>}
                </label>
                <CoreAccountSelect mode="id" source="ig" value={form.core_ig_page_id} onChange={v => setForm(p => ({ ...p, core_ig_page_id: v }))} />
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Google Ads (customer_id)</span>
                  {form.core_gads_customer_id && <button type="button" onClick={() => setForm(p => ({ ...p, core_gads_customer_id: '' }))} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10 }}>limpar</button>}
                </label>
                <CoreAccountSelect mode="id" source="gads" value={form.core_gads_customer_id} onChange={v => setForm(p => ({ ...p, core_gads_customer_id: v }))} />
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Google Analytics 4 (property_id)</span>
                  {form.core_ga4_property_id && <button type="button" onClick={() => setForm(p => ({ ...p, core_ga4_property_id: '' }))} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10 }}>limpar</button>}
                </label>
                <CoreAccountSelect mode="id" source="ga4" value={form.core_ga4_property_id} onChange={v => setForm(p => ({ ...p, core_ga4_property_id: v }))} />
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={close}><X size={14} /> Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />} {form.id ? 'Salvar' : 'Criar Conta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
