// =====================================================================
// /hub/configuracoes — area do dono
// Tabs:
//   - Tokens (gerencia integracoes Meta/Google/Kiwify)
//   - Pipeline (etapas do pipeline, comportamento antigo da pagina)
// =====================================================================
import { useState, useEffect } from 'react'
import { fetchStages, apiFetch, type PipelineStage } from '../lib/api'
import { Settings as SettingsIcon, Save, Plus, Trash2, GripVertical, Check, Key, Layers, Building2 } from 'lucide-react'
import TokensTab from '../components/TokensTab'
import AccountsTab from '../components/AccountsTab'

type TabKey = 'tokens' | 'accounts' | 'pipeline'

export default function SettingsPage() {
  const [tab, setTab] = useState<TabKey>('pipeline')

  return (
    <div>
      <div className="page-header">
        <h1><SettingsIcon size={22} style={{ marginRight: 8 }} /> Configuracoes</h1>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-subtle)', marginBottom: 20 }}>
        <TabButton active={tab === 'pipeline'} onClick={() => setTab('pipeline')} icon={<Layers size={14} />} label="Etapas do Pipeline" />
        <TabButton active={tab === 'tokens'} onClick={() => setTab('tokens')} icon={<Key size={14} />} label="Tokens / Integracoes" />
        <TabButton active={tab === 'accounts'} onClick={() => setTab('accounts')} icon={<Building2 size={14} />} label="Contas do Painel" />
      </div>

      {tab === 'pipeline' && <PipelineTab />}
      {tab === 'tokens' && <TokensTab />}
      {tab === 'accounts' && <AccountsTab />}
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '10px 16px',
        background: 'none',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: 13,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: -1,
      }}
    >
      {icon} {label}
    </button>
  )
}

function PipelineTab() {
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [loading, setLoading] = useState(true)
  const [editStages, setEditStages] = useState<Partial<PipelineStage>[]>([])
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = () => { setLoading(true); fetchStages().then(s => { setStages(s); setEditStages(s.map(x => ({ ...x }))) }).finally(() => setLoading(false)) }
  useEffect(load, [])

  const addStage = () => setEditStages(prev => [...prev, { name: '', slug: '', position: prev.length, color: '#FFB300', is_terminal: 0 }])
  const removeStage = (i: number) => setEditStages(prev => prev.filter((_, idx) => idx !== i))
  const updateStage = (i: number, field: string, value: any) => setEditStages(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))

  const handleSave = async () => {
    for (let i = 0; i < editStages.length; i++) {
      const s = editStages[i]
      const slug = s.slug || s.name!.toLowerCase().replace(/[^a-z0-9]+/g, '_')
      if (s.id) {
        await apiFetch(`/api/stages/${s.id}`, { method: 'PUT', body: JSON.stringify({ name: s.name, color: s.color, position: i, is_terminal: s.is_terminal ? 1 : 0 }) })
      } else if (s.name) {
        await apiFetch('/api/stages', { method: 'POST', body: JSON.stringify({ name: s.name, slug, color: s.color, position: i, is_terminal: s.is_terminal ? 1 : 0 }) })
      }
    }
    setEditing(false); setSaved(true); setTimeout(() => setSaved(false), 3000); load()
  }

  return (
    <section className="dash-section">
      <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Etapas do Pipeline
        {editing ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave}><Save size={14} /> Salvar</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(false); setEditStages(stages.map(x => ({ ...x }))) }}>Cancelar</button>
          </div>
        ) : (
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
            {saved ? <><Check size={14} /> Salvo!</> : 'Editar'}
          </button>
        )}
      </div>
      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div className="card">
          {editing ? (
            <>
              {editStages.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: i < editStages.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                  <GripVertical size={14} style={{ color: '#6B6580', cursor: 'grab', flexShrink: 0 }} />
                  <span style={{ color: '#6B6580', fontSize: 11, width: 20, textAlign: 'center' }}>{i + 1}</span>
                  <input type="color" value={s.color || '#FFB300'} onChange={e => updateStage(i, 'color', e.target.value)} style={{ width: 30, height: 30, border: 'none', cursor: 'pointer', borderRadius: 4, flexShrink: 0 }} />
                  <input className="input" value={s.name || ''} onChange={e => updateStage(i, 'name', e.target.value)} placeholder="Nome da etapa" style={{ flex: 1, padding: '6px 10px' }} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, whiteSpace: 'nowrap', cursor: 'pointer', color: '#6B6580' }}>
                    <input type="checkbox" checked={!!s.is_terminal} onChange={e => updateStage(i, 'is_terminal', e.target.checked ? 1 : 0)} /> Final
                  </label>
                  <button className="btn btn-danger btn-sm btn-icon" onClick={() => removeStage(i)}><Trash2 size={12} /></button>
                </div>
              ))}
              <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={addStage}><Plus size={12} /> Adicionar Etapa</button>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {stages.map((s, i) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < stages.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                  <span style={{ color: '#6B6580', fontSize: 11, width: 20, textAlign: 'center' }}>{i + 1}</span>
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, flex: 1 }}>{s.name}</span>
                  <span style={{ fontSize: 10, color: '#6B6580' }}>{s.slug}</span>
                  {s.is_terminal ? <span style={{ fontSize: 9, background: '#FF6B6B20', color: '#FF6B6B', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>FINAL</span> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
