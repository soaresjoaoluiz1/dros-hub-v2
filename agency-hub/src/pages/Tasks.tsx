import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  fetchTasks, fetchClients, fetchDepartments, fetchUsers, fetchCategories, fetchStages,
  createTask, createTaskRequest, createMaeTask, addSubtask, saveTaskAsTemplate, addChecklistItem, bulkMoveTasks, bulkAssignTasks, formatNumber,
  type Task, type Client, type Department, type User as UserT, type TaskCategory, type PipelineStage,
} from '../lib/api'
import { Plus, Clock, Building2, User, ExternalLink, Download, AlertTriangle, CheckSquare, Square, Users, ArrowRight, ArrowUpDown, Filter, X, Repeat } from 'lucide-react'
import { useToast } from '../components/Toast'
import TaskTemplateModal from '../components/TaskTemplateModal'
import AssigneesMultiSelect from '../components/AssigneesMultiSelect'
import ApplyTemplatePicker from '../components/ApplyTemplatePicker'

function timeAgo(d: string) {
  // DB salva datetime ja em horario de Brasilia (UTC-3) sem marcador de TZ.
  // Interpretamos manualmente como BRT e convertemos pra UTC pra comparar com Date.now().
  const [datePart, timePartRaw] = d.split(/[ T]/)
  const [y, mo, da] = datePart.split('-').map(Number)
  const [h, mi, s] = ((timePartRaw || '00:00:00').split(':').map(Number)) as [number, number, number]
  const utcMs = Date.UTC(y, (mo || 1) - 1, da || 1, (h || 0) + 3, mi || 0, s || 0)
  const m = Math.floor((Date.now() - utcMs) / 60000)
  if (m < 0) return 'agora'
  if (m < 60) return `${m}m`
  const hr = Math.floor(m / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.floor(hr / 24)}d`
}
// Formata YYYY-MM-DD (ou ISO) pra DD/MM
function formatDDMM(iso: string | null | undefined): string {
  if (!iso) return '-'
  const s = iso.slice(0, 10)
  const [_, mm, dd] = s.split('-')
  if (!mm || !dd) return '-'
  return `${dd}/${mm}`
}
function todayStr() { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}` }
function isOverdue(d: string | null) { return d ? d.slice(0, 10) < todayStr() : false }
function isDueSoon(d: string | null) {
  if (!d || isOverdue(d)) return false
  const ms = new Date(d + 'T23:59:59').getTime() - Date.now()
  return ms >= 0 && ms < 2 * 86400000
}

const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  urgent: { bg: 'rgba(255,107,107,0.15)', text: '#FF6B6B' },
  high: { bg: 'rgba(255,170,131,0.15)', text: '#FFAA83' },
  normal: { bg: 'rgba(255,255,255,0.05)', text: '#A8A3B8' },
  low: { bg: 'rgba(255,255,255,0.03)', text: '#6B6580' },
}

