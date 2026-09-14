import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchClients, createClient, updateClient, formatNumber, type Client } from '../lib/api'
import { Building2, Plus, Edit3, Eye, Archive, ArchiveRestore } from 'lucide-react'
import CoreAccountSelect from '../components/CoreAccountSelect'

const BLANK_FORM = {
  name: '', contact_name: '', contact_email: '', contact_phone: '',
  drive_folder: '', password: '',
  cnpj: '', razao_social: '', segmento: '', website: '', instagram: '',
  cidade: '', estado: '', observacoes: '',
  monthly_fee: '', payment_day: '10', contrato_inicio: '',
  core_client_name: '',
}

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'active' | 'inactive'>('active')
  const navigate = useNavigate()

  // Modal: 'new' = criar, number = editar id, null = fechado
  const [modalMode, setModalMode] = useState<'new' | number | null>(null)
  const [form, setForm] = useState(BLANK_FORM)
  const isEditing = typeof modalMode === 'number'

  const load = () => { setLoading(true); fetchClients({ inactive: view === 'inactive' }).then(setClients).finally(() => setLoading(false)) }
  useEffect(load, [view])

  const handleToggleActive = async (c: Client) => {
    if (c.is_active) {
      // Desativar — pergunta mes de saida pra calcular ate quando aparece no financeiro
      const today = new Date()
      const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
      const month = prompt(
        `Mes de saida de "${c.name}" (YYYY-MM).\n\nO cliente aparece no financeiro ate esse mes (inclusive). Apos isso, some.\n\nDefault: mes atual.`,
        defaultMonth
      )
      if (month === null) return
      if (!/^\d{4}-\d{2}$/.test(month)) return alert('Formato invalido. Use YYYY-MM (ex: 2026-04)')
      await updateClient(c.id, { is_active: 0, inactivated_at: `${month}-01 00:00:00` } as any)
    } else {
      if (!confirm(`Reativar "${c.name}"?`)) return
      await updateClient(c.id, { is_active: 1 } as any)
    }
    load()
  }

  const openNew = () => { setForm(BLANK_FORM); setModalMode('new') }

  const openEdit = (c: Client) => {
    setForm({
      name: c.name || '',
      contact_name: c.contact_name || '',
      contact_email: c.contact_email || '',
      contact_phone: (c as any).contact_phone || '',
      drive_folder: (c as any).drive_folder || '',
      password: '',
      cnpj: (c as any).cnpj || '',
      razao_social: (c as any).razao_social || '',
      segmento: (c as any).segmento || '',
      website: (c as any).website || '',
      instagram: (c as any).instagram || '',
      cidade: (c as any).cidade || '',
      estado: (c as any).estado || '',
      observacoes: (c as any).observacoes || '',
      monthly_fee: (c as any).monthly_fee != null ? String((c as any).monthly_fee) : '',
      payment_day: (c as any).payment_day != null ? String((c as any).payment_day) : '10',
      contrato_inicio: (c as any).contrato_inicio || '',
      core_client_name: (c as any).core_client_name || '',
    })
    setModalMode(c.id)
  }

  const closeModal = () => { setModalMode(null); setForm(BLANK_FORM) }

  const handleSave = async () => {
    if (!form.name) return alert('Nome Fantasia obrigatorio')
    if (!form.contact_email) return alert('Email obrigatorio')
    if (!isEditing && !form.password) return alert('Senha obrigatoria pra novo cliente')

    const payload: any = { ...form }
    payload.monthly_fee = form.monthly_fee ? parseFloat(form.monthly_fee) : 0
    payload.payment_day = form.payment_day ? parseInt(form.payment_day) : 10
    // No PUT, nao envia senha vazia (mantem a atual)
    if (isEditing && !payload.password) delete payload.password

    try {
      if (isEditing) await updateClient(modalMode as number, payload)
      else await createClient(payload)
      closeModal(); load()
    } catch (e: any) { alert('Erro: ' + (e?.message || 'desconhecido')) }
  }

  return (
    <div>
      <div className="page-header"><h1><Building2 size={22} style={{ marginRight: 8 }} /> Clientes</h1><button className="btn btn-primary btn-sm" onClick={openNew}><Plus size={14} /> Novo Cliente</button></div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => setView('active')}
          style={{ background: 'none', border: 'none', color: view === 'active' ? '#FFB300' : '#9B96B0', borderBottom: view === 'active' ? '2px solid #FFB300' : '2px solid transparent', padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
        >Ativos</button>
        <button
          onClick={() => setView('inactive')}
          style={{ background: 'none', border: 'none', color: view === 'inactive' ? '#FFB300' : '#9B96B0', borderBottom: view === 'inactive' ? '2px solid #FFB300' : '2px solid transparent', padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
        ><Archive size={12} /> Inativos</button>
      </div>
      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div className="table-card"><table>
          <thead><tr><th>Nome</th><th>Contato</th><th>Email</th><th className="right">Tarefas</th><th>Status</th><th className="right">Acoes</th></tr></thead>
          <tbody>
            {clients.map(c => (
              <tr key={c.id}>
                <td className="name">{c.name}</td><td>{c.contact_name || '-'}</td><td>{c.contact_email || '-'}</td>
                <td className="right" style={{ fontWeight: 600 }}>{formatNumber(c.task_count || 0)}</td>
                <td><span style={{ color: c.is_active ? '#34C759' : '#FF6B6B' }}>{c.is_active ? 'Ativo' : 'Inativo'}</span></td>
                <td className="right" style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary btn-sm btn-icon" onClick={() => navigate(`/clients/${c.id}`)} title="Ver detalhes"><Eye size={12} /></button>
                  <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openEdit(c)} title="Editar"><Edit3 size={12} /></button>
                  <button
                    className="btn btn-secondary btn-sm btn-icon"
                    onClick={() => handleToggleActive(c)}
                    title={c.is_active ? 'Inativar cliente' : 'Reativar cliente'}
                    style={c.is_active ? { color: '#FF6B6B' } : { color: '#34C759' }}
                  >{c.is_active ? <Archive size={12} /> : <ArchiveRestore size={12} />}</button>
                </td>
              </tr>
            ))}
            {clients.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#6B6580' }}>{view === 'active' ? 'Nenhum cliente ativo' : 'Nenhum cliente inativo'}</td></tr>}
          </tbody>
        </table></div>
      )}
      {modalMode !== null && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (closeModal)() }}><div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700, maxHeight: '90vh', overflowY: 'auto' }}>
          <h2>{isEditing ? 'Editar Cliente' : 'Novo Cliente'}</h2>

          <div style={{ fontSize: 11, color: '#9B96B0', textTransform: 'uppercase', fontWeight: 600, margin: '12px 0 6px' }}>Identificacao</div>
          <div className="form-row">
            <div className="form-group"><label>Nome Fantasia *</label><input className="input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Nome do cliente" /></div>
            <div className="form-group"><label>Razao Social</label><input className="input" value={form.razao_social} onChange={e => setForm(p => ({ ...p, razao_social: e.target.value }))} placeholder="Razao social registrada" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>CNPJ</label><input className="input" value={form.cnpj} onChange={e => setForm(p => ({ ...p, cnpj: e.target.value }))} placeholder="00.000.000/0000-00" /></div>
            <div className="form-group"><label>Segmento</label><input className="input" value={form.segmento} onChange={e => setForm(p => ({ ...p, segmento: e.target.value }))} placeholder="Ex: Estetica, Industria, Varejo" /></div>
          </div>

          <div style={{ fontSize: 11, color: '#9B96B0', textTransform: 'uppercase', fontWeight: 600, margin: '16px 0 6px' }}>Contato</div>
          <div className="form-row">
            <div className="form-group"><label>Nome do Contato</label><input className="input" value={form.contact_name} onChange={e => setForm(p => ({ ...p, contact_name: e.target.value }))} placeholder="Pessoa responsavel" /></div>
            <div className="form-group"><label>Telefone</label><input className="input" value={form.contact_phone} onChange={e => setForm(p => ({ ...p, contact_phone: e.target.value }))} placeholder="(00) 00000-0000" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Email de Acesso *</label><input className="input" type="email" value={form.contact_email} onChange={e => setForm(p => ({ ...p, contact_email: e.target.value }))} placeholder="email@cliente.com" /></div>
            <div className="form-group"><label>{isEditing ? 'Nova Senha (opcional)' : 'Senha de Acesso *'}</label><input className="input" type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder={isEditing ? 'Deixe vazio para manter' : 'Senha do cliente'} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Cidade</label><input className="input" value={form.cidade} onChange={e => setForm(p => ({ ...p, cidade: e.target.value }))} placeholder="Cidade" /></div>
            <div className="form-group"><label>Estado</label><input className="input" value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value }))} placeholder="UF" maxLength={2} /></div>
          </div>

          <div style={{ fontSize: 11, color: '#9B96B0', textTransform: 'uppercase', fontWeight: 600, margin: '16px 0 6px' }}>Redes / Site</div>
          <div className="form-row">
            <div className="form-group"><label>Site</label><input className="input" value={form.website} onChange={e => setForm(p => ({ ...p, website: e.target.value }))} placeholder="https://..." /></div>
            <div className="form-group"><label>Instagram</label><input className="input" value={form.instagram} onChange={e => setForm(p => ({ ...p, instagram: e.target.value }))} placeholder="@perfil" /></div>
          </div>

          <div style={{ fontSize: 11, color: '#9B96B0', textTransform: 'uppercase', fontWeight: 600, margin: '16px 0 6px' }}>Contrato / Financeiro</div>
          <div className="form-row">
            <div className="form-group"><label>Mensalidade (R$)</label><input className="input" type="number" step="0.01" value={form.monthly_fee} onChange={e => setForm(p => ({ ...p, monthly_fee: e.target.value }))} placeholder="0.00" /></div>
            <div className="form-group"><label>Dia do Pagamento</label><input className="input" type="number" min="1" max="31" value={form.payment_day} onChange={e => setForm(p => ({ ...p, payment_day: e.target.value }))} placeholder="10" /></div>
            <div className="form-group"><label>Inicio do Contrato</label><input className="input" type="date" value={form.contrato_inicio} onChange={e => setForm(p => ({ ...p, contrato_inicio: e.target.value }))} /></div>
          </div>

          <div style={{ fontSize: 11, color: '#9B96B0', textTransform: 'uppercase', fontWeight: 600, margin: '16px 0 6px' }}>Outros</div>
          <div className="form-group"><label>Pasta do Drive</label><input className="input" value={form.drive_folder} onChange={e => setForm(p => ({ ...p, drive_folder: e.target.value }))} placeholder="https://drive.google.com/..." /></div>
          <div className="form-group">
            <label>Conta no Painel de Performance (/core)</label>
            <CoreAccountSelect
              value={form.core_client_name}
              onChange={v => setForm(p => ({ ...p, core_client_name: v }))}
              placeholder="Selecionar conta do /core"
            />
            <small style={{ color: '#9B96B0', fontSize: 11, marginTop: 4, display: 'block' }}>
              Selecione a conta Meta deste cliente no /core. Deixe em branco se ainda nao tiver.
            </small>
          </div>
          <div className="form-group"><label>Observacoes</label><textarea className="input" value={form.observacoes} onChange={e => setForm(p => ({ ...p, observacoes: e.target.value }))} rows={3} style={{ resize: 'vertical' }} placeholder="Anotacoes internas sobre o cliente" /></div>

          {!isEditing && (
            <div style={{ padding: '10px 12px', background: 'rgba(245,166,35,0.06)', borderRadius: 8, fontSize: 12, color: '#F5A623', marginTop: 4 }}>
              Um usuario sera criado automaticamente com o email e senha acima. O cliente usara essas credenciais pra acessar o sistema, aprovar tarefas e acompanhar o andamento.
            </div>
          )}
          <div className="modal-actions"><button className="btn btn-secondary" onClick={closeModal}>Cancelar</button><button className="btn btn-primary" onClick={handleSave}>{isEditing ? 'Salvar' : 'Criar'}</button></div>
        </div></div>
      )}
    </div>
  )
}
