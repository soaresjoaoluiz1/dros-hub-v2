import { useState, useEffect } from 'react'
import { fetchDepartments, createDepartment, updateDepartment, formatNumber, type Department } from '../lib/api'
import { Layers, Plus, Edit3, Save, X } from 'lucide-react'

export default function Departments() {
  const [depts, setDepts] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#FFB300')
  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')

  const load = () => { setLoading(true); fetchDepartments().then(setDepts).finally(() => setLoading(false)) }
  useEffect(load, [])
  const handleCreate = async () => { if (!newName) return; await createDepartment(newName, newColor); setShowNew(false); setNewName(''); setNewColor('#FFB300'); load() }
  const startEdit = (d: Department) => { setEditId(d.id); setEditName(d.name); setEditColor(d.color) }
  const handleSaveEdit = async () => { if (!editId) return; await updateDepartment(editId, { name: editName, color: editColor }); setEditId(null); load() }

  return (
    <div>
      <div className="page-header"><h1><Layers size={22} style={{ marginRight: 8 }} /> Departamentos</h1><button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Novo</button></div>
      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div className="table-card"><table>
          <thead><tr><th>Nome</th><th>Cor</th><th className="right">Funcionarios</th><th className="right">Tarefas</th><th className="right">Acoes</th></tr></thead>
          <tbody>{depts.map(d => editId === d.id ? (
            <tr key={d.id}>
              <td><input className="input" value={editName} onChange={e => setEditName(e.target.value)} style={{ padding: '4px 8px' }} /></td>
              <td><input type="color" value={editColor} onChange={e => setEditColor(e.target.value)} style={{ width: 30, height: 30, border: 'none', cursor: 'pointer', borderRadius: 4 }} /></td>
              <td className="right">{d.employee_count || 0}</td><td className="right">{formatNumber(d.task_count || 0)}</td>
              <td className="right" style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}><button className="btn btn-primary btn-sm btn-icon" onClick={handleSaveEdit}><Save size={12} /></button><button className="btn btn-secondary btn-sm btn-icon" onClick={() => setEditId(null)}><X size={12} /></button></td>
            </tr>
          ) : (
            <tr key={d.id}>
              <td className="name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 12, height: 12, borderRadius: '50%', background: d.color }} />{d.name}</td>
              <td><span style={{ width: 20, height: 20, borderRadius: 4, background: d.color, display: 'inline-block' }} /></td>
              <td className="right">{d.employee_count || 0}</td><td className="right" style={{ fontWeight: 600 }}>{formatNumber(d.task_count || 0)}</td>
              <td className="right"><button className="btn btn-secondary btn-sm btn-icon" onClick={() => startEdit(d)}><Edit3 size={12} /></button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {showNew && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setShowNew(false))() }}><div className="modal" onClick={e => e.stopPropagation()}>
          <h2>Novo Departamento</h2>
          <div className="form-row"><div className="form-group" style={{ flex: 3 }}><label>Nome</label><input className="input" value={newName} onChange={e => setNewName(e.target.value)} /></div><div className="form-group" style={{ flex: 1 }}><label>Cor</label><input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} style={{ width: '100%', height: 40, border: 'none', borderRadius: 8, cursor: 'pointer' }} /></div></div>
          <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button><button className="btn btn-primary" onClick={handleCreate}>Criar</button></div>
        </div></div>
      )}
    </div>
  )
}
