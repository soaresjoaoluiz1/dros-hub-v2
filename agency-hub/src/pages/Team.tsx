import { useState, useEffect } from 'react'
import { fetchUsers, fetchClients, fetchDepartments, createUser, updateUser, updateUserDepartments, deleteUser, type User as UserT, type Client, type Department } from '../lib/api'
import { UsersRound, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'

export default function Team() {
  const [users, setUsers] = useState<UserT[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'funcionario', client_id: '' })
  const [editDepts, setEditDepts] = useState<{ userId: number; deptIds: number[] } | null>(null)

  const load = () => { setLoading(true); Promise.all([fetchUsers(), fetchClients(), fetchDepartments()]).then(([u, c, d]) => { setUsers(u); setClients(c); setDepartments(d) }).finally(() => setLoading(false)) }
  useEffect(load, [])

  const handleCreate = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) return
    await createUser({ ...newUser, client_id: newUser.client_id ? +newUser.client_id : undefined })
    setShowNew(false); setNewUser({ name: '', email: '', password: '', role: 'funcionario', client_id: '' }); load()
  }

  const handleSaveDepts = async () => { if (editDepts) { await updateUserDepartments(editDepts.userId, editDepts.deptIds); setEditDepts(null); load() } }

  const handleChangeRole = async (u: UserT, newRole: 'gerente' | 'funcionario') => {
    const action = newRole === 'gerente' ? 'promover a Gerente' : 'rebaixar para Funcionario'
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} ${u.name}?`)) return
    try { await updateUser(u.id, { role: newRole }); load() }
    catch (e: any) { alert('Erro: ' + e.message) }
  }

  const funcionarios = users.filter(u => u.role === 'funcionario')
  const clientes = users.filter(u => u.role === 'cliente')
  const donos = users.filter(u => u.role === 'dono')
  const gerentes = users.filter(u => u.role === 'gerente')

  return (
    <div>
      <div className="page-header"><h1><UsersRound size={22} style={{ marginRight: 8 }} /> Equipe</h1><button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Novo Usuario</button></div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <>
          {donos.length > 0 && <section className="dash-section"><div className="section-title">Donos/Admins</div><div className="table-card"><table><thead><tr><th>Nome</th><th>Email</th><th>Status</th></tr></thead><tbody>{donos.map(u => <tr key={u.id}><td className="name">{u.name}</td><td>{u.email}</td><td><span style={{ color: '#34C759' }}>Ativo</span></td></tr>)}</tbody></table></div></section>}

          {gerentes.length > 0 && (
            <section className="dash-section">
              <div className="section-title">Gerentes ({gerentes.length})</div>
              <div className="table-card"><table><thead><tr><th>Nome</th><th>Email</th><th>Departamentos</th><th>Status</th><th className="right">Acoes</th></tr></thead><tbody>
                {gerentes.map(u => (
                  <tr key={u.id}>
                    <td className="name">{u.name}</td><td>{u.email}</td>
                    <td>{u.departments?.length ? u.departments.map(d => <span key={d.id} className="tag-pill" style={{ background: `${d.color}20`, color: d.color, marginRight: 4 }}>{d.name}</span>) : <span style={{ color: '#6B6580' }}>Todos</span>}</td>
                    <td><span style={{ color: u.is_active ? '#34C759' : '#FF6B6B' }}>{u.is_active ? 'Ativo' : 'Inativo'}</span></td>
                    <td className="right" style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditDepts({ userId: u.id, deptIds: u.departments?.map(d => d.id) || [] })}>Departamentos</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleChangeRole(u, 'funcionario')} title="Rebaixar para Funcionario"><ChevronDown size={12} /> Rebaixar</button>
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => { if (confirm(`Remover ${u.name}?`)) { deleteUser(u.id).then(load) } }}><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}
              </tbody></table></div>
            </section>
          )}

          <section className="dash-section">
            <div className="section-title">Funcionarios ({funcionarios.length})</div>
            <div className="table-card"><table><thead><tr><th>Nome</th><th>Email</th><th>Departamentos</th><th>Status</th><th className="right">Acoes</th></tr></thead><tbody>
              {funcionarios.map(u => (
                <tr key={u.id}>
                  <td className="name">{u.name}</td><td>{u.email}</td>
                  <td>{u.departments?.length ? u.departments.map(d => <span key={d.id} className="tag-pill" style={{ background: `${d.color}20`, color: d.color, marginRight: 4 }}>{d.name}</span>) : <span style={{ color: '#6B6580' }}>Nenhum</span>}</td>
                  <td><span style={{ color: u.is_active ? '#34C759' : '#FF6B6B' }}>{u.is_active ? 'Ativo' : 'Inativo'}</span></td>
                  <td className="right" style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditDepts({ userId: u.id, deptIds: u.departments?.map(d => d.id) || [] })}>Departamentos</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleChangeRole(u, 'gerente')} title="Promover a Gerente" style={{ color: '#FFB300' }}><ChevronUp size={12} /> Promover</button>
                    <button className="btn btn-danger btn-sm btn-icon" onClick={() => { if (confirm(`Remover ${u.name}?`)) { deleteUser(u.id).then(load) } }}><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
              {funcionarios.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: '#6B6580' }}>Nenhum funcionario</td></tr>}
            </tbody></table></div>
          </section>

          <section className="dash-section">
            <div className="section-title">Usuarios Cliente ({clientes.length})</div>
            <div className="table-card"><table><thead><tr><th>Nome</th><th>Email</th><th>Cliente</th><th>Status</th></tr></thead><tbody>
              {clientes.map(u => <tr key={u.id}><td className="name">{u.name}</td><td>{u.email}</td><td>{u.client_name || '-'}</td><td><span style={{ color: u.is_active ? '#34C759' : '#FF6B6B' }}>{u.is_active ? 'Ativo' : 'Inativo'}</span></td></tr>)}
              {clientes.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 30, color: '#6B6580' }}>Nenhum usuario cliente</td></tr>}
            </tbody></table></div>
          </section>
        </>
      )}

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}><div className="modal" onClick={e => e.stopPropagation()}>
          <h2>Novo Usuario</h2>
          <div className="form-group"><label>Nome *</label><input className="input" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} /></div>
          <div className="form-row"><div className="form-group"><label>Email *</label><input className="input" type="email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} /></div><div className="form-group"><label>Senha *</label><input className="input" type="password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} /></div></div>
          <div className="form-row">
            <div className="form-group"><label>Role</label><select className="select" value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}><option value="funcionario">Funcionario</option><option value="gerente">Gerente</option><option value="cliente">Cliente</option><option value="dono">Dono/Admin</option></select></div>
            {newUser.role === 'cliente' && <div className="form-group"><label>Cliente</label><select className="select" value={newUser.client_id} onChange={e => setNewUser(p => ({ ...p, client_id: e.target.value }))}><option value="">Selecione</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
          </div>
          <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button><button className="btn btn-primary" onClick={handleCreate}>Criar</button></div>
        </div></div>
      )}

      {editDepts && (
        <div className="modal-overlay" onClick={() => setEditDepts(null)}><div className="modal" onClick={e => e.stopPropagation()}>
          <h2>Departamentos</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {departments.map(d => (
              <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', background: editDepts.deptIds.includes(d.id) ? `${d.color}10` : 'transparent' }}>
                <input type="checkbox" checked={editDepts.deptIds.includes(d.id)} onChange={() => setEditDepts(prev => prev ? ({ ...prev, deptIds: prev.deptIds.includes(d.id) ? prev.deptIds.filter(id => id !== d.id) : [...prev.deptIds, d.id] }) : null)} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: d.color }} />{d.name}
              </label>
            ))}
          </div>
          <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setEditDepts(null)}>Cancelar</button><button className="btn btn-primary" onClick={handleSaveDepts}>Salvar</button></div>
        </div></div>
      )}
    </div>
  )
}
