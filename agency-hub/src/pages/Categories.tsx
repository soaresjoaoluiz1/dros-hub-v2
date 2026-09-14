import { useState, useEffect } from 'react'
import { fetchCategories, createCategory, type TaskCategory } from '../lib/api'
import { Tag, Plus } from 'lucide-react'

export default function Categories() {
  const [cats, setCats] = useState<TaskCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#5DADE2')

  const load = () => { setLoading(true); fetchCategories().then(setCats).finally(() => setLoading(false)) }
  useEffect(load, [])
  const handleCreate = async () => { if (!newName) return; await createCategory(newName, newColor); setShowNew(false); setNewName(''); load() }

  return (
    <div>
      <div className="page-header"><h1><Tag size={22} style={{ marginRight: 8 }} /> Categorias</h1><button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Nova</button></div>
      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {cats.map(c => <div key={c.id} className="card" style={{ minWidth: 200, display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ width: 14, height: 14, borderRadius: '50%', background: c.color }} /><span style={{ fontWeight: 600 }}>{c.name}</span></div>)}
          {cats.length === 0 && <div className="empty-state"><h3>Nenhuma categoria</h3></div>}
        </div>
      )}
      {showNew && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setShowNew(false))() }}><div className="modal" onClick={e => e.stopPropagation()}>
          <h2>Nova Categoria</h2>
          <div className="form-row"><div className="form-group" style={{ flex: 3 }}><label>Nome</label><input className="input" value={newName} onChange={e => setNewName(e.target.value)} /></div><div className="form-group" style={{ flex: 1 }}><label>Cor</label><input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} style={{ width: '100%', height: 40, border: 'none', borderRadius: 8, cursor: 'pointer' }} /></div></div>
          <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button><button className="btn btn-primary" onClick={handleCreate}>Criar</button></div>
        </div></div>
      )}
    </div>
  )
}
