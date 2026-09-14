import { useState, useEffect } from 'react'
import { fetchServices, createService, updateService, type Service, type ServiceField } from '../lib/api'
import { Briefcase, Plus, Trash2, Edit3, Save, X } from 'lucide-react'

export default function Services() {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', color: '#5DADE2', fields: [] as ServiceField[] })

  const load = () => { setLoading(true); fetchServices().then(setServices).finally(() => setLoading(false)) }
  useEffect(load, [])

  const resetForm = () => { setForm({ name: '', color: '#5DADE2', fields: [] }); setShowNew(false); setEditId(null) }

  const handleSave = async () => {
    if (!form.name) return
    if (editId) {
      await updateService(editId, form)
    } else {
      await createService(form.name, form.color, form.fields)
    }
    resetForm(); load()
  }

  const addField = () => setForm(p => ({ ...p, fields: [...p.fields, { name: '', type: 'quantity' }] }))
  const removeField = (i: number) => setForm(p => ({ ...p, fields: p.fields.filter((_, idx) => idx !== i) }))
  const updateField = (i: number, key: string, val: string) => setForm(p => ({
    ...p, fields: p.fields.map((f, idx) => idx === i ? { ...f, [key]: val } : f)
  }))

  const startEdit = (s: Service) => {
    setForm({ name: s.name, color: s.color, fields: s.fields || [] })
    setEditId(s.id); setShowNew(true)
  }

  return (
    <div>
      <div className="page-header">
        <h1><Briefcase size={22} style={{ marginRight: 8 }} /> Servicos</h1>
        <button className="btn btn-primary btn-sm" onClick={() => { resetForm(); setShowNew(true) }}><Plus size={14} /> Novo</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {services.map(s => (
            <div key={s.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 14, height: 14, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                <div>
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  {s.fields?.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      {s.fields.map((f, i) => (
                        <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: '#9B96B0' }}>
                          {f.type === 'quantity' ? `${f.name} (qtd)` : f.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => startEdit(s)}><Edit3 size={12} /> Editar</button>
            </div>
          ))}
          {services.length === 0 && <div className="empty-state"><h3>Nenhum servico</h3></div>}
        </div>
      )}

      {showNew && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (resetForm)() }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h2>{editId ? 'Editar Servico' : 'Novo Servico'}</h2>

            <div className="form-row">
              <div className="form-group" style={{ flex: 3 }}>
                <label>Nome</label>
                <input className="input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Gestao de Trafego" />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Cor</label>
                <input type="color" value={form.color} onChange={e => setForm(p => ({ ...p, color: e.target.value }))} style={{ width: '100%', height: 40, border: 'none', borderRadius: 8, cursor: 'pointer' }} />
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label style={{ fontWeight: 600, fontSize: 13 }}>Campos do servico</label>
                <button className="btn btn-secondary btn-sm" onClick={addField} style={{ fontSize: 11 }}><Plus size={10} /> Adicionar campo</button>
              </div>

              {form.fields.length === 0 && (
                <p style={{ fontSize: 12, color: '#6E6887', padding: '8px 0' }}>Nenhum campo. Clique em "Adicionar campo" para definir opcoes como quantidade de posts, relatorios, etc.</p>
              )}

              {form.fields.map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <input className="input" style={{ flex: 2, padding: '8px 10px', fontSize: 13 }} value={f.name} onChange={e => updateField(i, 'name', e.target.value)} placeholder="Nome do campo (ex: Posts)" />
                  <select className="select" style={{ flex: 1, padding: '8px 10px', fontSize: 13 }} value={f.type} onChange={e => updateField(i, 'type', e.target.value)}>
                    <option value="quantity">Quantitativo</option>
                    <option value="toggle">Selecionavel</option>
                  </select>
                  <button onClick={() => removeField(i)} style={{ background: 'transparent', border: 'none', color: '#FF6B6B', cursor: 'pointer', padding: 4 }}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={resetForm}><X size={12} /> Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave}><Save size={12} /> {editId ? 'Salvar' : 'Criar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