export default function Tasks() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { toast } = useToast()
  const isDono = user?.role === 'dono'
  const isFunc = user?.role === 'funcionario' || user?.role === 'gerente'
  const isCliente = user?.role === 'cliente'
  // Persistencia dos filtros/sort/pagina — mantem estado ao navegar pra TaskDetail e voltar
  const SS_KEY = 'hub_tasks_state_v1'
  const savedState = (() => {
    try { return JSON.parse(sessionStorage.getItem(SS_KEY) || '{}') } catch { return {} }
  })()
  const [saving, setSaving] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState<number>(savedState.page || 1)
  const [loading, setLoading] = useState(true)
  const [clients, setClients] = useState<Client[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [allUsers, setAllUsers] = useState<UserT[]>([])
  const [categories, setCategories] = useState<TaskCategory[]>([])
  const [stages, setStages] = useState<PipelineStage[]>([])
  // Filters (persistidos)
  const [search, setSearch] = useState<string>(savedState.search || '')
  const [filterClient, setFilterClient] = useState<string>(savedState.filterClient || '')
  const [filterStage, setFilterStage] = useState<string>(savedState.filterStage || '')
  const [filterStages, setFilterStages] = useState<Set<string>>(new Set(savedState.filterStages || []))
  const [showStageFilter, setShowStageFilter] = useState(false)
  const [filterDept, setFilterDept] = useState<string>(savedState.filterDept || '')
  const [filterPriority, setFilterPriority] = useState<string>(savedState.filterPriority || '')
  const [filterAssigned, setFilterAssigned] = useState<string>(
    savedState.filterAssigned !== undefined ? savedState.filterAssigned : (isFunc ? String(user?.id || '') : '')
  )
  const [dateFrom, setDateFrom] = useState<string>(savedState.dateFrom || '')
  const [dateTo, setDateTo] = useState<string>(savedState.dateTo || '')
  const [dateField, setDateField] = useState<string>(savedState.dateField || 'created')
  // Sort (persistido)
  const [sortField, setSortField] = useState<string>(savedState.sortField || 'updated_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(savedState.sortDir || 'desc')
  // Modal
  const [showNew, setShowNew] = useState(false)
  const [showNewMae, setShowNewMae] = useState(false)
  const [showNewRecurring, setShowNewRecurring] = useState(false)
  const [showRequest, setShowRequest] = useState(false)
  const [newRequest, setNewRequest] = useState({ title: '', description: '', drive_link_raw: '' })
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()
  const [newTask, setNewTask] = useState({ title: '', description: '', client_id: '', category_id: '', department_id: '', assigned_to: [] as string[], due_date: today, priority: 'normal', drive_link: '' })
  const [newTaskChecklist, setNewTaskChecklist] = useState<string[]>([])
  const [newMae, setNewMae] = useState({ title: '', client_id: '', description: '', due_date: today, category_id: '', department_id: '', priority: 'normal', assigned_to: [] as string[], drive_link: '', drive_link_raw: '', approval_link: '', approval_text: '', publish_date: '', publish_objective: '', sequential_subtasks: false })
  const [newMaeIsCarrossel, setNewMaeIsCarrossel] = useState(false)
  const [newMaeFiles, setNewMaeFiles] = useState<string[]>([''])
  const [newMaeSubs, setNewMaeSubs] = useState<Array<{ title: string; priority: string; department_id: string; assigned_to: string[] }>>([])
  const [newMaeSaveAsTemplate, setNewMaeSaveAsTemplate] = useState(false)
  const [newMaeShowApproval, setNewMaeShowApproval] = useState(false)
  // Bulk
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [showBulkStage, setShowBulkStage] = useState(false)
  const [showBulkAssign, setShowBulkAssign] = useState(false)
  const [showApplyTemplate, setShowApplyTemplate] = useState(false)

  useEffect(() => {
    if (isDono || isFunc) { fetchClients().then(setClients); fetchDepartments().then(setDepartments); fetchUsers().then(setAllUsers) }
    fetchCategories().then(setCategories); fetchStages().then(setStages)
  }, [isDono])

  const loadTasks = () => {
    setLoading(true)
    const filters: any = { search, page, limit: 30 }
    if (filterClient) filters.client_id = +filterClient
    if (filterStages.size === 1) filters.stage = [...filterStages][0]
    if (filterDept) filters.department_id = +filterDept
    if (filterPriority) filters.priority = filterPriority
    if (filterAssigned) filters.assigned_to = +filterAssigned
    if (dateFrom) filters.date_from = dateFrom
    if (dateTo) filters.date_to = dateTo
    if ((dateFrom || dateTo) && dateField && dateField !== 'created') filters.date_field = dateField
    fetchTasks(filters).then(d => {
      // Client-side sort
      const sorted = [...d.tasks].sort((a, b) => {
        let va: any = (a as any)[sortField], vb: any = (b as any)[sortField]
        if (sortField === 'due_date') { va = va || '9999'; vb = vb || '9999' }
        if (va < vb) return sortDir === 'asc' ? -1 : 1
        if (va > vb) return sortDir === 'asc' ? 1 : -1
        return 0
      })
      setTasks(sorted); setTotal(d.total)
    }).finally(() => setLoading(false))
  }

  useEffect(loadTasks, [search, filterClient, filterStage, filterStages.size, filterDept, filterPriority, filterAssigned, dateFrom, dateTo, dateField, page, sortField, sortDir])
  // Salva estado no sessionStorage sempre que qualquer filtro/sort/pagina mudar
  useEffect(() => {
    try {
      sessionStorage.setItem(SS_KEY, JSON.stringify({
        search, filterClient, filterStage, filterStages: [...filterStages],
        filterDept, filterPriority, filterAssigned,
        dateFrom, dateTo, dateField, page, sortField, sortDir,
      }))
    } catch {}
  }, [search, filterClient, filterStage, filterStages, filterDept, filterPriority, filterAssigned, dateFrom, dateTo, dateField, page, sortField, sortDir])

  // Client-side multi-stage filter
  const filteredTasks = filterStages.size > 1 ? tasks.filter(t => filterStages.has(t.stage)) : tasks

  const handleCreate = async () => {
    if (!newTask.title || !newTask.client_id) return
    setSaving(true)
    try {
      const created = await createTask({ ...newTask, client_id: +newTask.client_id, category_id: newTask.category_id ? +newTask.category_id : undefined, department_id: newTask.department_id ? +newTask.department_id : undefined, assigned_to: newTask.assigned_to.map(Number) } as any)
      // Cria checklist items (se houver) em batch
      const validItems = newTaskChecklist.filter(t => t && t.trim())
      for (const text of validItems) {
        try { await addChecklistItem(created.id, text.trim()) } catch (e) { console.error('checklist:', e) }
      }
      setShowNew(false)
      setNewTask({ title: '', description: '', client_id: '', category_id: '', department_id: '', assigned_to: [] as string[], due_date: today, priority: 'normal', drive_link: '' })
      setNewTaskChecklist([])
      loadTasks()
      toast(`Tarefa criada${validItems.length > 0 ? ` com ${validItems.length} item(s) no checklist` : ''}`)
    } catch (err: any) { toast(err.message || 'Erro ao criar tarefa', 'error') }
    finally { setSaving(false) }
  }

  const handleCreateMae = async () => {
    if (!newMae.title || !newMae.client_id) return
    setSaving(true)
    try {
      const validSubs = newMaeSubs.filter(s => s.title && s.title.trim())
      const approval_files = newMaeIsCarrossel ? newMaeFiles.filter(s => s && s.trim()) : (newMae.approval_link ? [newMae.approval_link] : [])
      const created = await createMaeTask({
        client_id: +newMae.client_id, title: newMae.title,
        description: newMae.description || undefined,
        due_date: newMae.due_date || undefined,
        category_id: newMae.category_id ? +newMae.category_id : undefined,
        department_id: newMae.department_id ? +newMae.department_id : undefined,
        priority: newMae.priority,
        assigned_to: newMae.assigned_to.map(Number),
        drive_link: newMae.drive_link || undefined,
        drive_link_raw: newMae.drive_link_raw || undefined,
        approval_files: approval_files.length > 0 ? approval_files : undefined,
        approval_text: newMae.approval_text || undefined,
        publish_date: newMae.publish_date || undefined,
        publish_objective: newMae.publish_objective || undefined,
        sequential_subtasks: newMae.sequential_subtasks,
      })
      // Cria subtarefas inline (se houver)
      let subsCreated = 0
      let subsFailed = 0
      for (const sub of validSubs) {
        try {
          await addSubtask(created.id, {
            title: sub.title.trim(),
            priority: sub.priority || 'normal',
            department_id: sub.department_id ? +sub.department_id : undefined,
            assigned_to: sub.assigned_to.map(Number),
            due_date: newMae.due_date || undefined,
          })
          subsCreated++
        } catch (subErr: any) {
          console.error('Falha ao criar subtarefa:', sub.title, subErr)
          subsFailed++
        }
      }
      // Salva como modelo se marcado
      let templateSaved = false
      if (newMaeSaveAsTemplate) {
        try {
          await saveTaskAsTemplate(created.id, newMae.title)
          templateSaved = true
        } catch (tplErr: any) {
          console.error('Falha ao salvar como modelo:', tplErr)
          toast('Mae criada mas nao consegui salvar como modelo: ' + (tplErr.message || 'erro'), 'error')
        }
      }
      setShowNewMae(false)
      setNewMae({ title: '', client_id: '', description: '', due_date: today, category_id: '', department_id: '', priority: 'normal', assigned_to: [], drive_link: '', drive_link_raw: '', approval_link: '', approval_text: '', publish_date: '', publish_objective: '', sequential_subtasks: false })
      setNewMaeIsCarrossel(false); setNewMaeFiles(['']); setNewMaeSubs([]); setNewMaeSaveAsTemplate(false); setNewMaeShowApproval(false)
      loadTasks()
      const parts: string[] = ['Tarefa Mae criada']
      if (subsCreated > 0) parts.push(`${subsCreated} subtarefa${subsCreated > 1 ? 's' : ''}`)
      if (subsFailed > 0) parts.push(`${subsFailed} falharam`)
      if (templateSaved) parts.push('modelo salvo')
      toast(parts.join(' · '))
    } catch (err: any) { toast(err.message || 'Erro ao criar tarefa mae', 'error') }
    finally { setSaving(false) }
  }

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const toggleSelect = (id: number) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleSelectAll = () => { selected.size === tasks.length ? setSelected(new Set()) : setSelected(new Set(tasks.map(t => t.id))) }

  const handleBulkStage = async (stage: string) => { await bulkMoveTasks([...selected], stage); setSelected(new Set()); setShowBulkStage(false); loadTasks() }
  const handleBulkAssign = async (userId: number | null) => { await bulkAssignTasks([...selected], userId); setSelected(new Set()); setShowBulkAssign(false); loadTasks() }

  const handleExport = async () => {
    const token = localStorage.getItem('dros_hub_token')
    const params = new URLSearchParams()
    if (filterClient) params.set('client_id', filterClient)
    if (filterStage) params.set('stage', filterStage)
    if (filterDept) params.set('department_id', filterDept)
    if (dateFrom) params.set('date_from', dateFrom)
    if (dateTo) params.set('date_to', dateTo)
    const res = await fetch(`/api/tasks/export?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `tarefas-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  const SortHeader = ({ field, children }: { field: string; children: React.ReactNode }) => (
    <th className={field === 'due_date' || field === 'created_at' ? 'right' : ''} style={{ cursor: 'pointer' }} onClick={() => toggleSort(field)}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{children} {sortField === field && <ArrowUpDown size={10} style={{ color: '#FFB300' }} />}</span>
    </th>
  )

  return (
    <div>
      <div className="page-header">
        <h1>Tarefas <span style={{ fontSize: 14, color: '#A8A3B8', fontWeight: 400 }}>({formatNumber(total)})</span></h1>
        <div className="page-header-actions">
          {isDono && <button className="btn btn-secondary btn-sm" onClick={handleExport}><Download size={14} /> Exportar</button>}
          {(isDono || isFunc) && <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Nova Tarefa</button>}
          {(isDono || isFunc) && <button className="btn btn-secondary btn-sm" onClick={() => setShowNewMae(true)}><Plus size={14} /> Tarefa Mae</button>}
          {(isDono || isFunc) && <button className="btn btn-secondary btn-sm" onClick={() => setShowNewRecurring(true)}><Repeat size={14} /> Recorrencia</button>}
          {isCliente && <button className="btn btn-primary btn-sm" onClick={() => setShowRequest(true)}><Plus size={14} /> Nova Solicitacao</button>}
        </div>
      </div>

      {/* Quick filters */}
      {isFunc && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <button className={`btn btn-sm ${filterAssigned === String(user?.id) ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setFilterAssigned(filterAssigned === String(user?.id) ? '' : String(user?.id)); setPage(1) }}>
            <Filter size={12} /> Minhas Tarefas
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="filter-bar">
        <input className="input search-input" placeholder="Buscar..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        <div style={{ position: 'relative' }}>
          <button className="select" onClick={() => setShowStageFilter(p => !p)} style={{ cursor: 'pointer', minWidth: 150, textAlign: 'left' }}>
            {filterStages.size === 0 ? 'Todas etapas' : filterStages.size === 1 ? stages.find(s => filterStages.has(s.slug))?.name : `${filterStages.size} etapas`} ▾
          </button>
          {showStageFilter && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 6, minWidth: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
              <button onClick={() => { setFilterStages(new Set()); setFilterStage(''); setPage(1) }} style={{ display: 'block', width: '100%', padding: '6px 10px', background: filterStages.size === 0 ? 'rgba(255,179,0,0.12)' : 'transparent', border: 'none', borderRadius: 4, color: filterStages.size === 0 ? '#FFB300' : '#A8A3B8', fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>Todas etapas</button>
              {stages.map(s => {
                const on = filterStages.has(s.slug)
                return <button key={s.slug} onClick={() => {
                  setFilterStages(prev => {
                    const next = new Set(prev)
                    if (on) next.delete(s.slug); else next.add(s.slug)
                    setFilterStage(next.size === 1 ? [...next][0] : '')
                    setPage(1)
                    return next
                  })
                }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 10px', background: on ? 'rgba(255,179,0,0.08)' : 'transparent', border: 'none', borderRadius: 4, color: on ? '#FFB300' : '#A8A3B8', fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, border: `2px solid ${on ? s.color : 'rgba(255,255,255,0.12)'}`, background: on ? s.color : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: on ? '#0A0118' : 'transparent', flexShrink: 0 }}>{on ? '✓' : ''}</span>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />{s.name}
                </button>
              })}
            </div>
          )}
        </div>
        {isDono && <select className="select" value={filterClient} onChange={e => { setFilterClient(e.target.value); setPage(1) }}><option value="">Todos clientes</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
        <select className="select" value={filterPriority} onChange={e => { setFilterPriority(e.target.value); setPage(1) }}><option value="">Prioridades</option><option value="urgent">Urgente</option><option value="high">Alta</option><option value="normal">Normal</option><option value="low">Baixa</option></select>
        {isDono && <select className="select" value={filterAssigned} onChange={e => { setFilterAssigned(e.target.value); setPage(1) }}><option value="">Todos</option>{allUsers.filter(u => u.role !== 'cliente').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
      </div>
      <div className="filter-bar" style={{ marginTop: -6 }}>
        <select className="select" value={dateField} onChange={e => { setDateField(e.target.value); setPage(1) }} style={{ width: 150 }} title="Qual campo de data usar no filtro abaixo">
          <option value="created">Data de criacao</option>
          <option value="due">Prazo</option>
          <option value="completed">Data de conclusao</option>
        </select>
        <input className="input" type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }} style={{ width: 150 }} />
        <span style={{ color: '#6B6580', fontSize: 12 }}>ate</span>
        <input className="input" type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }} style={{ width: 150 }} />
        {(search || filterStage || filterStages.size > 0 || filterClient || filterPriority || filterAssigned || dateFrom || dateTo || dateField !== 'created') && (
          <button className="btn btn-secondary btn-sm" onClick={() => { setSearch(''); setFilterStage(''); setFilterStages(new Set()); setFilterClient(''); setFilterPriority(''); setFilterAssigned(isFunc ? String(user?.id) : ''); setDateFrom(''); setDateTo(''); setDateField('created'); setPage(1) }}>Limpar</button>
        )}
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && isDono && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 14px', background: 'rgba(255,179,0,0.08)', borderRadius: 8, marginBottom: 12, border: '1px solid rgba(255,179,0,0.15)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#FFB300' }}>{selected.size} selecionadas</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkStage(true)}><ArrowRight size={12} /> Mover</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkAssign(true)}><Users size={12} /> Atribuir</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Cancelar</button>
        </div>
      )}

      {/* Table */}
      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div className="table-card">
          <table>
            <thead><tr>
              {isDono && <th style={{ width: 32 }}><button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B6580' }} onClick={toggleSelectAll}>{selected.size === tasks.length && tasks.length > 0 ? <CheckSquare size={14} /> : <Square size={14} />}</button></th>}
              <SortHeader field="title">Titulo</SortHeader>
              {!isCliente && <th>Cliente</th>}
              <SortHeader field="stage">Etapa</SortHeader>
              {!isCliente && <th>Responsavel</th>}
              {!isCliente && <SortHeader field="priority">Prioridade</SortHeader>}
              {isCliente ? <th className="right">Aguardando</th> : <SortHeader field="due_date">Prazo</SortHeader>}
              <SortHeader field="created_at">Criado</SortHeader>
            </tr></thead>
            <tbody>
              {filteredTasks.map(t => {
                const overdue = isOverdue(t.due_date) && t.stage !== 'concluido' && t.stage !== 'rejeitado'
                const soon = isDueSoon(t.due_date) && !overdue
                const pc = PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.normal
                // For cliente: compute days waiting since moved to aguardando_cliente
                const waitingSince = (t as any).waiting_client_since
                const waitingDays = (isCliente && t.stage === 'aguardando_cliente' && waitingSince)
                  ? Math.max(0, Math.floor((Date.now() - new Date(waitingSince + '-03:00').getTime()) / 86400000))
                  : null
                return (
                  <tr key={t.id} style={{ cursor: 'pointer', background: overdue ? 'rgba(255,107,107,0.03)' : undefined }}>
                    {isDono && <td onClick={e => { e.stopPropagation(); toggleSelect(t.id) }}><span style={{ color: selected.has(t.id) ? '#FFB300' : '#6B6580', cursor: 'pointer' }}>{selected.has(t.id) ? <CheckSquare size={14} /> : <Square size={14} />}</span></td>}
                    <td className="name" onClick={() => navigate(`/tasks/${t.id}`)}>
                      {t.title} {t.drive_link && <ExternalLink size={10} style={{ color: '#5DADE2', marginLeft: 4 }} />}
                      {overdue && <AlertTriangle size={10} style={{ color: '#FF6B6B', marginLeft: 4 }} />}
                      {(t as any).template_id && <Repeat size={10} style={{ color: '#9B59B6', marginLeft: 4 }} aria-label="Tarefa recorrente" />}
                    </td>
                    {!isCliente && <td onClick={() => navigate(`/tasks/${t.id}`)} style={{ fontSize: 12 }}><Building2 size={10} /> {t.client_name}</td>}
                    <td onClick={() => navigate(`/tasks/${t.id}`)}><span className="stage-badge" style={{ background: `${t.stage_color}20`, color: t.stage_color }}>{t.stage_name}</span></td>
                    {!isCliente && <td onClick={() => navigate(`/tasks/${t.id}`)}>{t.assigned_name || <span style={{ color: '#6B6580' }}>-</span>}</td>}
                    {!isCliente && <td onClick={() => navigate(`/tasks/${t.id}`)}><span className="stage-badge" style={{ background: pc.bg, color: pc.text }}>{t.priority === 'urgent' ? '🔴 ' : t.priority === 'high' ? '🟠 ' : ''}{t.priority}</span></td>}
                    {isCliente ? (
                      <td className="right" onClick={() => navigate(`/tasks/${t.id}`)} style={{ color: waitingDays === null ? '#6B6580' : waitingDays > 3 ? '#FF6B6B' : waitingDays > 1 ? '#FBBC04' : '#34C759', fontWeight: waitingDays && waitingDays > 3 ? 700 : 400 }}>
                        {waitingDays === null ? '-' : waitingDays === 0 ? 'Hoje' : `${waitingDays}d`}
                      </td>
                    ) : (
                      <td className="right" onClick={() => navigate(`/tasks/${t.id}`)} style={{ color: overdue ? '#FF6B6B' : soon ? '#FBBC04' : '#6B6580', fontWeight: overdue ? 700 : 400 }}>
                        {formatDDMM(t.due_date)} {overdue && '⚠️'} {soon && '⏰'}
                      </td>
                    )}
                    <td className="right" onClick={() => navigate(`/tasks/${t.id}`)}><Clock size={10} /> {timeAgo(t.created_at)}</td>
                  </tr>
                )
              })}
              {tasks.length === 0 && <tr><td colSpan={isDono ? 8 : isCliente ? 4 : 7} style={{ textAlign: 'center', padding: 40, color: '#6B6580' }}>{(search || filterClient || filterStages.size > 0 || filterAssigned) ? 'Nenhuma tarefa com esses filtros. Tente limpar os filtros.' : 'Nenhuma tarefa encontrada.'}</td></tr>}
            </tbody>
          </table>
          <div style={{ padding: 12, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#6B6580' }}>Mostrando {Math.min(tasks.length, 30)} de {total} tarefas</span>
            {total > 30 && <><button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</button><span style={{ fontSize: 12, color: '#A8A3B8', padding: '4px 8px' }}>Pag {page}/{Math.ceil(total / 30)}</span><button className="btn btn-secondary btn-sm" disabled={page >= Math.ceil(total / 30)} onClick={() => setPage(p => p + 1)}>Proxima</button></>}
          </div>
        </div>
      )}

      {/* New task modal */}
      {showNew && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setShowNew(false))() }}><div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
          <h2>Nova Tarefa</h2>
          <div className="form-group"><label>Titulo *</label><input className="input" value={newTask.title} onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))} /></div>
          <div className="form-group"><label>Descricao</label><textarea className="input" rows={3} value={newTask.description} onChange={e => setNewTask(p => ({ ...p, description: e.target.value }))} /></div>
          <div className="form-row">
            <div className="form-group"><label>Cliente *</label><select className="select" value={newTask.client_id} onChange={e => setNewTask(p => ({ ...p, client_id: e.target.value }))}><option value="">Selecione</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="form-group"><label>Categoria</label><select className="select" value={newTask.category_id} onChange={e => setNewTask(p => ({ ...p, category_id: e.target.value }))}><option value="">Nenhuma</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Departamento</label><select className="select" value={newTask.department_id} onChange={e => setNewTask(p => ({ ...p, department_id: e.target.value }))}><option value="">Nenhum</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <div className="form-group"><label>Responsaveis</label>
              <AssigneesMultiSelect users={allUsers} selected={newTask.assigned_to} onChange={arr => setNewTask(p => ({ ...p, assigned_to: arr }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Prazo</label><input className="input" type="date" value={newTask.due_date} onChange={e => setNewTask(p => ({ ...p, due_date: e.target.value }))} /></div>
            <div className="form-group"><label>Prioridade</label><select className="select" value={newTask.priority} onChange={e => setNewTask(p => ({ ...p, priority: e.target.value }))}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></div>
          </div>
          <div className="form-group"><label>Link Drive (Arquivo Bruto)</label><input className="input" value={newTask.drive_link} onChange={e => setNewTask(p => ({ ...p, drive_link: e.target.value }))} placeholder="https://drive.google.com/..." /></div>

          {/* Checklist inline — bloqueia conclusao ate marcar todos */}
          <div style={{ marginTop: 8, padding: '12px 14px', background: 'rgba(93,173,226,0.04)', border: '1px solid rgba(93,173,226,0.15)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#5DADE2', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Checklist ({newTaskChecklist.filter(t => t.trim()).length})
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNewTaskChecklist(prev => [...prev, ''])} style={{ fontSize: 11 }}>
                <Plus size={11} /> Adicionar
              </button>
            </div>
            {newTaskChecklist.length === 0 ? (
              <div style={{ fontSize: 11, color: '#9B96B0', textAlign: 'center', padding: '6px 0' }}>
                Sem checklist. Se adicionar, a tarefa so pode ser concluida quando todos estiverem marcados.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {newTaskChecklist.map((text, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: '#6B6580', minWidth: 16 }}>{idx + 1}.</span>
                    <input className="input" value={text} onChange={e => setNewTaskChecklist(prev => prev.map((t, i) => i === idx ? e.target.value : t))} placeholder="Ex: Confirmar link, revisar copy, testar..." style={{ flex: 1, fontSize: 12 }} autoFocus={text === ''} />
                    <button type="button" className="btn btn-secondary btn-sm btn-icon" onClick={() => setNewTaskChecklist(prev => prev.filter((_, i) => i !== idx))} title="Remover" style={{ padding: '5px 7px' }}><X size={11} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button><button className="btn btn-primary" onClick={handleCreate} disabled={saving}>{saving ? 'Criando...' : 'Criar Tarefa'}</button></div>
        </div></div>
      )}

      {/* New Mae generica modal */}
      {showNewMae && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setShowNewMae(false))() }}><div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
          <h2 style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span>Nova Tarefa Mae</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowApplyTemplate(true)} style={{ fontSize: 11, color: '#7ee787', borderColor: 'rgba(126,231,135,0.35)' }}>
              <Repeat size={11} /> Usar modelo
            </button>
          </h2>
          <p style={{ fontSize: 12, color: '#9B96B0', marginTop: -6, marginBottom: 16 }}>Cria uma tarefa-mae vazia. Voce adiciona as subtarefas manualmente depois. Quando todas concluirem, a mae auto-conclui.</p>
          <div className="form-group"><label>Titulo *</label><input className="input" value={newMae.title} onChange={e => setNewMae(p => ({ ...p, title: e.target.value }))} placeholder="Ex: Campanha Black Friday 2026" /></div>
          <div className="form-group"><label>Descricao</label><textarea className="input" rows={3} value={newMae.description} onChange={e => setNewMae(p => ({ ...p, description: e.target.value }))} /></div>
          <div className="form-row">
            <div className="form-group"><label>Cliente *</label><select className="select" value={newMae.client_id} onChange={e => setNewMae(p => ({ ...p, client_id: e.target.value }))}><option value="">Selecione</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="form-group"><label>Categoria</label><select className="select" value={newMae.category_id} onChange={e => setNewMae(p => ({ ...p, category_id: e.target.value }))}><option value="">Nenhuma</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Departamento</label><select className="select" value={newMae.department_id} onChange={e => setNewMae(p => ({ ...p, department_id: e.target.value }))}><option value="">Nenhum</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <div className="form-group">
              <label>Responsaveis</label>
              <AssigneesMultiSelect users={allUsers} selected={newMae.assigned_to} onChange={arr => setNewMae(p => ({ ...p, assigned_to: arr }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Prazo</label><input className="input" type="date" value={newMae.due_date} onChange={e => setNewMae(p => ({ ...p, due_date: e.target.value }))} /></div>
            <div className="form-group"><label>Prioridade</label><select className="select" value={newMae.priority} onChange={e => setNewMae(p => ({ ...p, priority: e.target.value }))}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></div>
          </div>
          <div className="form-group" style={{ padding: 10, background: 'rgba(255,179,0,0.06)', border: '1px solid rgba(255,179,0,0.25)', borderRadius: 6 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 0 }}>
              <input type="checkbox" checked={newMae.sequential_subtasks} onChange={e => setNewMae(p => ({ ...p, sequential_subtasks: e.target.checked }))} style={{ marginTop: 3 }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Concluir subtarefas em ordem</div>
                <small style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block', marginTop: 2 }}>Se marcado, a subtarefa 2 so pode ser concluida depois da 1, e assim por diante.</small>
              </div>
            </label>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Link Drive (Arquivo Bruto)</label><input className="input" value={newMae.drive_link_raw} onChange={e => setNewMae(p => ({ ...p, drive_link_raw: e.target.value }))} placeholder="https://drive.google.com/..." /></div>
            <div className="form-group"><label>Link Drive (Arquivo Pronto)</label><input className="input" value={newMae.drive_link} onChange={e => setNewMae(p => ({ ...p, drive_link: e.target.value }))} placeholder="https://drive.google.com/..." /></div>
          </div>
          {/* Conteudo pra aprovacao — accordion (colapsado por default) */}
          <div style={{ marginTop: 8, padding: '10px 14px', background: 'rgba(245,166,35,0.04)', border: '1px solid rgba(245,166,35,0.12)', borderRadius: 10 }}>
            <button
              type="button"
              onClick={() => setNewMaeShowApproval(v => !v)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: '#F5A623', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14 }}>{newMaeShowApproval ? '▼' : '▶'}</span>
                Conteudo pra Aprovacao (opcional)
              </span>
              <span style={{ fontSize: 10, color: '#A8A3B8', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                {newMaeShowApproval ? 'recolher' : 'expandir'}
              </span>
            </button>
            {newMaeShowApproval && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 10 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#A8A3B8', cursor: 'pointer' }}>
                    <input type="checkbox" checked={newMaeIsCarrossel} onChange={e => {
                      const checked = e.target.checked
                      if (checked) { setNewMaeIsCarrossel(true); setNewMaeFiles(newMae.approval_link ? [newMae.approval_link] : ['']) }
                      else { setNewMaeIsCarrossel(false); setNewMae(p => ({ ...p, approval_link: newMaeFiles[0] || '' })) }
                    }} style={{ accentColor: '#FFB300' }} />
                    Carrossel (varios arquivos)
                  </label>
                </div>
                {newMaeIsCarrossel ? (
                  <div className="form-group">
                    <label>Arquivos do carrossel</label>
                    {newMaeFiles.map((url, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{ minWidth: 56, fontSize: 11, color: '#6B6580', fontWeight: 700 }}>Slide {idx + 1}</span>
                        <input className="input" value={url} placeholder="Link do Drive (publico)" style={{ flex: 1 }} onChange={e => setNewMaeFiles(arr => arr.map((x, i) => i === idx ? e.target.value : x))} />
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNewMaeFiles(arr => arr.filter((_, i) => i !== idx))} title="Remover" style={{ padding: '6px 10px' }}><X size={12} /></button>
                      </div>
                    ))}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNewMaeFiles(arr => [...arr, ''])} style={{ marginTop: 4 }}><Plus size={12} /> Adicionar slide</button>
                  </div>
                ) : (
                  <div className="form-group"><label>Link do arquivo finalizado</label><input className="input" value={newMae.approval_link} onChange={e => setNewMae(p => ({ ...p, approval_link: e.target.value }))} placeholder="Link do Drive — compartilhamento: qualquer pessoa com o link" /></div>
                )}
                <div className="form-group"><label>Texto / Legenda</label><textarea className="input" rows={3} value={newMae.approval_text} onChange={e => setNewMae(p => ({ ...p, approval_text: e.target.value }))} placeholder="Legenda do post, texto da publicacao..." /></div>
                <div className="form-row">
                  <div className="form-group"><label>Data da Publicacao</label><input className="input" type="date" value={newMae.publish_date} onChange={e => setNewMae(p => ({ ...p, publish_date: e.target.value }))} /></div>
                  <div className="form-group"><label>Objetivo da Publicacao</label><input className="input" value={newMae.publish_objective} onChange={e => setNewMae(p => ({ ...p, publish_objective: e.target.value }))} placeholder="Ex: Gerar leads..." /></div>
                </div>
              </div>
            )}
          </div>

          {/* Subtarefas inline — cria junto com a mae */}
          <div style={{ marginTop: 14, padding: '14px 16px', background: 'rgba(255,179,0,0.04)', border: '1px solid rgba(255,179,0,0.15)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB300', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Subtarefas ({newMaeSubs.length})
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNewMaeSubs(prev => [...prev, { title: '', priority: 'normal', department_id: '', assigned_to: [] }])} style={{ fontSize: 11 }}>
                <Plus size={11} /> Adicionar
              </button>
            </div>
            {newMaeSubs.length === 0 ? (
              <div style={{ fontSize: 11, color: '#9B96B0', textAlign: 'center', padding: '10px 0' }}>
                Nenhuma. Clica em Adicionar pra ja criar subtarefas junto com a mae (ou deixa vazio e adiciona depois).
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {newMaeSubs.map((sub, idx) => (
                  <div key={idx} style={{ padding: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#FFB30020', color: '#FFB300', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{idx + 1}</span>
                      <input className="input" value={sub.title} onChange={e => setNewMaeSubs(prev => prev.map((s, i) => i === idx ? { ...s, title: e.target.value } : s))} placeholder="Ex: Edicao do video / Design da capa / Postar" style={{ flex: 1, fontSize: 12 }} autoFocus={sub.title === ''} />
                      <button type="button" className="btn btn-secondary btn-sm btn-icon" onClick={() => setNewMaeSubs(prev => prev.filter((_, i) => i !== idx))} title="Remover" style={{ padding: '6px 8px' }}><X size={12} /></button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 6, marginBottom: 6 }}>
                      <select className="select" value={sub.department_id} onChange={e => setNewMaeSubs(prev => prev.map((s, i) => i === idx ? { ...s, department_id: e.target.value } : s))} style={{ fontSize: 11 }}>
                        <option value="">Sem depto</option>
                        {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                      <select className="select" value={sub.priority} onChange={e => setNewMaeSubs(prev => prev.map((s, i) => i === idx ? { ...s, priority: e.target.value } : s))} style={{ fontSize: 11 }}>
                        <option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option>
                      </select>
                    </div>
                    <AssigneesMultiSelect users={allUsers} selected={sub.assigned_to} onChange={arr => setNewMaeSubs(prev => prev.map((s, i) => i === idx ? { ...s, assigned_to: arr } : s))} placeholder="Responsaveis da subtarefa" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Salvar como modelo */}
          <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(126,231,135,0.05)', border: '1px solid rgba(126,231,135,0.20)', borderRadius: 8 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', margin: 0 }}>
              <input type="checkbox" checked={newMaeSaveAsTemplate} onChange={e => setNewMaeSaveAsTemplate(e.target.checked)} style={{ marginTop: 3, accentColor: '#7ee787' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#7ee787' }}>Tambem salvar como modelo</div>
                <small style={{ color: '#9B96B0', fontSize: 11, display: 'block', marginTop: 2 }}>Salva essa mae + subtarefas na biblioteca de modelos. Depois eh so clicar em "Usar modelo" pra recriar rapido.</small>
              </div>
            </label>
          </div>

          <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setShowNewMae(false)}>Cancelar</button><button className="btn btn-primary" onClick={handleCreateMae} disabled={saving || !newMae.title || !newMae.client_id}>{saving ? 'Criando...' : 'Criar Tarefa Mae'}</button></div>
        </div></div>
      )}

      {/* Client request modal */}
      {showRequest && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setShowRequest(false))() }}><div className="modal" onClick={e => e.stopPropagation()}>
          <h2>Nova Solicitacao</h2>
          <p style={{ fontSize: 12, color: '#9B96B0', marginTop: -6, marginBottom: 16 }}>Sua solicitacao sera enviada para aprovacao da equipe. Apos aprovada, entrara em producao.</p>
          <div className="form-group"><label>Titulo *</label><input className="input" value={newRequest.title} onChange={e => setNewRequest(p => ({ ...p, title: e.target.value }))} placeholder="Ex: Mudar bio do perfil..." /></div>
          <div className="form-group"><label>Descricao</label><textarea className="input" rows={4} value={newRequest.description} onChange={e => setNewRequest(p => ({ ...p, description: e.target.value }))} placeholder="Detalhes da solicitacao..." /></div>
          <div className="form-group"><label>Link dos arquivos (opcional)</label><input className="input" value={newRequest.drive_link_raw} onChange={e => setNewRequest(p => ({ ...p, drive_link_raw: e.target.value }))} placeholder="https://drive.google.com/... ou outro" /></div>
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={() => setShowRequest(false)}>Cancelar</button>
            <button className="btn btn-primary" disabled={saving || !newRequest.title} onClick={async () => { setSaving(true); try { await createTaskRequest({ title: newRequest.title, description: newRequest.description, drive_link_raw: newRequest.drive_link_raw || undefined }); setShowRequest(false); setNewRequest({ title: '', description: '', drive_link_raw: '' }); loadTasks(); toast('Solicitacao enviada!') } catch (err: any) { toast(err.message || 'Erro ao enviar', 'error') } finally { setSaving(false) } }}>{saving ? 'Enviando...' : 'Enviar Solicitacao'}</button>
          </div>
        </div></div>
      )}

      {/* Bulk stage modal */}
      {showBulkStage && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setShowBulkStage(false))() }}><div className="modal" onClick={e => e.stopPropagation()}>
          <h2>Mover {selected.size} tarefas</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{stages.map(s => <button key={s.id} className="btn btn-secondary" onClick={() => handleBulkStage(s.slug)} style={{ justifyContent: 'flex-start' }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color }} />{s.name}</button>)}</div>
        </div></div>
      )}

      {/* Bulk assign modal */}
      {showBulkAssign && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setShowBulkAssign(false))() }}><div className="modal" onClick={e => e.stopPropagation()}>
          <h2>Atribuir {selected.size} tarefas</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button className="btn btn-secondary" onClick={() => handleBulkAssign(null)} style={{ justifyContent: 'flex-start' }}>Remover responsavel</button>
            {allUsers.filter(u => u.role !== 'cliente').map(u => <button key={u.id} className="btn btn-secondary" onClick={() => handleBulkAssign(u.id)} style={{ justifyContent: 'flex-start' }}><User size={14} /> {u.name}</button>)}
          </div>
        </div></div>
      )}

      <TaskTemplateModal open={showNewRecurring} onClose={() => setShowNewRecurring(false)} onSaved={() => {}} />

      <ApplyTemplatePicker
        open={showApplyTemplate}
        clientId={newMae.client_id ? +newMae.client_id : null}
        onClose={() => setShowApplyTemplate(false)}
        onApplied={(tid) => { setShowNewMae(false); loadTasks(); navigate(`/tasks/${tid}`) }}
      />
    </div>
  )
}
