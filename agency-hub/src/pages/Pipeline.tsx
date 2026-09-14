import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useSSE } from '../context/SSEContext'
import { fetchPipelineTasks, fetchClients, fetchDepartments, fetchUsers, fetchCategories, createTask, createEditorialTask, createMaeTask, addSubtask, saveTaskAsTemplate, addChecklistItem, moveTaskStage, type Task, type PipelineStage, type Client, type Department, type User as UserT, type TaskCategory } from '../lib/api'
import { Clock, Building2, User, ExternalLink, ChevronDown, ChevronRight, ArrowRight, Search, AlertTriangle, Plus, Layers, X, Repeat } from 'lucide-react'
import { useToast } from '../components/Toast'
import TaskTemplateModal from '../components/TaskTemplateModal'
import AssigneesMultiSelect from '../components/AssigneesMultiSelect'
import ApplyTemplatePicker from '../components/ApplyTemplatePicker'

function timeAgo(d: string) {
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
function todayStr() { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}` }
function isOverdue(d: string | null) { return d ? d.slice(0, 10) < todayStr() : false }
function useIsMobile() { const [m, setM] = useState(window.innerWidth <= 640); useEffect(() => { const h = () => setM(window.innerWidth <= 640); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h) }, []); return m }

const PRIORITY_COLORS: Record<string, string> = { low: '#6B6580', normal: '#5DADE2', high: '#FFAA83', urgent: '#FF6B6B' }

// Sort de cards dentro de cada coluna do Kanban: prazo mais proximo/antigo primeiro.
// Tarefas SEM due_date vao pro final (nulls last). Empate no due_date desempata por id desc
// (recem-criada aparece antes se prazos batem — comportamento estavel).
function sortByDueDateAsc(a: any, b: any) {
  const ad = a.due_date ? a.due_date.slice(0, 10) : ''
  const bd = b.due_date ? b.due_date.slice(0, 10) : ''
  if (!ad && !bd) return (b.id || 0) - (a.id || 0)
  if (!ad) return 1
  if (!bd) return -1
  if (ad !== bd) return ad < bd ? -1 : 1
  return (b.id || 0) - (a.id || 0)
}

export default function Pipeline() {
  const { user } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [saving, setSaving] = useState(false)
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [clients, setClients] = useState<Client[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [filterClient, setFilterClient] = useState('')
  const [filterDept, setFilterDept] = useState('')
  const [draggedTask, setDraggedTask] = useState<number | null>(null)
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set())
  // Desktop: quais colunas mostram TODAS as tarefas (default: primeiras 10)
  const [showAllInStage, setShowAllInStage] = useState<Set<string>>(new Set())
  const STAGE_TASK_LIMIT = 10
  const [moveTaskId, setMoveTaskId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showTerminal, setShowTerminal] = useState(() => localStorage.getItem('pipeline_show_terminal') === '1')
  const [viewMode, setViewMode] = useState<'all' | 'maes' | 'subtarefas'>(() => (localStorage.getItem('pipeline_view_mode') as any) || 'all')
  const [groupByClient, setGroupByClient] = useState(() => localStorage.getItem('pipeline_group_client') === '1')
  const [categories, setCategories] = useState<TaskCategory[]>([])
  const [showNew, setShowNew] = useState(false)
  const [showNewEditorial, setShowNewEditorial] = useState(false)
  const [showNewMae, setShowNewMae] = useState(false)
  const [showNewRecurring, setShowNewRecurring] = useState(false)
  const [showApplyTemplate, setShowApplyTemplate] = useState(false)
  const [newEditorial, setNewEditorial] = useState({ client_id: '', month_label: '', num_posts: '8', num_videos: '4', due_date: '', category_id: '' })
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()
  const [newMae, setNewMae] = useState({ title: '', client_id: '', description: '', due_date: today, category_id: '', department_id: '', priority: 'normal', assigned_to: [] as string[], drive_link: '', drive_link_raw: '', approval_link: '', approval_text: '', publish_date: '', publish_objective: '', sequential_subtasks: false })
  const [newMaeIsCarrossel, setNewMaeIsCarrossel] = useState(false)
  const [newMaeFiles, setNewMaeFiles] = useState<string[]>([''])
  const [newMaeSubs, setNewMaeSubs] = useState<Array<{ title: string; priority: string; department_id: string; assigned_to: string[] }>>([])
  const [newMaeSaveAsTemplate, setNewMaeSaveAsTemplate] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', description: '', client_id: '', category_id: '', department_id: '', assigned_to: [] as string[], due_date: today, priority: 'normal', drive_link_raw: '', drive_link: '', approval_link: '', approval_text: '', publish_date: '', publish_objective: '', recording_date: '', recording_time: '' })
  const [newTaskIsCarrossel, setNewTaskIsCarrossel] = useState(false)
  const [newTaskFiles, setNewTaskFiles] = useState<string[]>([''])
  const [newTaskChecklist, setNewTaskChecklist] = useState<string[]>([])
  const [newTaskShowApproval, setNewTaskShowApproval] = useState(false)
  const [newMaeShowApproval, setNewMaeShowApproval] = useState(false)
  const isDono = user?.role === 'dono'
  const isFunc = user?.role === 'funcionario' || user?.role === 'gerente'

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const filters: Record<string, any> = {}
      if (filterClient) filters.client_id = filterClient
      if (filterDept) filters.department_id = filterDept
      const data = await fetchPipelineTasks(filters)
      setStages(data.stages); setTasks(data.tasks)
      if (isMobile) setExpandedStages(new Set(data.stages.filter(s => data.tasks.some(t => t.stage === s.slug)).map(s => s.slug)))
    } catch {} finally { setLoading(false) }
  }, [filterClient, filterDept, isMobile])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { if (isDono || isFunc) { fetchClients().then(setClients).catch(() => {}); fetchDepartments().then(setDepartments).catch(() => {}); fetchUsers().then(u => setUsers(u as any)).catch(() => {}); fetchCategories().then(setCategories).catch(() => {}) } }, [isDono, isFunc])
  const [allUsers, setUsers] = useState<UserT[]>([])

  useSSE('task:created', useCallback(() => loadData(), [loadData]))
  useSSE('task:stage_changed', useCallback(() => loadData(), [loadData]))

  const handleDrop = async (stageSlug: string) => {
    if (!draggedTask) return
    const task = tasks.find(t => t.id === draggedTask)
    if (!task || task.stage === stageSlug) return
    if ((stageSlug === 'aprovacao_interna' || stageSlug === 'aguardando_cliente') && !task.approval_link) {
      // Abre a tarefa e ja dispara o popup de aprovacao (via ?openApproval=stage)
      setDraggedTask(null)
      toast('Abra a tarefa e preencha o "Conteudo pra Aprovacao" (dentro de Editar) antes de mover pra aprovacao.', 'error')
      navigate(`/tasks/${task.id}`)
      return
    }
    setTasks(prev => prev.map(t => t.id === draggedTask ? { ...t, stage: stageSlug } : t))
    setDraggedTask(null)
    try { await moveTaskStage(draggedTask, stageSlug) } catch { loadData() }
  }

  const handleCreateTask = async () => {
    if (!newTask.title || !newTask.client_id) return
    setSaving(true)
    try {
      const recording_datetime = newTask.recording_date ? `${newTask.recording_date}T${newTask.recording_time || '09:00'}` : undefined
      const approval_files = newTaskIsCarrossel ? newTaskFiles.filter(s => s && s.trim()) : (newTask.approval_link ? [newTask.approval_link] : [])
      const created = await createTask({ ...newTask, client_id: +newTask.client_id, category_id: newTask.category_id ? +newTask.category_id : undefined, department_id: newTask.department_id ? +newTask.department_id : undefined, assigned_to: newTask.assigned_to.map(Number), recording_datetime, approval_files } as any)
      const validItems = newTaskChecklist.filter(t => t && t.trim())
      for (const text of validItems) {
        try { await addChecklistItem(created.id, text.trim()) } catch (e) { console.error('checklist:', e) }
      }
      setShowNew(false); setNewTask({ title: '', description: '', client_id: '', category_id: '', department_id: '', assigned_to: [], due_date: today, priority: 'normal', drive_link_raw: '', drive_link: '', approval_link: '', approval_text: '', publish_date: '', publish_objective: '', recording_date: '', recording_time: '' })
      setNewTaskIsCarrossel(false); setNewTaskFiles(['']); setNewTaskChecklist([]); setNewTaskShowApproval(false)
      loadData()
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
        client_id: +newMae.client_id,
        title: newMae.title,
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
      loadData()
      const parts: string[] = ['Tarefa Mae criada']
      if (subsCreated > 0) parts.push(`${subsCreated} subtarefa${subsCreated > 1 ? 's' : ''}`)
      if (subsFailed > 0) parts.push(`${subsFailed} falharam`)
      if (templateSaved) parts.push('modelo salvo')
      toast(parts.join(' · '))
    } catch (err: any) { toast(err.message || 'Erro ao criar tarefa mae', 'error') }
    finally { setSaving(false) }
  }

  const handleCreateEditorial = async () => {
    if (!newEditorial.client_id || !newEditorial.month_label) return
    setSaving(true)
    try {
      await createEditorialTask({
        client_id: +newEditorial.client_id,
        month_label: newEditorial.month_label,
        num_posts: newEditorial.num_posts ? +newEditorial.num_posts : undefined,
        num_videos: newEditorial.num_videos ? +newEditorial.num_videos : undefined,
        due_date: newEditorial.due_date || undefined,
        category_id: newEditorial.category_id ? +newEditorial.category_id : undefined,
      })
      setShowNewEditorial(false)
      setNewEditorial({ client_id: '', month_label: '', num_posts: '8', num_videos: '4', due_date: '', category_id: '' })
      loadData()
      toast('Linha Editorial criada com sucesso!')
    } catch (err: any) { toast(err.message || 'Erro ao criar linha editorial', 'error') }
    finally { setSaving(false) }
  }

  const handleMobileMove = async (taskId: number, stageSlug: string) => {
    const task = tasks.find(t => t.id === taskId)
    if ((stageSlug === 'aprovacao_interna' || stageSlug === 'aguardando_cliente') && task && !task.approval_link) {
      setMoveTaskId(null)
      toast('Abra a tarefa e preencha o "Conteudo pra Aprovacao" (dentro de Editar) antes de mover pra aprovacao.', 'error')
      navigate(`/tasks/${task.id}`)
      return
    }
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, stage: stageSlug } : t))
    setMoveTaskId(null)
    try { await moveTaskStage(taskId, stageSlug) } catch { loadData() }
  }

  if (loading) return <div className="loading-container"><div className="spinner" /></div>

  // Mobile vertical
  if (isMobile) return (
    <div>
      <div className="page-header"><h1>Pipeline</h1></div>
      {stages.filter(s => showTerminal || !s.is_terminal).map(stage => {
        const stageTasks = tasks.filter(t => t.stage === stage.slug).sort(sortByDueDateAsc)
        const expanded = expandedStages.has(stage.slug)
        return (
          <div key={stage.id} className="kanban-mobile-stage">
            <div className="kanban-mobile-stage-header" onClick={() => setExpandedStages(prev => { const n = new Set(prev); n.has(stage.slug) ? n.delete(stage.slug) : n.add(stage.slug); return n })}>
              <div className="kanban-mobile-stage-title"><span style={{ width: 10, height: 10, borderRadius: '50%', background: stage.color }} />{stage.name}<span style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 8px', borderRadius: 10, fontSize: 12, color: '#A8A3B8' }}>{stageTasks.length}</span></div>
              {expanded ? <ChevronDown size={16} style={{ color: '#6B6580' }} /> : <ChevronRight size={16} style={{ color: '#6B6580' }} />}
            </div>
            {expanded && <div className="kanban-mobile-cards">
              {stageTasks.map(task => (
                <div key={task.id} className="kanban-mobile-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div onClick={() => navigate(`/tasks/${task.id}`)} style={{ cursor: 'pointer', flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-heading)' }}>{task.title}</div>
                      <div style={{ fontSize: 11, color: '#A8A3B8', marginTop: 2 }}>{task.client_name}</div>
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={() => setMoveTaskId(task.id)}><ArrowRight size={12} /></button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 10, color: '#6B6580', flexWrap: 'wrap' }}>
                    {task.department_name && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: task.department_color }} />{task.department_name}</span>}
                    {task.assigned_name && <span><User size={9} /> {task.assigned_name}</span>}
                    {task.due_date && <span style={{ color: isOverdue(task.due_date) ? '#FF6B6B' : undefined }}><Clock size={9} /> {task.due_date.slice(0, 10)}</span>}
                  </div>
                </div>
              ))}
              {stageTasks.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#6B6580', fontSize: 12 }}>Vazio</div>}
            </div>}
          </div>
        )
      })}
      {moveTaskId && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setMoveTaskId(null))() }}><div className="modal" onClick={e => e.stopPropagation()}>
          <h2>Mover tarefa</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stages.map(s => { const current = tasks.find(t => t.id === moveTaskId)?.stage === s.slug; return (
              <button key={s.id} className={`btn ${current ? 'btn-primary' : 'btn-secondary'}`} disabled={current} onClick={() => !current && handleMobileMove(moveTaskId, s.slug)} style={{ justifyContent: 'flex-start', minHeight: 44 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color }} />{s.name}{current && ' (atual)'}
              </button>
            )})}
          </div>
        </div></div>
      )}
    </div>
  )

  // Desktop Kanban
  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1>Pipeline</h1>
          {(isDono || isFunc) && <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Nova Tarefa</button>}
          {(isDono || isFunc) && <button className="btn btn-secondary btn-sm" onClick={() => setShowNewMae(true)}><Layers size={14} /> Tarefa Mae</button>}
          {(isDono || isFunc) && <button className="btn btn-secondary btn-sm" onClick={() => setShowNewRecurring(true)}><Repeat size={14} /> Recorrencia</button>}
          {isDono && <button className="btn btn-secondary btn-sm" onClick={() => setShowNewEditorial(true)}><Layers size={14} /> Linha Editorial</button>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#6B6580' }} />
            <input className="input" placeholder="Buscar tarefa..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ paddingLeft: 32, width: 200 }} />
          </div>
          {isDono && <>
            <select className="select" style={{ width: 160 }} value={filterClient} onChange={e => setFilterClient(e.target.value)}><option value="">Todos clientes</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select className="select" style={{ width: 160 }} value={filterDept} onChange={e => setFilterDept(e.target.value)}><option value="">Todos deptos</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </>}
          <button className={`btn btn-sm ${showTerminal ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setShowTerminal(p => { const v = !p; localStorage.setItem('pipeline_show_terminal', v ? '1' : '0'); return v }) }} style={{ fontSize: 11 }}>
            {showTerminal ? 'Ocultar Concluidos' : 'Mostrar Concluidos'}
          </button>
          <div style={{ display: 'flex', gap: 0, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, overflow: 'hidden' }}>
            <button onClick={() => { setViewMode('all'); localStorage.setItem('pipeline_view_mode', 'all') }} style={{ padding: '6px 10px', fontSize: 11, background: viewMode === 'all' ? '#FFB300' : 'transparent', color: viewMode === 'all' ? '#1a1625' : '#9B96B0', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Tudo</button>
            <button onClick={() => { setViewMode('maes'); localStorage.setItem('pipeline_view_mode', 'maes') }} style={{ padding: '6px 10px', fontSize: 11, background: viewMode === 'maes' ? '#FFB300' : 'transparent', color: viewMode === 'maes' ? '#1a1625' : '#9B96B0', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Tarefas</button>
            <button onClick={() => { setViewMode('subtarefas'); localStorage.setItem('pipeline_view_mode', 'subtarefas') }} style={{ padding: '6px 10px', fontSize: 11, background: viewMode === 'subtarefas' ? '#FFB300' : 'transparent', color: viewMode === 'subtarefas' ? '#1a1625' : '#9B96B0', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Subtarefas</button>
          </div>
          <button className={`btn btn-sm ${groupByClient ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setGroupByClient(p => { const v = !p; localStorage.setItem('pipeline_group_client', v ? '1' : '0'); return v }) }} style={{ fontSize: 11 }}>
            {groupByClient ? 'Desagrupar' : 'Agrupar por Cliente'}
          </button>
        </div>
      </div>
      <div className="kanban-board">
        {stages.filter(s => showTerminal || !s.is_terminal).map(stage => {
          const searchLower = searchQuery.toLowerCase()
          const stageTasks = tasks.filter(t => {
            if (t.stage !== stage.slug) return false
            // viewMode filter
            const isSubtask = !!(t as any).parent_task_id
            const isMother = !isSubtask && !!(t as any).task_type && (t as any).task_type !== 'normal'
            if (viewMode === 'maes' && isSubtask) return false
            if (viewMode === 'subtarefas' && !isSubtask && !isMother) return false
            if (viewMode === 'subtarefas' && isMother) return false
            // search filter
            if (searchQuery && !t.title.toLowerCase().includes(searchLower) && !t.client_name?.toLowerCase().includes(searchLower) && !t.assigned_name?.toLowerCase().includes(searchLower)) return false
            return true
          }).sort(sortByDueDateAsc)
          return (
            <div key={stage.id} className="kanban-column"
              onDragOver={e => { e.preventDefault(); e.currentTarget.querySelector('.kanban-cards')?.classList.add('drag-over') }}
              onDragLeave={e => e.currentTarget.querySelector('.kanban-cards')?.classList.remove('drag-over')}
              onDrop={e => { e.preventDefault(); e.currentTarget.querySelector('.kanban-cards')?.classList.remove('drag-over'); handleDrop(stage.slug) }}>
              <div className="kanban-column-header">
                <div className="kanban-column-title"><span style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color, display: 'inline-block' }} />{stage.name}</div>
                <span className="kanban-column-count">{stageTasks.length}</span>
              </div>
              <div className="kanban-cards">
                {(() => {
                  const renderCard = (task: Task) => {
                    const isSubtask = !!(task as any).parent_task_id
                    const isMother = !isSubtask && !!(task as any).task_type && (task as any).task_type !== 'normal'
                    const displayTitle = isSubtask ? task.title.split(' - ')[0] : task.title
                    const overdue = isOverdue(task.due_date) && task.stage !== 'concluido' && task.stage !== 'rejeitado'
                    return (
                      <div key={task.id} className={`kanban-card ${draggedTask === task.id ? 'dragging' : ''}`}
                        data-subtask={isSubtask ? '1' : undefined}
                        draggable onDragStart={() => setDraggedTask(task.id)} onDragEnd={() => setDraggedTask(null)}
                        onClick={() => navigate(`/tasks/${task.id}`)}
                        style={{ borderLeft: `3px solid ${overdue ? '#FF6B6B' : stage.color}`, ...(overdue ? { background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.2)' } : isSubtask ? { background: 'rgba(255,179,0,0.03)' } : isMother ? { background: 'rgba(255,179,0,0.05)' } : {}) }}>
                        {isMother && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#FFB300', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                            <Layers size={9} /> Tarefa Mae
                          </div>
                        )}
                        {isSubtask && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#FFB300', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                            <Layers size={9} /> Subtarefa
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
                          <div className="kanban-card-name">{displayTitle}</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end', flexShrink: 0 }}>
                            {task.priority === 'urgent' && <span style={{ fontSize: 9, background: '#FF6B6B20', color: '#FF6B6B', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>URGENTE</span>}
                            {task.priority === 'high' && <span style={{ fontSize: 9, background: '#FFAA8320', color: '#FFAA83', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>ALTA</span>}
                            {(task as any).template_id && <span title="Tarefa recorrente" style={{ fontSize: 9, background: 'rgba(155,89,182,0.18)', color: '#c39bda', padding: '1px 6px', borderRadius: 4, fontWeight: 700, border: '1px solid rgba(155,89,182,0.3)' }}>RECORRENTE</span>}
                          </div>
                        </div>
                        {(task as any).changes_requested && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, background: 'rgba(255,179,0,0.18)', color: '#FFB300', padding: '2px 7px', borderRadius: 4, fontWeight: 700, marginTop: 4, marginBottom: 2, border: '1px solid rgba(255,179,0,0.3)' }}>
                            🔄 ALTERACAO SOLICITADA
                          </div>
                        )}
                        {!groupByClient && task.client_name && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#F0EDF5', fontWeight: 700, marginTop: 4, marginBottom: 6, padding: '3px 8px', background: 'rgba(255,179,0,0.10)', borderRadius: 6, border: '1px solid rgba(255,179,0,0.20)', letterSpacing: '-0.01em' }}>
                            <Building2 size={11} style={{ color: '#FFB300' }} /> {task.client_name}
                          </div>
                        )}
                        {task.department_name && <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#6B6580' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: task.department_color }} />{task.department_name}</div>}
                        <div className="kanban-card-meta">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {task.assigned_name && <span><User size={10} /> {task.assigned_name}</span>}
                            {(() => { const days = Math.floor((Date.now() - new Date(task.updated_at).getTime()) / 86400000); return days > 0 ? <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: days > 7 ? '#FF6B6B15' : days > 3 ? '#FBBC0415' : 'rgba(255,255,255,0.04)', color: days > 7 ? '#FF6B6B' : days > 3 ? '#FBBC04' : '#6B6580' }}>{days}d</span> : null })()}
                          </div>
                          {task.due_date && <span style={{ color: isOverdue(task.due_date) ? '#FF6B6B' : '#6B6580', fontWeight: isOverdue(task.due_date) ? 700 : 400, display: 'flex', alignItems: 'center', gap: 3 }}>{isOverdue(task.due_date) && <AlertTriangle size={9} />}<Clock size={10} />{task.due_date.slice(5, 10)}</span>}
                        </div>
                        {!!(task as any).subtask_count && (
                          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#9B96B0' }}>
                            <Layers size={10} style={{ color: '#FFB300' }} />
                            <span>{(task as any).subtask_done_count || 0}/{(task as any).subtask_count} subtarefas</span>
                          </div>
                        )}
                        {task.drive_link && <div style={{ marginTop: 4 }}><ExternalLink size={10} style={{ color: '#5DADE2' }} /></div>}
                      </div>
                    )
                  }

                  const isExpanded = showAllInStage.has(stage.slug)
                  const visibleTasks = isExpanded ? stageTasks : stageTasks.slice(0, STAGE_TASK_LIMIT)
                  const hiddenCount = stageTasks.length - visibleTasks.length
                  const toggleExpand = () => setShowAllInStage(prev => { const n = new Set(prev); n.has(stage.slug) ? n.delete(stage.slug) : n.add(stage.slug); return n })
                  const ShowMoreBtn = hiddenCount > 0 ? (
                    <button onClick={toggleExpand} style={{ display: 'block', width: '100%', marginTop: 8, padding: '8px 10px', fontSize: 11, fontWeight: 600, background: 'rgba(255,179,0,0.08)', border: '1px dashed rgba(255,179,0,0.3)', borderRadius: 6, color: '#FFB300', cursor: 'pointer', fontFamily: 'inherit' }}>
                      + Ver mais {hiddenCount} tarefa{hiddenCount > 1 ? 's' : ''}
                    </button>
                  ) : isExpanded && stageTasks.length > STAGE_TASK_LIMIT ? (
                    <button onClick={toggleExpand} style={{ display: 'block', width: '100%', marginTop: 8, padding: '6px 10px', fontSize: 10, fontWeight: 600, background: 'transparent', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 6, color: '#6B6580', cursor: 'pointer', fontFamily: 'inherit' }}>
                      Mostrar so as {STAGE_TASK_LIMIT} primeiras
                    </button>
                  ) : null

                  if (!groupByClient) return <>{visibleTasks.map(renderCard)}{ShowMoreBtn}</>

                  // Group by client
                  const groups: Record<string, Task[]> = {}
                  for (const t of visibleTasks) {
                    const key = t.client_name || 'Sem cliente'
                    if (!groups[key]) groups[key] = []
                    groups[key].push(t)
                  }
                  const sortedKeys = Object.keys(groups).sort()
                  return <>
                    {sortedKeys.map(clientName => (
                      <div key={clientName} style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', marginBottom: 6, fontSize: 10, fontWeight: 700, color: '#FFB300', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid rgba(255,179,0,0.2)' }}>
                          <Building2 size={10} /> {clientName} <span style={{ color: '#6B6580' }}>({groups[clientName].length})</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {groups[clientName].map(renderCard)}
                        </div>
                      </div>
                    ))}
                    {ShowMoreBtn}
                  </>
                })()}
              </div>
            </div>
          )
        })}
      </div>

      {/* New task modal */}
      {showNew && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setShowNew(false))() }}><div className="modal" style={{ maxWidth: 550 }} onClick={e => e.stopPropagation()}>
          <h2>Nova Tarefa</h2>
          <div className="form-group"><label>Titulo *</label><input className="input" value={newTask.title} onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))} /></div>
          <div className="form-group"><label>Descricao</label><textarea className="input" rows={2} value={newTask.description} onChange={e => setNewTask(p => ({ ...p, description: e.target.value }))} /></div>
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
          <div className="form-row">
            <div className="form-group"><label>Link Drive (Arquivo Bruto)</label><input className="input" value={newTask.drive_link_raw} onChange={e => setNewTask(p => ({ ...p, drive_link_raw: e.target.value }))} placeholder="https://drive.google.com/..." /></div>
            <div className="form-group"><label>Link Drive (Arquivo Pronto)</label><input className="input" value={newTask.drive_link} onChange={e => setNewTask(p => ({ ...p, drive_link: e.target.value }))} placeholder="https://drive.google.com/..." /></div>
          </div>
          {/* Conteudo pra aprovacao — accordion (colapsado por default) */}
          <div style={{ marginTop: 8, padding: '10px 14px', background: 'rgba(245,166,35,0.04)', border: '1px solid rgba(245,166,35,0.12)', borderRadius: 10 }}>
            <button
              type="button"
              onClick={() => setNewTaskShowApproval(v => !v)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: '#F5A623', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14 }}>{newTaskShowApproval ? '▼' : '▶'}</span>
                Conteudo pra Aprovacao (opcional)
              </span>
              <span style={{ fontSize: 10, color: '#A8A3B8', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                {newTaskShowApproval ? 'recolher' : 'expandir'}
              </span>
            </button>
            {newTaskShowApproval && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 10 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#A8A3B8', cursor: 'pointer' }}>
                    <input type="checkbox" checked={newTaskIsCarrossel} onChange={e => {
                      const checked = e.target.checked
                      if (checked) { setNewTaskIsCarrossel(true); setNewTaskFiles(newTask.approval_link ? [newTask.approval_link] : ['']) }
                      else { setNewTaskIsCarrossel(false); setNewTask(p => ({ ...p, approval_link: newTaskFiles[0] || '' })) }
                    }} style={{ accentColor: '#FFB300' }} />
                    Carrossel (varios arquivos)
                  </label>
                </div>
                {newTaskIsCarrossel ? (
                  <div className="form-group">
                    <label>Arquivos do carrossel</label>
                    {newTaskFiles.map((url, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{ minWidth: 56, fontSize: 11, color: '#6B6580', fontWeight: 700 }}>Slide {idx + 1}</span>
                        <input className="input" value={url} placeholder="Link do Drive (publico)" style={{ flex: 1 }} onChange={e => setNewTaskFiles(arr => arr.map((x, i) => i === idx ? e.target.value : x))} />
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNewTaskFiles(arr => arr.filter((_, i) => i !== idx))} title="Remover" style={{ padding: '6px 10px' }}><X size={12} /></button>
                      </div>
                    ))}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNewTaskFiles(arr => [...arr, ''])} style={{ marginTop: 4 }}><Plus size={12} /> Adicionar slide</button>
                  </div>
                ) : (
                  <div className="form-group"><label>Link do arquivo finalizado</label><input className="input" value={newTask.approval_link} onChange={e => setNewTask(p => ({ ...p, approval_link: e.target.value }))} placeholder="Link do Drive — compartilhamento: qualquer pessoa com o link" /></div>
                )}
                <div className="form-group"><label>Texto / Legenda</label><textarea className="input" rows={3} value={newTask.approval_text} onChange={e => setNewTask(p => ({ ...p, approval_text: e.target.value }))} placeholder="Legenda do post, texto da publicacao..." /></div>
                <div className="form-row">
                  <div className="form-group"><label>Data da Publicacao</label><input className="input" type="date" value={newTask.publish_date} onChange={e => setNewTask(p => ({ ...p, publish_date: e.target.value }))} /></div>
                  <div className="form-group"><label>Objetivo da Publicacao</label><input className="input" value={newTask.publish_objective} onChange={e => setNewTask(p => ({ ...p, publish_objective: e.target.value }))} placeholder="Ex: Gerar leads..." /></div>
                </div>
              </div>
            )}
          </div>
          {/* Show recording date/time fields when dept is Captacao */}
          {(() => {
            const selDept = departments.find(d => String(d.id) === newTask.department_id)
            const isCaptacao = selDept && (/capt|produ/i.test(selDept.name))
            if (!isCaptacao) return null
            return (
              <div style={{ padding: '12px 14px', background: 'rgba(255,179,0,0.06)', border: '1px solid rgba(255,179,0,0.2)', borderRadius: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB300', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Data e Hora da Gravacao</div>
                <div className="form-row">
                  <div className="form-group"><label>Data *</label><input className="input" type="date" value={newTask.recording_date} onChange={e => setNewTask(p => ({ ...p, recording_date: e.target.value }))} /></div>
                  <div className="form-group"><label>Hora *</label><input className="input" type="time" value={newTask.recording_time} onChange={e => setNewTask(p => ({ ...p, recording_time: e.target.value }))} /></div>
                </div>
                <div style={{ fontSize: 10, color: '#6E6887' }}>Essa tarefa aparecera no calendario de Gravacoes.</div>
              </div>
            )
          })()}
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

          <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button><button className="btn btn-primary" onClick={handleCreateTask} disabled={saving}>{saving ? 'Criando...' : 'Criar Tarefa'}</button></div>
        </div></div>
      )}

      {/* New Editorial modal */}
      {showNewEditorial && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setShowNewEditorial(false))() }}><div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
          <h2><Layers size={18} style={{ marginRight: 8, verticalAlign: 'middle', color: '#FFB300' }} />Nova Linha Editorial</h2>
          <p style={{ fontSize: 12, color: '#9B96B0', marginTop: -6, marginBottom: 16 }}>Cria uma tarefa-mae com 5 subtarefas fixas: Briefing, Aprovacoes e Publicacao.</p>
          <div className="form-row">
            <div className="form-group"><label>Cliente *</label><select className="select" value={newEditorial.client_id} onChange={e => setNewEditorial(p => ({ ...p, client_id: e.target.value }))}><option value="">Selecione</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="form-group"><label>Mes/Referencia *</label><input className="input" placeholder="Ex: Janeiro 2026" value={newEditorial.month_label} onChange={e => setNewEditorial(p => ({ ...p, month_label: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Qtd Posts</label><input className="input" type="number" min="0" value={newEditorial.num_posts} onChange={e => setNewEditorial(p => ({ ...p, num_posts: e.target.value }))} /></div>
            <div className="form-group"><label>Qtd Videos</label><input className="input" type="number" min="0" value={newEditorial.num_videos} onChange={e => setNewEditorial(p => ({ ...p, num_videos: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Prazo Final</label><input className="input" type="date" value={newEditorial.due_date} onChange={e => setNewEditorial(p => ({ ...p, due_date: e.target.value }))} /></div>
            <div className="form-group"><label>Categoria</label><select className="select" value={newEditorial.category_id} onChange={e => setNewEditorial(p => ({ ...p, category_id: e.target.value }))}><option value="">Nenhuma</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div style={{ padding: '10px 12px', background: 'rgba(255,179,0,0.06)', border: '1px solid rgba(255,179,0,0.18)', borderRadius: 8, fontSize: 11, color: '#A8A3B8', marginBottom: 12 }}>
            <strong style={{ color: '#FFB300' }}>Inicia com 5 subtarefas:</strong>
            <ol style={{ margin: '6px 0 0 16px', padding: 0 }}>
              <li>Briefing (Ideias + Copies) → Ivandro</li>
              <li>Reuniao Aprovacao Cliente (Briefing)</li>
              <li>Aprovacao Interna Final</li>
              <li>Aprovacao Cliente (Final)</li>
              <li>Publicacao</li>
            </ol>
            <strong style={{ color: '#FFB300', display: 'block', marginTop: 8 }}>Criadas automaticamente durante o fluxo:</strong>
            <ul style={{ margin: '6px 0 0 16px', padding: 0, listStyle: 'disc' }}>
              <li>Briefing → Criar Imagens (Dalila, em paralelo)</li>
              <li>Criar Imagens → Programar Publ Imagens (Graziele)</li>
              <li>Reuniao → Gravacao (Ivandro, prazo na data marcada)</li>
              <li>Gravacao → Subir Arquivos (Ivandro)</li>
              <li>Subir Arquivos → Editar Videos (Ivandro)</li>
              <li>Editar Videos → Programar Publ Videos (Graziele)</li>
            </ul>
            <div style={{ marginTop: 8, fontStyle: 'italic' }}>Quando todas concluirem, a tarefa-mae auto-conclui.</div>
          </div>
          <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setShowNewEditorial(false)}>Cancelar</button><button className="btn btn-primary" onClick={handleCreateEditorial} disabled={saving || !newEditorial.client_id || !newEditorial.month_label}>{saving ? 'Criando...' : 'Criar Linha Editorial'}</button></div>
        </div></div>
      )}

      {/* New Mae generica modal */}
      {showNewMae && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setShowNewMae(false))() }}><div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
          <h2 style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span><Layers size={18} style={{ marginRight: 8, verticalAlign: 'middle', color: '#FFB300' }} />Nova Tarefa Mae</span>
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
          <div className="form-group" style={{ padding: 10, background: 'rgba(255,179,0,0.06)', border: '1px solid rgba(255,179,0,0.25)', borderRadius: 6 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 0 }}>
              <input type="checkbox" checked={newMae.sequential_subtasks} onChange={e => setNewMae(p => ({ ...p, sequential_subtasks: e.target.checked }))} style={{ marginTop: 3 }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Concluir subtarefas em ordem</div>
                <small style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block', marginTop: 2 }}>Se marcado, a subtarefa 2 so pode ser concluida depois da 1, e assim por diante. Ideal pra rotinas com dependencia.</small>
              </div>
            </label>
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
                Nenhuma. Clica em Adicionar pra ja criar subtarefas junto com a mae.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {newMaeSubs.map((sub, idx) => (
                  <div key={idx} style={{ padding: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#FFB30020', color: '#FFB300', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{idx + 1}</span>
                      <input className="input" value={sub.title} onChange={e => setNewMaeSubs(prev => prev.map((s, i) => i === idx ? { ...s, title: e.target.value } : s))} placeholder="Ex: Edicao / Design / Postar" style={{ flex: 1, fontSize: 12 }} autoFocus={sub.title === ''} />
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
                    <AssigneesMultiSelect users={allUsers} selected={sub.assigned_to} onChange={arr => setNewMaeSubs(prev => prev.map((s, i) => i === idx ? { ...s, assigned_to: arr } : s))} placeholder="Responsaveis" />
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
                <small style={{ color: '#9B96B0', fontSize: 11, display: 'block', marginTop: 2 }}>Salva essa mae + subtarefas na biblioteca de modelos pra reutilizar depois.</small>
              </div>
            </label>
          </div>

          <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setShowNewMae(false)}>Cancelar</button><button className="btn btn-primary" onClick={handleCreateMae} disabled={saving || !newMae.title || !newMae.client_id}>{saving ? 'Criando...' : 'Criar Tarefa Mae'}</button></div>
        </div></div>
      )}

      <TaskTemplateModal open={showNewRecurring} onClose={() => setShowNewRecurring(false)} onSaved={() => {}} />

      <ApplyTemplatePicker
        open={showApplyTemplate}
        clientId={newMae.client_id ? +newMae.client_id : null}
        onClose={() => setShowApplyTemplate(false)}
        onApplied={(tid) => { setShowNewMae(false); navigate(`/tasks/${tid}`) }}
      />
    </div>
  )
}
