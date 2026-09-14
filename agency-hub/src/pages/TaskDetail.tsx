import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useSSE } from '../context/SSEContext'
import { fetchTask, fetchClients, fetchDepartments, fetchUsers, fetchCategories, fetchStages, updateTask, moveTaskStage, addTaskComment, addTaskAttachment, deleteTaskAttachment, approveTask, rejectTask, startTimer, stopTimer, confirmRecording, addSubtask, getApprovalFiles, convertTaskToMae, saveTaskAsTemplate, addChecklistItem, updateChecklistItem, deleteChecklistItem, type Task, type TaskComment, type TaskHistory, type TaskAttachment, type TimeEntry, type Client, type Department, type User as UserT, type TaskCategory, type PipelineStage, type ChecklistItem } from '../lib/api'
import { isDriveUrl, toDriveEmbedUrl } from '../lib/drive'
import { ArrowLeft, Building2, Clock, User, ExternalLink, CheckCircle, XCircle, Send, MessageCircle, GitBranch, Paperclip, Eye, Edit3, Save, X, Plus, AlertTriangle, Layers, ChevronRight, ChevronDown, Video, Trash2, FileText, GripVertical } from 'lucide-react'
import { useToast } from '../components/Toast'
import AssigneesMultiSelect from '../components/AssigneesMultiSelect'

export default function TaskDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [task, setTask] = useState<Task | null>(null)
  const [comments, setComments] = useState<TaskComment[]>([])
  const [history, setHistory] = useState<TaskHistory[]>([])
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [commentText, setCommentText] = useState('')
  const [isInternal, setIsInternal] = useState(true)
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [activeTab, setActiveTab] = useState<'subtasks' | 'comments' | 'history' | 'attachments' | 'time'>('comments')
  // Expansao inline das irmas no card "Tarefa-Mae" (subtaskId -> aberta/fechada)
  const [expandedSiblings, setExpandedSiblings] = useState<Set<number>>(new Set())
  const [parentInfoOpen, setParentInfoOpen] = useState(true)  // secao "detalhes da mae" comeca aberta
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([])
  const [totalTime, setTotalTime] = useState(0)
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [newChecklistText, setNewChecklistText] = useState('')
  const [activeTimerEntry, setActiveTimerEntry] = useState<TimeEntry | null>(null)
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerElapsed, setTimerElapsed] = useState(0)
  // Edit mode
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState<any>({})
  const [clients, setClients] = useState<Client[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [users, setUsers] = useState<UserT[]>([])
  const [categories, setCategories] = useState<TaskCategory[]>([])
  // Attachment
  const [newAttUrl, setNewAttUrl] = useState('')
  const [newAttName, setNewAttName] = useState('')
  // Recording confirmation modal (editorial workflow)
  const [showRecording, setShowRecording] = useState(false)
  const [recordingData, setRecordingData] = useState({ recording_datetime: '', capture_user_id: '', edit_user_id: '', design_user_id: '' })
  // Subtarefa modal (mae generica e editorial)
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()
  const [showNewSub, setShowNewSub] = useState(false)
  const [newSub, setNewSub] = useState({ title: '', description: '', due_date: today, priority: 'normal', assigned_to: [] as string[], department_id: '', category_id: '', drive_link: '', drive_link_raw: '', approval_link: '', approval_text: '', publish_date: '', publish_objective: '' })
  const [newSubIsCarrossel, setNewSubIsCarrossel] = useState(false)
  const [newSubShowApproval, setNewSubShowApproval] = useState(false)
  const [newSubFiles, setNewSubFiles] = useState<string[]>([''])
  const [savingSub, setSavingSub] = useState(false)
  // Popup pra coletar aprovacao ao mover pra 'aguardando_cliente'/'aprovacao_interna'
  // Accordion do bloco 'Conteudo pra Aprovacao' no edit mode — colapsado por default
  const [showApprovalSection, setShowApprovalSection] = useState(false)
  // Edicao inline de subtarefa (sem sair da tela da mae)
  const [editingSubId, setEditingSubId] = useState<number | null>(null)
  const [editingSubData, setEditingSubData] = useState<any>({})
  const [savingSubInline, setSavingSubInline] = useState(false)

  const { toast } = useToast()
  const isDono = user?.role === 'dono' || user?.role === 'gerente'
  const isFunc = user?.role === 'funcionario'
  const isCliente = user?.role === 'cliente'
  const canEdit = isDono || (isFunc && ((task as any)?.assignees?.some((a: any) => a.user_id === user?.id) || task?.assigned_to === user?.id))

  const loadTask = useCallback(async () => {
    if (!id) return
    const data = await fetchTask(+id)
    setTask(data.task); setComments(data.comments); setHistory(data.history); setAttachments(data.attachments)
    const files = getApprovalFiles(data.task as any)
    setEditData({ title: data.task.title, description: data.task.description || '', due_date: data.task.due_date?.slice(0, 10) || '', priority: data.task.priority, department_id: data.task.department_id || '', assigned_to: (data.task.assignees || []).map((a: any) => String(a.user_id)), category_id: data.task.category_id || '', drive_link: data.task.drive_link || '', drive_link_raw: data.task.drive_link_raw || '', approval_link: data.task.approval_link || '', approval_files: files, is_carrossel: files.length > 1, approval_text: data.task.approval_text || '', publish_date: data.task.publish_date || '', publish_objective: data.task.publish_objective || '', meeting_datetime: (data.task as any).meeting_datetime || '', recording_datetime: (data.task as any).recording_datetime || '', client_id: data.task.client_id || '' })
    setTimeEntries(data.timeEntries || []); setTotalTime(data.totalTimeSeconds || 0)
    setChecklist((data as any).checklist || [])
    if (data.activeTimer) { setActiveTimerEntry(data.activeTimer); setTimerRunning(true) } else { setActiveTimerEntry(null); setTimerRunning(false) }
  }, [id])

  const handleAddChecklistItem = async () => {
    if (!task || !newChecklistText.trim()) return
    try {
      const item = await addChecklistItem(task.id, newChecklistText.trim())
      setChecklist(prev => [...prev, item])
      setNewChecklistText('')
    } catch (err: any) { toast(err.message || 'Erro', 'error') }
  }
  const handleToggleChecklistItem = async (item: ChecklistItem) => {
    try {
      const updated = await updateChecklistItem(item.id, { done: !item.done })
      setChecklist(prev => prev.map(i => i.id === item.id ? updated : i))
    } catch (err: any) { toast(err.message || 'Erro', 'error') }
  }
  const handleDeleteChecklistItem = async (item: ChecklistItem) => {
    try {
      await deleteChecklistItem(item.id)
      setChecklist(prev => prev.filter(i => i.id !== item.id))
    } catch (err: any) { toast(err.message || 'Erro', 'error') }
  }

  // Drag & drop reorder — armazena indice sendo arrastado + indice de hover
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const handleChecklistDrop = async (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) { setDragIdx(null); setDragOverIdx(null); return }
    const reordered = [...checklist]
    const [moved] = reordered.splice(dragIdx, 1)
    reordered.splice(targetIdx, 0, moved)
    setChecklist(reordered)
    setDragIdx(null); setDragOverIdx(null)
    // Persiste novas posicoes (position sequencial 1..N)
    try {
      await Promise.all(reordered.map((item, i) => updateChecklistItem(item.id, { position: i + 1 } as any)))
    } catch (err: any) { toast(err?.message || 'Erro ao salvar ordem', 'error') }
  }

  useEffect(() => {
    setLoading(true)
    const loadMeta = isDono || isFunc
    Promise.all([loadTask(), loadMeta ? fetchClients().then(setClients) : Promise.resolve(), loadMeta ? fetchDepartments().then(setDepartments) : Promise.resolve(), loadMeta ? fetchUsers().then(setUsers) : Promise.resolve(), fetchCategories().then(setCategories), fetchStages().then(setStages)])
      .finally(() => setLoading(false))
  }, [loadTask, isDono])
  useSSE('task:stage_changed', useCallback((data: any) => { if (data.id === parseInt(id || '0')) loadTask() }, [id, loadTask]))
  useSSE('task:comment', useCallback((data: any) => { if (data.taskId === parseInt(id || '0')) loadTask() }, [id, loadTask]))

  // Sempre que troca de tarefa: se eh mae, abre na aba Subtarefas por default; senao, Comentarios
  const currentTaskIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (!task) return
    if (currentTaskIdRef.current === task.id) return
    currentTaskIdRef.current = task.id
    const isMae = (task as any).task_type === 'mae' || (task as any).task_type === 'mae_editorial'
    setActiveTab(isMae ? 'subtasks' : 'comments')
  }, [task])

  const [showTimerCheck, setShowTimerCheck] = useState(false)
  const lastCheckRef = useRef(0)

  // Timer tick + hourly check
  useEffect(() => {
    if (!timerRunning || !activeTimerEntry) return
    const interval = setInterval(() => {
      const startedAt = new Date(activeTimerEntry.started_at + '-03:00').getTime()
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
      setTimerElapsed(elapsed)
      // Check every 1 hora (3600s)
      const currentCheck = Math.floor(elapsed / 3600)
      if (currentCheck > 0 && currentCheck > lastCheckRef.current) {
        lastCheckRef.current = currentCheck
        setShowTimerCheck(true)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [timerRunning, activeTimerEntry])

  const handleStartTimer = async () => { if (task) { lastCheckRef.current = 0; await startTimer(task.id); loadTask() } }
  const handleStopTimer = async () => { if (task) { await stopTimer(task.id); setTimerRunning(false); setTimerElapsed(0); loadTask() } }
  const handleTimerCheckNo = async () => {
    setShowTimerCheck(false)
    if (task) {
      await stopTimer(task.id)
      await moveTaskStage(task.id, 'backlog')
      setTimerRunning(false); setTimerElapsed(0); loadTask()
    }
  }

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60
    return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  const handleSaveEdit = async () => {
    if (!task) return
    try {
      // Normaliza approval_files: se carrossel use array, senao usa approval_link como single
      const cleanFiles = (editData.approval_files || []).filter((s: string) => s && s.trim())
      const payload: any = { ...editData, department_id: editData.department_id ? +editData.department_id : null, assigned_to: (editData.assigned_to || []).map(Number), category_id: editData.category_id ? +editData.category_id : null, client_id: editData.client_id ? +editData.client_id : undefined }
      if (editData.is_carrossel) {
        payload.approval_files = cleanFiles
        delete payload.approval_link // backend sincroniza com primeiro item
      } else {
        // modo single: envia approval_files com 1 item (= approval_link), pra zerar carrossel anterior
        payload.approval_files = editData.approval_link ? [editData.approval_link] : []
      }
      delete payload.is_carrossel
      await updateTask(task.id, payload)
      setEditing(false); loadTask()
      toast('Tarefa atualizada!')
    } catch (err: any) { toast(err.message || 'Erro ao salvar', 'error') }
  }

  const handleAddAttachment = async () => {
    if (!task || !newAttUrl || !newAttName) return
    await addTaskAttachment(task.id, newAttUrl, newAttName)
    setNewAttUrl(''); setNewAttName(''); loadTask()
  }

  const handleAddSubtask = async () => {
    if (!task || !newSub.title) return
    setSavingSub(true)
    try {
      const approval_files = newSubIsCarrossel ? newSubFiles.filter(s => s && s.trim()) : (newSub.approval_link ? [newSub.approval_link] : [])
      await addSubtask(task.id, {
        title: newSub.title,
        description: newSub.description || undefined,
        due_date: newSub.due_date || undefined,
        priority: newSub.priority,
        assigned_to: newSub.assigned_to.map(Number),
        department_id: newSub.department_id ? +newSub.department_id : undefined,
        category_id: newSub.category_id ? +newSub.category_id : undefined,
        drive_link: newSub.drive_link || undefined,
        drive_link_raw: newSub.drive_link_raw || undefined,
        approval_files,
        approval_text: newSub.approval_text || undefined,
        publish_date: newSub.publish_date || undefined,
        publish_objective: newSub.publish_objective || undefined,
      })
      setShowNewSub(false)
      setNewSub({ title: '', description: '', due_date: today, priority: 'normal', assigned_to: [], department_id: '', category_id: '', drive_link: '', drive_link_raw: '', approval_link: '', approval_text: '', publish_date: '', publish_objective: '' })
      setNewSubIsCarrossel(false); setNewSubFiles([''])
      loadTask()
      toast('Subtarefa adicionada')
    } catch (e: any) { toast(e?.message || 'Erro ao adicionar subtarefa', 'error') }
    finally { setSavingSub(false) }
  }

  const handleComment = async () => {
    if (!commentText.trim() || !task) return
    const comment = await addTaskComment(task.id, commentText, isInternal)
    setComments(prev => [...prev, comment]); setCommentText('')
  }

  const handleApprove = async () => { if (task) { try { await approveTask(task.id); loadTask(); toast('Tarefa aprovada!') } catch (err: any) { toast(err.message || 'Erro ao aprovar', 'error') } } }
  const handleReject = async () => { if (task && rejectReason) { try { await rejectTask(task.id, rejectReason); setShowReject(false); setRejectReason(''); loadTask(); toast('Tarefa rejeitada') } catch (err: any) { toast(err.message || 'Erro ao rejeitar', 'error') } } }

  const handleConfirmRecording = async () => {
    if (!task || !recordingData.recording_datetime) return
    await confirmRecording(task.id, {
      recording_datetime: recordingData.recording_datetime,
      capture_user_id: recordingData.capture_user_id ? +recordingData.capture_user_id : undefined,
      edit_user_id: recordingData.edit_user_id ? +recordingData.edit_user_id : undefined,
      design_user_id: recordingData.design_user_id ? +recordingData.design_user_id : undefined,
    })
    setShowRecording(false)
    setRecordingData({ recording_datetime: '', capture_user_id: '', edit_user_id: '', design_user_id: '' })
    loadTask()
  }

  const handleStageMove = async (stage: string) => {
    if (!task) return
    // Aviso preventivo: precisa preencher aprovacao antes de mover
    if ((stage === 'aprovacao_interna' || stage === 'aguardando_cliente') && !task.approval_link) {
      toast('Preencha o "Conteudo pra Aprovacao" (dentro do Editar) antes de enviar pra aprovacao.', 'error')
      if (!editing) setEditing(true)
      return
    }
    try {
      if (stage === 'em_producao') lastCheckRef.current = 0
      await moveTaskStage(task.id, stage)
      loadTask()
      toast('Etapa atualizada!')
    }
    catch (err: any) { toast(err.message || 'Erro ao mover tarefa', 'error') }
  }

  const handleConvertToMae = async () => {
    if (!task) return
    if (!confirm(`Tornar "${task.title}" em tarefa mae? Depois voce pode adicionar subtarefas.`)) return
    try {
      await convertTaskToMae(task.id)
      loadTask()
      toast('Tarefa convertida em mae — agora voce pode adicionar subtarefas')
    } catch (err: any) { toast(err.message || 'Erro ao converter', 'error') }
  }

  const handleSaveAsTemplate = async () => {
    if (!task) return
    const suggested = task.title
    const name = window.prompt('Nome do modelo (aparece no botao "Usar modelo"):', suggested)
    if (name == null) return
    const finalName = name.trim() || suggested
    try {
      const r = await saveTaskAsTemplate(task.id, finalName)
      const subInfo = r.subtasks_copied > 0 ? ` com ${r.subtasks_copied} subtarefa${r.subtasks_copied > 1 ? 's' : ''}` : ''
      toast(`Modelo "${finalName}" salvo${subInfo}. Disponivel em "Usar modelo" e em Recorrencias.`)
    } catch (err: any) { toast(err.message || 'Erro ao salvar modelo', 'error') }
  }

  const startEditSub = (sub: any) => {
    setEditingSubId(sub.id)
    setEditingSubData({
      title: (sub.title || '').replace(' - ' + (task?.title || ''), '').replace((task?.title || '') + ' - ', ''),
      due_date: sub.due_date?.slice(0, 10) || '',
      priority: sub.priority || 'normal',
      department_id: sub.department_id || '',
      assigned_to: (sub.assignees || []).map((a: any) => String(a.user_id)),
    })
  }
  const cancelEditSub = () => { setEditingSubId(null); setEditingSubData({}) }
  const saveEditSub = async () => {
    if (!editingSubId) return
    if (!editingSubData.title?.trim()) { toast('Titulo obrigatorio', 'error'); return }
    setSavingSubInline(true)
    try {
      await updateTask(editingSubId, {
        title: editingSubData.title,
        due_date: editingSubData.due_date || null,
        priority: editingSubData.priority,
        department_id: editingSubData.department_id || null,
        assigned_to: (editingSubData.assigned_to || []).map(Number),
      } as any)
      cancelEditSub()
      loadTask()
      toast('Subtarefa atualizada')
    } catch (err: any) { toast(err.message || 'Erro ao salvar', 'error') }
    setSavingSubInline(false)
  }

  if (loading) return <div className="loading-container"><div className="spinner" /></div>
  if (!task) return <div className="empty-state"><h3>Tarefa nao encontrada</h3></div>

  const canApproveInternal = isDono && task.stage === 'aprovacao_interna'
  const canApproveClient = isCliente && task.stage === 'aguardando_cliente'
  const canPickUp = isFunc && task.stage === 'backlog'
  const canSubmitReview = isFunc && task.stage === 'em_producao' && task.assigned_to === user?.id
  const canMoveToApproval = isDono && task.stage === 'revisao_interna'
  const canSchedule = isDono && task.stage === 'aprovado_cliente'
  const canComplete = isDono && task.stage === 'programar_publicacao'

  // Sequential lock: se esta task e subtarefa E a mae tem sequential_subtasks=1,
  // procura a primeira irma anterior nao concluida — se existir, esta task esta "bloqueada".
  // Usado pra desabilitar botao Concluir e mostrar aviso amarelo. Backend faz a mesma checagem
  // como source of truth, isso aqui e' so UX preventiva.
  const parentSeq = (task as any).parent
  const sequentialBlockedBy: any = (() => {
    if (!parentSeq || parentSeq.sequential_subtasks !== 1) return null
    const currentPos = (task as any).subtask_position || 0
    const siblings = parentSeq.subtasks || []
    return siblings.find((s: any) => (s.subtask_position || 0) < currentPos && s.stage !== 'concluido' && s.stage !== 'rejeitado') || null
  })()

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary btn-icon" onClick={() => navigate(-1)}><ArrowLeft size={16} /></button>
          <div>
            <h1 style={{ fontSize: 20 }}>{task.title}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#A8A3B8', flexWrap: 'wrap' }}>
              <Building2 size={12} /> {task.client_name}
              <span className="stage-badge" style={{ background: `${task.stage_color}20`, color: task.stage_color }}>{task.stage_name}</span>
              {(task as any).sequential_subtasks === 1 && !(task as any).parent_task_id && (
                <span title="Subtarefas desta mae so podem ser concluidas em ordem" style={{ fontSize: 10, background: 'rgba(255,179,0,0.15)', color: '#FFB300', padding: '2px 6px', borderRadius: 4, fontWeight: 700, border: '1px solid rgba(255,179,0,0.3)' }}>SUBTAREFAS EM ORDEM</span>
              )}
              {sequentialBlockedBy && (
                <span title={`Aguarda "${sequentialBlockedBy.title}" concluir`} style={{ fontSize: 10, background: 'rgba(255,107,107,0.15)', color: '#FF6B6B', padding: '2px 6px', borderRadius: 4, fontWeight: 700, border: '1px solid rgba(255,107,107,0.3)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>🔒 BLOQUEADA (aguarda subtarefa {sequentialBlockedBy.subtask_position})</span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {canPickUp && <button className="btn btn-primary btn-sm" onClick={() => handleStageMove('em_producao')} disabled={!!sequentialBlockedBy} title={sequentialBlockedBy ? `Bloqueada: aguarda "${sequentialBlockedBy.title}"` : ''}>Iniciar</button>}
          {canSubmitReview && <button className="btn btn-primary btn-sm" onClick={() => handleStageMove('revisao_interna')}><Send size={12} /> Enviar pra Revisao</button>}
          {canMoveToApproval && <button className="btn btn-primary btn-sm" onClick={() => handleStageMove('aprovacao_interna')}>Enviar pra Aprovacao</button>}
          {canApproveInternal && <><button className="btn btn-primary btn-sm" onClick={handleApprove}><CheckCircle size={12} /> Aprovar</button><button className="btn btn-danger btn-sm" onClick={() => setShowReject(true)}><XCircle size={12} /> Rejeitar</button></>}
          {canApproveClient && <><button className="btn btn-primary btn-sm" onClick={handleApprove}><CheckCircle size={12} /> Aprovar</button><button className="btn btn-danger btn-sm" onClick={() => setShowReject(true)}><XCircle size={12} /> Rejeitar</button></>}
          {canSchedule && <button className="btn btn-primary btn-sm" onClick={() => handleStageMove('programar_publicacao')}>Programar</button>}
          {canComplete && <button className="btn btn-primary btn-sm" onClick={() => handleStageMove('concluido')} disabled={!!sequentialBlockedBy} title={sequentialBlockedBy ? `Bloqueada: aguarda "${sequentialBlockedBy.title}"` : ''}><CheckCircle size={12} /> Concluir</button>}
          {(isDono || isFunc) && stages.length > 0 && (
            <select className="select" style={{ fontSize: 12, padding: '6px 10px', width: 'auto', minWidth: 140 }} value="" onChange={e => { if (e.target.value) handleStageMove(e.target.value) }}>
              <option value="">Mover para...</option>
              {stages.filter(s => s.slug !== task.stage).map(s => <option key={s.slug} value={s.slug}>{s.name}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="lead-detail">
        {/* Left: Info */}
        <div>
          {/* Changes requested banner (client asked for changes) */}
          {(task as any).changes_requested && !isCliente && (
            <div className="card" style={{ marginBottom: 12, background: 'linear-gradient(135deg, rgba(255,179,0,0.12), rgba(255,107,107,0.04))', border: '1px solid rgba(255,179,0,0.35)', borderLeft: '4px solid #FFB300' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB300', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                🔄 Alteracao Solicitada pelo Cliente
              </div>
              <div style={{ fontSize: 14, color: '#F2F0F7', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{(task as any).changes_requested}</div>
              <div style={{ marginTop: 10, fontSize: 11, color: '#9B96B0', fontStyle: 'italic' }}>Ao reenviar pra aprovacao, essa flag e limpa automaticamente.</div>
            </div>
          )}

          {/* Parent task summary (when viewing a subtask) */}
          {(task as any).parent && (() => {
            const parent = (task as any).parent
            const siblings = parent.subtasks || []
            const parentAtts = parent.attachments || []
            const parentApprovalFiles = getApprovalFiles(parent)
            const parentHasDetails = !!(parent.description || parent.drive_link || parent.drive_link_raw || parent.approval_link || parent.approval_text || parentApprovalFiles.length > 0 || parentAtts.length > 0)
            const toggleSib = (id: number) => setExpandedSiblings(prev => {
              const next = new Set(prev)
              next.has(id) ? next.delete(id) : next.add(id)
              return next
            })
            return (
              <div className="card" style={{ marginBottom: 12, borderLeft: '3px solid #FFB300', background: 'rgba(255,179,0,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB300', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Layers size={12} /> Contexto da Tarefa-Mae
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/tasks/${parent.id}`)}>
                    Abrir mae <ChevronRight size={12} />
                  </button>
                </div>

                {/* Header basico da mae */}
                <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-heading)', marginBottom: 6 }}>
                  {parent.title}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#9B96B0', marginBottom: 10, flexWrap: 'wrap' }}>
                  <span className="stage-badge" style={{ background: `${parent.stage_color}20`, color: parent.stage_color }}>{parent.stage_name}</span>
                  {parent.assigned_name && <span><User size={10} /> {parent.assigned_name}</span>}
                  {parent.due_date && <span><Clock size={10} /> {parent.due_date.slice(0, 10)}</span>}
                </div>

                {/* Detalhes da mae (Fase A) — colapsavel, so aparece se ha algum dado */}
                {parentHasDetails && (
                  <div style={{ marginBottom: 12, background: 'rgba(255,255,255,0.02)', borderRadius: 6, padding: '8px 10px' }}>
                    <button
                      onClick={() => setParentInfoOpen(v => !v)}
                      style={{ background: 'transparent', border: 'none', color: '#9B96B0', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0, marginBottom: parentInfoOpen ? 8 : 0 }}
                    >
                      {parentInfoOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      Detalhes da mae (descricao, links, anexos)
                    </button>
                    {parentInfoOpen && (
                      <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {parent.description && (
                          <div>
                            <div style={{ fontSize: 10, color: '#6B6580', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>Descricao</div>
                            <div style={{ color: '#c9c4d8', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{parent.description}</div>
                          </div>
                        )}
                        {(parent.drive_link || parent.drive_link_raw) && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {parent.drive_link_raw && <a href={parent.drive_link_raw} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: '4px 8px' }}><ExternalLink size={10} /> Arquivo Bruto (da mae)</a>}
                            {parent.drive_link && <a href={parent.drive_link} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" style={{ fontSize: 11, padding: '4px 8px' }}><ExternalLink size={10} /> Arquivo Pronto (da mae)</a>}
                          </div>
                        )}
                        {(parent.approval_link || parentApprovalFiles.length > 0 || parent.approval_text) && (
                          <div>
                            <div style={{ fontSize: 10, color: '#6B6580', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>Aprovacao (da mae)</div>
                            {parent.approval_text && <div style={{ color: '#c9c4d8', whiteSpace: 'pre-wrap', marginBottom: 4, lineHeight: 1.4 }}>{parent.approval_text}</div>}
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {parentApprovalFiles.length > 0
                                ? parentApprovalFiles.map((url: string, i: number) => (
                                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: '4px 8px' }}><ExternalLink size={10} /> Arquivo aprovacao {parentApprovalFiles.length > 1 ? i + 1 : ''}</a>
                                  ))
                                : parent.approval_link && <a href={parent.approval_link} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: '4px 8px' }}><ExternalLink size={10} /> Arquivo aprovacao</a>}
                            </div>
                          </div>
                        )}
                        {parentAtts.length > 0 && (
                          <div>
                            <div style={{ fontSize: 10, color: '#6B6580', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Anexos (da mae, {parentAtts.length})</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              {parentAtts.slice(0, 5).map((a: any) => (
                                <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#5DADE2', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                                  <Paperclip size={10} /> {a.filename}
                                </a>
                              ))}
                              {parentAtts.length > 5 && <div style={{ fontSize: 10, color: '#6B6580' }}>+ {parentAtts.length - 5} outros (abrir mae pra ver)</div>}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Lista de irmas (Fase B) — cada uma expansivel */}
                {siblings.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                    <div style={{ fontSize: 10, color: '#6B6580', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      Subtarefas ({siblings.length})
                      {parent.sequential_subtasks === 1 && <span style={{ fontSize: 9, background: 'rgba(255,179,0,0.15)', color: '#FFB300', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>EM ORDEM</span>}
                    </div>
                    {siblings.map((s: any) => {
                      const isCurrent = s.id === task.id
                      const isOpen = expandedSiblings.has(s.id)
                      const sApprovalFiles = getApprovalFiles(s)
                      const sHasDetails = !isCurrent && !!(s.description || s.drive_link || s.drive_link_raw || s.approval_link || s.approval_text || sApprovalFiles.length > 0)
                      const displayTitle = s.title.replace(' - ' + parent.title, '').replace(parent.title + ' - ', '')
                      // Se mae e sequential, esta irma esta "bloqueada" se ha alguma sub anterior ainda em aberto
                      const sIsBlocked = parent.sequential_subtasks === 1 && s.stage !== 'concluido' && s.stage !== 'rejeitado' && siblings.some((o: any) => (o.subtask_position || 0) < (s.subtask_position || 0) && o.stage !== 'concluido' && o.stage !== 'rejeitado')
                      return (
                        <div key={s.id} style={{ borderRadius: 6, background: isCurrent ? 'rgba(255,179,0,0.12)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isCurrent ? 'rgba(255,179,0,0.3)' : 'rgba(255,255,255,0.04)'}`, overflow: 'hidden', opacity: sIsBlocked ? 0.7 : 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12 }}>
                            <span style={{ width: 18, height: 18, borderRadius: '50%', background: s.stage_color || '#6B6580', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s.subtask_position}</span>
                            {sIsBlocked && <span title="Bloqueada — aguarda subtarefa anterior concluir" style={{ fontSize: 10, color: '#FF6B6B', flexShrink: 0 }}>🔒</span>}
                            <span
                              onClick={() => !isCurrent && navigate(`/tasks/${s.id}`)}
                              style={{ flex: 1, fontWeight: isCurrent ? 700 : 400, color: isCurrent ? '#F2F0F7' : '#c9c4d8', cursor: isCurrent ? 'default' : 'pointer' }}
                              title={isCurrent ? 'Voce esta aqui' : sIsBlocked ? 'Bloqueada — aguarda subtarefa anterior' : 'Abrir esta subtarefa'}
                            >
                              {displayTitle}{isCurrent && <span style={{ color: '#FFB300', marginLeft: 6, fontSize: 10, fontWeight: 700 }}>· voce esta aqui</span>}
                            </span>
                            <span style={{ fontSize: 10, color: s.stage_color }}>{s.stage_name}</span>
                            {sHasDetails && (
                              <button
                                onClick={e => { e.stopPropagation(); toggleSib(s.id) }}
                                style={{ background: 'transparent', border: 'none', color: '#9B96B0', cursor: 'pointer', padding: 2, display: 'flex' }}
                                title={isOpen ? 'Fechar detalhes' : 'Ver descricao, links e anexos'}
                              >
                                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              </button>
                            )}
                          </div>
                          {isOpen && sHasDetails && (
                            <div style={{ padding: '4px 10px 10px 36px', fontSize: 11, display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                              <div style={{ fontSize: 10, color: '#FFB300', fontWeight: 600 }}>
                                Da subtarefa {s.subtask_position} — {displayTitle}
                              </div>
                              {s.description && (
                                <div style={{ color: '#c9c4d8', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{s.description}</div>
                              )}
                              {(s.drive_link || s.drive_link_raw) && (
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                  {s.drive_link_raw && <a href={s.drive_link_raw} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: '#5DADE2', display: 'flex', alignItems: 'center', gap: 3 }}><ExternalLink size={10} /> Bruto</a>}
                                  {s.drive_link && <a href={s.drive_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: '#5DADE2', display: 'flex', alignItems: 'center', gap: 3 }}><ExternalLink size={10} /> Pronto</a>}
                                </div>
                              )}
                              {(s.approval_link || sApprovalFiles.length > 0 || s.approval_text) && (
                                <div>
                                  {s.approval_text && <div style={{ color: '#c9c4d8', marginBottom: 3, whiteSpace: 'pre-wrap' }}>{s.approval_text}</div>}
                                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                    {sApprovalFiles.length > 0
                                      ? sApprovalFiles.map((url: string, i: number) => <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: '#FFB300', display: 'flex', alignItems: 'center', gap: 3 }}><ExternalLink size={10} /> Aprovacao {sApprovalFiles.length > 1 ? i + 1 : ''}</a>)
                                      : s.approval_link && <a href={s.approval_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: '#FFB300', display: 'flex', alignItems: 'center', gap: 3 }}><ExternalLink size={10} /> Aprovacao</a>}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}

          <div className="card" style={{ marginBottom: 16 }}>
            {/* Edit toggle */}
            {canEdit && !editing && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}><Edit3 size={12} /> Editar</button>
              </div>
            )}
            {editing && canEdit ? (
              <>
                <div className="form-group"><label>Titulo</label><input className="input" value={editData.title} onChange={e => setEditData((p: any) => ({ ...p, title: e.target.value }))} /></div>
                <div className="form-group"><label>Descricao</label><textarea className="input" rows={3} value={editData.description} onChange={e => setEditData((p: any) => ({ ...p, description: e.target.value }))} /></div>
                <div className="form-row">
                  <div className="form-group"><label>Departamento</label><select className="select" value={editData.department_id} onChange={e => setEditData((p: any) => ({ ...p, department_id: e.target.value }))}><option value="">Nenhum</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
                  <div className="form-group"><label>Responsaveis</label>
                    <AssigneesMultiSelect users={users} selected={editData.assigned_to || []} onChange={arr => setEditData((p: any) => ({ ...p, assigned_to: arr }))} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label>Prazo</label><input className="input" type="date" value={editData.due_date} onChange={e => setEditData((p: any) => ({ ...p, due_date: e.target.value }))} /></div>
                  <div className="form-group"><label>Prioridade</label><select className="select" value={editData.priority} onChange={e => setEditData((p: any) => ({ ...p, priority: e.target.value }))}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></div>
                </div>
                <div className="form-group"><label>Categoria</label><select className="select" value={editData.category_id} onChange={e => setEditData((p: any) => ({ ...p, category_id: e.target.value }))}><option value="">Nenhuma</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                {isDono && (
                  <div className="form-group"><label>Cliente</label><select className="select" value={editData.client_id || ''} onChange={e => setEditData((p: any) => ({ ...p, client_id: e.target.value }))}>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                )}
                <div className="form-row">
                  <div className="form-group"><label>Link Drive (Arquivo Bruto)</label><input className="input" value={editData.drive_link_raw} onChange={e => setEditData((p: any) => ({ ...p, drive_link_raw: e.target.value }))} placeholder="https://drive.google.com/..." /></div>
                  <div className="form-group"><label>Link Drive (Arquivo Pronto)</label><input className="input" value={editData.drive_link} onChange={e => setEditData((p: any) => ({ ...p, drive_link: e.target.value }))} placeholder="https://drive.google.com/..." /></div>
                </div>
                {/* Editorial workflow special fields */}
                {(task as any).subtask_kind === 'briefing' && (() => {
                  const dt = editData.meeting_datetime || ''
                  const datePart = dt.slice(0, 10)
                  const timePart = dt.slice(11, 16)
                  return (
                    <div style={{ marginTop: 12, padding: '14px 16px', background: 'rgba(255,179,0,0.06)', border: '1px solid rgba(255,179,0,0.2)', borderRadius: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB300', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Reuniao de Apresentacao</div>
                      <div className="form-row">
                        <div className="form-group"><label>Data da Reuniao *</label><input className="input" type="date" value={datePart} onChange={e => setEditData((p: any) => ({ ...p, meeting_datetime: e.target.value ? `${e.target.value}T${timePart || '09:00'}` : '' }))} /></div>
                        <div className="form-group"><label>Hora *</label><input className="input" type="time" value={timePart} onChange={e => setEditData((p: any) => ({ ...p, meeting_datetime: datePart ? `${datePart}T${e.target.value || '09:00'}` : '' }))} /></div>
                      </div>
                      <div style={{ fontSize: 10, color: '#6E6887' }}>Obrigatorio preencher antes de concluir o Briefing. Esta data vira o prazo da Reuniao Aprovacao Cliente.</div>
                    </div>
                  )
                })()}
                {(task as any).subtask_kind === 'aprov_briefing' && (() => {
                  const dt = editData.recording_datetime || ''
                  const datePart = dt.slice(0, 10)
                  const timePart = dt.slice(11, 16)
                  return (
                    <div style={{ marginTop: 12, padding: '14px 16px', background: 'rgba(255,179,0,0.06)', border: '1px solid rgba(255,179,0,0.2)', borderRadius: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB300', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Marcar Gravacao</div>
                      <div className="form-row">
                        <div className="form-group"><label>Data da Gravacao *</label><input className="input" type="date" value={datePart} onChange={e => setEditData((p: any) => ({ ...p, recording_datetime: e.target.value ? `${e.target.value}T${timePart || '09:00'}` : '' }))} /></div>
                        <div className="form-group"><label>Hora *</label><input className="input" type="time" value={timePart} onChange={e => setEditData((p: any) => ({ ...p, recording_datetime: datePart ? `${datePart}T${e.target.value || '09:00'}` : '' }))} /></div>
                      </div>
                      <div style={{ fontSize: 10, color: '#6E6887' }}>Obrigatorio preencher antes de concluir. Ao concluir, sera criada a tarefa de Gravacao (Ivandro) automaticamente.</div>
                    </div>
                  )
                })()}

                {/* Captacao dept — recording date/time (for non-editorial tasks) */}
                {!(task as any).subtask_kind && (() => {
                  const selDept = departments.find(d => String(d.id) === String(editData.department_id))
                  const isCaptacao = selDept && (/capt|produ/i.test(selDept.name))
                  if (!isCaptacao) return null
                  const dt = editData.recording_datetime || ''
                  const datePart = dt.slice(0, 10)
                  const timePart = dt.slice(11, 16)
                  return (
                    <div style={{ marginTop: 12, padding: '14px 16px', background: 'rgba(255,179,0,0.06)', border: '1px solid rgba(255,179,0,0.2)', borderRadius: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB300', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                        <Video size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Data e Hora da Gravacao
                      </div>
                      <div className="form-row">
                        <div className="form-group"><label>Data</label><input className="input" type="date" value={datePart} onChange={e => setEditData((p: any) => ({ ...p, recording_datetime: e.target.value ? `${e.target.value}T${timePart || '09:00'}` : '' }))} /></div>
                        <div className="form-group"><label>Hora</label><input className="input" type="time" value={timePart} onChange={e => setEditData((p: any) => ({ ...p, recording_datetime: datePart ? `${datePart}T${e.target.value || '09:00'}` : '' }))} /></div>
                      </div>
                      <div style={{ fontSize: 10, color: '#6E6887' }}>Essa tarefa aparecera no calendario de Gravacoes.</div>
                    </div>
                  )
                })()}

                {/* Conteudo pra aprovacao — accordion (colapsado por default, expande ao clicar) */}
                <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(245,166,35,0.04)', border: '1px solid rgba(245,166,35,0.12)', borderRadius: 10 }}>
                  <button
                    type="button"
                    onClick={() => setShowApprovalSection(v => !v)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: '#F5A623', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {showApprovalSection ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      Conteudo pra Aprovacao {(editData.approval_link || editData.approval_text || editData.publish_date || editData.publish_objective || (editData.approval_files || []).length > 0) && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'rgba(52,199,89,0.15)', color: '#34C759', border: '1px solid rgba(52,199,89,0.3)' }}>PREENCHIDO</span>}
                    </span>
                    <span style={{ fontSize: 10, color: '#A8A3B8', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                      {showApprovalSection ? 'clique pra recolher' : 'clique pra expandir'}
                    </span>
                  </button>
                  {showApprovalSection && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 10 }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#A8A3B8', cursor: 'pointer' }}>
                          <input type="checkbox" checked={!!editData.is_carrossel} onChange={e => {
                            const checked = e.target.checked
                            setEditData((p: any) => {
                              if (checked) {
                                const initial = (p.approval_files && p.approval_files.length > 0) ? p.approval_files : (p.approval_link ? [p.approval_link] : [''])
                                return { ...p, is_carrossel: true, approval_files: initial }
                              } else {
                                const first = (p.approval_files && p.approval_files[0]) || p.approval_link || ''
                                return { ...p, is_carrossel: false, approval_link: first, approval_files: first ? [first] : [] }
                              }
                            })
                          }} style={{ accentColor: '#FFB300' }} />
                          Carrossel (varios arquivos)
                        </label>
                      </div>
                      {editData.is_carrossel ? (
                        <div className="form-group">
                          <label>Arquivos do carrossel *</label>
                          {(editData.approval_files || []).map((url: string, idx: number) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                              <span style={{ minWidth: 56, fontSize: 11, color: '#6B6580', fontWeight: 700 }}>Slide {idx + 1}</span>
                              <input className="input" value={url} placeholder="Link do Drive (publico)" style={{ flex: 1 }} onChange={e => {
                                const v = e.target.value
                                setEditData((p: any) => ({ ...p, approval_files: p.approval_files.map((x: string, i: number) => i === idx ? v : x) }))
                              }} />
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditData((p: any) => ({ ...p, approval_files: p.approval_files.filter((_: string, i: number) => i !== idx) }))} title="Remover" style={{ padding: '6px 10px' }}>
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditData((p: any) => ({ ...p, approval_files: [...(p.approval_files || []), ''] }))} style={{ marginTop: 4 }}>
                            <Plus size={12} /> Adicionar slide
                          </button>
                          <small style={{ fontSize: 11, color: '#6B6580', marginTop: 6, display: 'block' }}>Cada link vira um slide pro cliente ver. Precisam ser publicos no Drive.</small>
                        </div>
                      ) : (
                        <div className="form-group"><label>Link do arquivo finalizado</label><input className="input" value={editData.approval_link || ''} onChange={e => setEditData((p: any) => ({ ...p, approval_link: e.target.value }))} placeholder="Link do Drive — compartilhamento: qualquer pessoa com o link" /><small style={{ fontSize: 11, color: '#6B6580', marginTop: 4, display: 'block' }}>O cliente vai ver o video/imagem embutido. Precisa estar publico no Drive.</small></div>
                      )}
                      <div className="form-group"><label>Texto / Legenda</label><textarea className="input" rows={3} value={editData.approval_text || ''} onChange={e => setEditData((p: any) => ({ ...p, approval_text: e.target.value }))} placeholder="Legenda do post, texto da publicacao, descricao..." /></div>
                      <div className="form-row">
                        <div className="form-group"><label>Data da Publicacao</label><input className="input" type="date" value={editData.publish_date || ''} onChange={e => setEditData((p: any) => ({ ...p, publish_date: e.target.value }))} /></div>
                        <div className="form-group"><label>Objetivo da Publicacao</label><input className="input" value={editData.publish_objective || ''} onChange={e => setEditData((p: any) => ({ ...p, publish_objective: e.target.value }))} placeholder="Ex: Gerar leads, engajamento, branding..." /></div>
                      </div>
                      <div style={{ fontSize: 10, color: '#6E6887' }}>Obrigatorio preencher pelo menos 1 link antes de enviar pra aprovacao. Data e objetivo sao opcionais.</div>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(!task.task_type || task.task_type === 'normal') && !(task as any).parent_task_id && (
                      <button className="btn btn-secondary btn-sm" onClick={handleConvertToMae} title="Converte esta tarefa em mae — permite adicionar subtarefas" style={{ color: '#FFB300', borderColor: 'rgba(255,179,0,0.35)' }}>
                        <Layers size={12} /> Tornar mae
                      </button>
                    )}
                    {!(task as any).parent_task_id && (
                      <button className="btn btn-secondary btn-sm" onClick={handleSaveAsTemplate} title="Salva esta tarefa como modelo — reutilizavel em novas tarefas" style={{ color: '#7ee787', borderColor: 'rgba(126,231,135,0.35)' }}>
                        <FileText size={12} /> Salvar como modelo
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}><X size={12} /> Cancelar</button>
                    <button className="btn btn-primary btn-sm" onClick={handleSaveEdit}><Save size={12} /> Salvar</button>
                  </div>
                </div>
              </>
            ) : (
              <>
                {task.description && !isCliente && <div style={{ fontSize: 13, color: '#A8A3B8', marginBottom: 16, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{task.description}</div>}
                {/* Overdue warning */}
                {!isCliente && task.due_date && (() => { const n = new Date(); return task.due_date.slice(0, 10) < `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}` })() && task.stage !== 'concluido' && task.stage !== 'rejeitado' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'rgba(255,107,107,0.08)', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#FF6B6B', fontWeight: 600 }}>
                    <AlertTriangle size={14} /> Tarefa atrasada! Prazo era {task.due_date.slice(0, 10)}
                  </div>
                )}
                <div className="lead-info">
                  <div className="lead-info-row"><span className="lead-info-label"><Building2 size={12} /> Cliente</span><span className="lead-info-value">{task.client_name}</span></div>
                  {task.department_name && <div className="lead-info-row"><span className="lead-info-label">Departamento</span><span className="lead-info-value" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: task.department_color }} />{task.department_name}</span></div>}
                  {task.category_name && <div className="lead-info-row"><span className="lead-info-label">Categoria</span><span className="stage-badge" style={{ background: `${task.category_color}20`, color: task.category_color }}>{task.category_name}</span></div>}
                  <div className="lead-info-row"><span className="lead-info-label"><User size={12} /> Responsavel</span><span className="lead-info-value">{task.assigned_name || 'Nao atribuido'}</span></div>
                  <div className="lead-info-row"><span className="lead-info-label">Prioridade</span><span className="lead-info-value" style={{ color: task.priority === 'urgent' ? '#FF6B6B' : task.priority === 'high' ? '#FFAA83' : '#A8A3B8' }}>{task.priority}</span></div>
                  {!isCliente && task.due_date && (() => { const n = new Date(); const today = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; const due = task.due_date.slice(0, 10); const overdue = due < today && task.stage !== 'concluido' && task.stage !== 'rejeitado'; const soon = !overdue && due <= today; return <div className="lead-info-row"><span className="lead-info-label"><Clock size={12} /> Prazo</span><span className="lead-info-value" style={{ color: overdue ? '#FF6B6B' : soon ? '#FBBC04' : undefined }}>{due}{overdue ? ' (ATRASADO)' : ''}</span></div> })()}
                  <div className="lead-info-row"><span className="lead-info-label">Criado por</span><span className="lead-info-value">{task.created_by_name}</span></div>
                  <div className="lead-info-row"><span className="lead-info-label"><Clock size={12} /> Criado em</span><span className="lead-info-value">{new Date(task.created_at).toLocaleString('pt-BR')}</span></div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                  {task.drive_link_raw && <a href={task.drive_link_raw} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm"><ExternalLink size={12} /> Arquivo Bruto</a>}
                  {task.drive_link && <a href={task.drive_link} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm"><ExternalLink size={12} /> Arquivo Pronto</a>}
                </div>

                {/* Editorial workflow display fields */}
                {(task as any).subtask_kind === 'briefing' && (
                  <div style={{ marginTop: 14, padding: '12px 14px', background: 'rgba(255,179,0,0.06)', border: '1px solid rgba(255,179,0,0.2)', borderRadius: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB300', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Reuniao de Apresentacao</div>
                    {(task as any).meeting_datetime ? (
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{new Date((task as any).meeting_datetime).toLocaleString('pt-BR')}</div>
                    ) : (
                      <div style={{ fontSize: 12, color: '#FFAA83' }}>Nao definida — preencha em "Editar" antes de concluir</div>
                    )}
                  </div>
                )}
                {(task as any).subtask_kind === 'aprov_briefing' && (
                  <div style={{ marginTop: 14, padding: '12px 14px', background: 'rgba(255,179,0,0.06)', border: '1px solid rgba(255,179,0,0.2)', borderRadius: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB300', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Data da Gravacao</div>
                    {(task as any).recording_datetime ? (
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{new Date((task as any).recording_datetime).toLocaleString('pt-BR')}</div>
                    ) : (
                      <div style={{ fontSize: 12, color: '#FFAA83' }}>Nao definida — preencha em "Editar" antes de concluir</div>
                    )}
                  </div>
                )}
                {(task as any).recording_datetime && ((task as any).subtask_kind === 'gravacao' || (/capt|produ/i.test(task.department_name || ''))) && (
                  <div style={{ marginTop: 14, padding: '14px 16px', background: 'linear-gradient(135deg, rgba(255,179,0,0.08), rgba(93,173,226,0.06))', border: '1px solid rgba(255,179,0,0.25)', borderRadius: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB300', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                      <Video size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Data e Hora da Gravacao
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-heading)', color: '#F2F0F7' }}>
                      {new Date((task as any).recording_datetime).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#FFB300', marginTop: 2 }}>
                      {new Date((task as any).recording_datetime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                )}
                {/* Timer — mae editorial mostra agregado sem botoes; tarefas normais e subtarefas tem o botao */}
                {(isFunc || isDono) && (() => {
                  const isMother = (task as any).task_type && (task as any).task_type !== 'normal'
                  return (
                    <div style={{ marginTop: 16, padding: '12px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 11, color: '#6B6580', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.5 }}>{isMother ? 'Tempo Total (Soma das Subtarefas)' : 'Tempo Total'}</div>
                          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-heading)', color: totalTime > 0 ? '#FFB300' : '#6B6580' }}>{formatTime(totalTime + (timerRunning && !isMother ? timerElapsed : 0))}</div>
                        </div>
                        {!isMother && (timerRunning ? (
                          <button className="btn btn-danger btn-sm" onClick={handleStopTimer}>⏹ Parar</button>
                        ) : (
                          <button className="btn btn-primary btn-sm" onClick={handleStartTimer}>▶ Iniciar Timer</button>
                        ))}
                      </div>
                      {timerRunning && !isMother && <div style={{ fontSize: 11, color: '#34C759', marginTop: 4 }}>⏱ Cronometro ativo: {formatTime(timerElapsed)}</div>}
                    </div>
                  )
                })()}
              </>
            )}
          </div>

          {/* Checklist — bloqueia conclusao se tem item pendente. So aparece se tem items OU se nao eh mae (mae nao precisa) */}
          {!((task as any).task_type === 'mae' || (task as any).task_type === 'mae_editorial') && (
            <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid #5DADE2' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#5DADE2', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle size={12} /> Checklist ({checklist.filter(i => i.done).length}/{checklist.length})
                </div>
                {checklist.length > 0 && checklist.every(i => i.done) && (
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(52,199,89,0.15)', color: '#34C759', fontWeight: 700, letterSpacing: '.04em', border: '1px solid rgba(52,199,89,0.3)' }}>✓ Tudo pronto</span>
                )}
                {checklist.length > 0 && checklist.some(i => !i.done) && (
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,179,0,0.12)', color: '#FFB300', fontWeight: 700, letterSpacing: '.04em', border: '1px solid rgba(255,179,0,0.3)' }}>bloqueia conclusao</span>
                )}
              </div>
              {checklist.length === 0 && !canEdit && (
                <div style={{ padding: '10px 12px', fontSize: 12, color: '#9B96B0', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: 6 }}>
                  Sem checklist nesta tarefa.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {checklist.map((item, idx) => (
                  <div
                    key={item.id}
                    draggable={canEdit}
                    onDragStart={() => setDragIdx(idx)}
                    onDragOver={e => { e.preventDefault(); if (dragIdx !== null && dragOverIdx !== idx) setDragOverIdx(idx) }}
                    onDragLeave={() => { if (dragOverIdx === idx) setDragOverIdx(null) }}
                    onDrop={() => handleChecklistDrop(idx)}
                    onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6,
                      background: dragOverIdx === idx && dragIdx !== idx ? 'rgba(255,179,0,0.10)'
                        : item.done ? 'rgba(52,199,89,0.05)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${dragOverIdx === idx && dragIdx !== idx ? 'rgba(255,179,0,0.45)'
                        : item.done ? 'rgba(52,199,89,0.15)' : 'rgba(255,255,255,0.05)'}`,
                      opacity: dragIdx === idx ? 0.4 : 1,
                      transition: 'background 0.15s, opacity 0.15s',
                    }}
                  >
                    {canEdit && (
                      <span style={{ cursor: 'grab', color: '#6B6580', display: 'flex', alignItems: 'center', flexShrink: 0 }} title="Arraste pra reordenar">
                        <GripVertical size={14} />
                      </span>
                    )}
                    <input
                      type="checkbox"
                      checked={!!item.done}
                      onChange={() => handleToggleChecklistItem(item)}
                      disabled={!canEdit}
                      style={{ width: 16, height: 16, accentColor: '#34C759', cursor: canEdit ? 'pointer' : 'default', flexShrink: 0 }}
                    />
                    <span style={{ flex: 1, fontSize: 13, color: item.done ? '#6B6580' : '#F0EDF5', textDecoration: item.done ? 'line-through' : 'none', minWidth: 0, wordBreak: 'break-word' }}>
                      {item.text}
                    </span>
                    {canEdit && (
                      <button onClick={() => handleDeleteChecklistItem(item)} className="btn btn-secondary btn-sm btn-icon" title="Remover" style={{ padding: '4px 6px', fontSize: 10, opacity: 0.6 }}>
                        <X size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 6, marginTop: checklist.length > 0 ? 10 : 0 }}>
                  <input
                    className="input"
                    placeholder="Adicionar item ao checklist e pressionar Enter"
                    value={newChecklistText}
                    onChange={e => setNewChecklistText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddChecklistItem() } }}
                    style={{ flex: 1, fontSize: 12 }}
                  />
                  <button className="btn btn-secondary btn-sm" onClick={handleAddChecklistItem} disabled={!newChecklistText.trim()}>
                    <Plus size={12} /> Adicionar
                  </button>
                </div>
              )}
            </div>
          )}
          {/* Subtarefas movidas pra aba "Subtarefas" no tab bar abaixo — vide activeTab === "subtasks" */}
        </div>

        {/* Right column — different for client vs team */}
        <div>
          {/* CLIENT VIEW: Approval content only */}
          {isCliente ? (
            <div>
              {/* Approval content */}
              {(task.approval_link || task.approval_text) ? (
                <div className="card" style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#F5A623', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>Conteudo para Aprovacao</div>
                  {(() => {
                    const files = getApprovalFiles(task as any)
                    if (files.length === 0) return null
                    const isCarrossel = files.length > 1
                    return (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#9B96B0', marginBottom: 6 }}>
                          {isCarrossel ? `Carrossel — ${files.length} arquivos` : 'Arquivo a ser postado'}
                        </div>
                        {isCliente ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            {files.map((url, idx) => isDriveUrl(url) ? (
                              <div key={idx}>
                                {isCarrossel && <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB300', marginBottom: 6, letterSpacing: 0.5 }}>SLIDE {idx + 1} / {files.length}</div>}
                                <div style={{ width: '100%', maxWidth: 800, aspectRatio: '16/9', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', background: '#000' }}>
                                  <iframe
                                    src={toDriveEmbedUrl(url) || ''}
                                    title={`Arquivo ${idx + 1} — ${task.title}`}
                                    allow="autoplay; fullscreen; encrypted-media"
                                    allowFullScreen
                                    style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                                  />
                                </div>
                                <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 11, color: '#9B96B0', textDecoration: 'none' }}>
                                  <ExternalLink size={11} /> Abrir em nova aba
                                </a>
                              </div>
                            ) : (
                              <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" style={{ display: 'inline-flex', alignSelf: 'flex-start' }}>
                                <ExternalLink size={14} /> {isCarrossel ? `Ver Slide ${idx + 1}` : 'Ver Arquivo'}
                              </a>
                            ))}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {files.map((url, idx) => (
                              <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" style={{ display: 'inline-flex' }}>
                                <ExternalLink size={14} /> {isCarrossel ? `Slide ${idx + 1}` : 'Ver Arquivo'}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  {task.approval_text && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#9B96B0', marginBottom: 6 }}>Legenda do post</div>
                      <div style={{ padding: '14px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', fontSize: 14, lineHeight: 1.6, color: '#F2F0F7', whiteSpace: 'pre-wrap' }}>
                        {task.approval_text}
                      </div>
                    </div>
                  )}
                  {(task.publish_date || task.publish_objective) && (
                    <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                      {task.publish_date && <div><span style={{ color: '#6E6887', fontSize: 11 }}>Data publicacao: </span><strong>{task.publish_date}</strong></div>}
                      {task.publish_objective && <div><span style={{ color: '#6E6887', fontSize: 11 }}>Objetivo: </span><strong>{task.publish_objective}</strong></div>}
                    </div>
                  )}
                </div>
              ) : (
                <div className="card" style={{ textAlign: 'center', padding: 40, color: '#6E6887' }}>
                  Conteudo ainda nao disponivel. A equipe esta trabalhando nesta tarefa.
                </div>
              )}

              {/* Client comments (non-internal only) */}
              <div className="card">
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6E6887', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Comentarios</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input className="input" placeholder="Deixe um comentario..." value={commentText} onChange={e => setCommentText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleComment()} />
                  <button className="btn btn-primary btn-icon" onClick={handleComment}><Send size={16} /></button>
                </div>
                {comments.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#6E6887', padding: 20, fontSize: 13 }}>Nenhum comentario</div>
                ) : [...comments].reverse().map(c => (
                  <div key={c.id} style={{ padding: '10px 12px', marginBottom: 6, borderRadius: 8, background: 'rgba(52,199,89,0.04)', border: '1px solid rgba(52,199,89,0.12)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{c.user_name}</span>
                    </div>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{c.content}</div>
                    <div style={{ fontSize: 10, color: '#6E6887', marginTop: 4 }}>{new Date(c.created_at).toLocaleString('pt-BR')}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
          /* TEAM VIEW: Full tabs */
          <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
            {((task as any).task_type === 'mae' || (task as any).task_type === 'mae_editorial') && (
              <button className={`btn btn-sm ${activeTab === 'subtasks' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('subtasks')}>
                <Layers size={12} /> Subtarefas ({((task as any).subtasks || []).filter((s: any) => s.stage === 'concluido').length}/{((task as any).subtasks || []).length})
              </button>
            )}
            <button className={`btn btn-sm ${activeTab === 'comments' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('comments')}><MessageCircle size={12} /> Comentarios ({comments.length})</button>
            <button className={`btn btn-sm ${activeTab === 'history' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('history')}><GitBranch size={12} /> Historico</button>
            <button className={`btn btn-sm ${activeTab === 'time' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('time')}><Clock size={12} /> Tempo ({formatTime(totalTime)})</button>
            <button className={`btn btn-sm ${activeTab === 'attachments' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('attachments')}><Paperclip size={12} /> Anexos ({attachments.length})</button>
          </div>

          {activeTab === 'subtasks' && ((task as any).task_type === 'mae' || (task as any).task_type === 'mae_editorial') && (
            <div className="card" style={{ minHeight: 350, borderLeft: '3px solid #FFB300' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB300', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Layers size={12} /> Subtarefas ({((task as any).subtasks || []).filter((s: any) => s.stage === 'concluido').length}/{((task as any).subtasks || []).length})
                </div>
                {!isCliente && (
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowNewSub(true)} style={{ padding: '4px 10px', fontSize: 11 }}>
                    <Plus size={11} /> Subtarefa
                  </button>
                )}
              </div>
              {((task as any).subtasks || []).length === 0 && (
                <div style={{ padding: '12px 14px', fontSize: 12, color: '#9B96B0', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: 8 }}>
                  Sem subtarefas ainda. Clica em "+ Subtarefa" pra adicionar a primeira.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {((task as any).subtasks || []).map((sub: any) => {
                  const isOverdueSub = sub.due_date && sub.due_date.slice(0, 10) < (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}` })() && sub.stage !== 'concluido' && sub.stage !== 'rejeitado'
                  const isEditing = editingSubId === sub.id
                  return (
                    <div key={sub.id}
                      style={{ padding: '12px 14px', borderRadius: 8, background: isEditing ? 'rgba(255,179,0,0.06)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isEditing ? 'rgba(255,179,0,0.35)' : (sub.stage === 'concluido' ? 'rgba(52,199,89,0.2)' : 'rgba(255,255,255,0.06)')}`, borderLeft: `3px solid ${sub.stage_color || '#6B6580'}`, transition: 'background 0.15s' }}>
                      {isEditing ? (
                        <div onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                            <span style={{ width: 22, height: 22, borderRadius: '50%', background: sub.stage_color || '#6B6580', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{sub.subtask_position}</span>
                            <input className="input" value={editingSubData.title || ''} onChange={e => setEditingSubData((p: any) => ({ ...p, title: e.target.value }))} placeholder="Titulo" style={{ flex: 1, fontSize: 13, fontWeight: 700 }} autoFocus />
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 8 }}>
                            <input className="input" type="date" value={editingSubData.due_date || ''} onChange={e => setEditingSubData((p: any) => ({ ...p, due_date: e.target.value }))} style={{ fontSize: 12 }} />
                            <select className="select" value={editingSubData.priority || 'normal'} onChange={e => setEditingSubData((p: any) => ({ ...p, priority: e.target.value }))} style={{ fontSize: 12 }}>
                              <option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option>
                            </select>
                            <select className="select" value={editingSubData.department_id || ''} onChange={e => setEditingSubData((p: any) => ({ ...p, department_id: e.target.value }))} style={{ fontSize: 12 }}>
                              <option value="">Sem depto</option>
                              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                          </div>
                          <div style={{ marginBottom: 8 }}>
                            <AssigneesMultiSelect users={users} selected={editingSubData.assigned_to || []} onChange={arr => setEditingSubData((p: any) => ({ ...p, assigned_to: arr }))} />
                          </div>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary btn-sm" onClick={cancelEditSub} disabled={savingSubInline}><X size={11} /> Cancelar</button>
                            <button className="btn btn-primary btn-sm" onClick={saveEditSub} disabled={savingSubInline}>{savingSubInline ? 'Salvando...' : <><Save size={11} /> Salvar</>}</button>
                          </div>
                        </div>
                      ) : (
                        <div onClick={() => navigate(`/tasks/${sub.id}`)} style={{ cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                              <span style={{ width: 22, height: 22, borderRadius: '50%', background: sub.stage_color || '#6B6580', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{sub.subtask_position}</span>
                              <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {sub.title.replace(' - ' + task.title, '').replace(task.title + ' - ', '')}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                              <span className="stage-badge" style={{ background: `${sub.stage_color}20`, color: sub.stage_color }}>{sub.stage_name}</span>
                              {canEdit && (
                                <button className="btn btn-secondary btn-sm" onClick={e => { e.stopPropagation(); startEditSub(sub) }} title="Editar rapido (sem sair)" style={{ padding: '4px 7px', fontSize: 10 }}>
                                  <Edit3 size={10} />
                                </button>
                              )}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#6B6580', flexWrap: 'wrap' }}>
                            {sub.department_name && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: sub.department_color }} />
                                {sub.department_name}
                              </span>
                            )}
                            {sub.assigned_name && <span><User size={10} /> {sub.assigned_name}</span>}
                            {sub.due_date && (
                              <span style={{ color: isOverdueSub ? '#FF6B6B' : '#6B6580', fontWeight: isOverdueSub ? 700 : 400, display: 'flex', alignItems: 'center', gap: 3 }}>
                                <Clock size={10} /> {sub.due_date.slice(0, 10)}{isOverdueSub ? ' (atrasada)' : ''}
                              </span>
                            )}
                            {sub.comment_count > 0 && <span><MessageCircle size={10} /> {sub.comment_count}</span>}
                            {sub.total_time_seconds > 0 && <span style={{ color: '#FFB300' }}><Clock size={10} /> {formatTime(sub.total_time_seconds)}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {activeTab === 'comments' && (
            <div className="card" style={{ minHeight: 350 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input className="input" placeholder="Adicionar comentario..." value={commentText} onChange={e => setCommentText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleComment()} />
                {!isCliente && <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, whiteSpace: 'nowrap', cursor: 'pointer', color: '#6B6580' }}><input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} />Interno</label>}
                <button className="btn btn-primary btn-icon" onClick={handleComment}><Send size={16} /></button>
              </div>
              {[...comments].reverse().map(c => (
                <div key={c.id} style={{ padding: '10px 12px', marginBottom: 6, borderRadius: 8, borderLeft: `3px solid ${c.is_internal ? '#FFB300' : '#34C759'}`, background: c.is_internal ? 'rgba(255,179,0,0.04)' : 'rgba(52,199,89,0.04)', border: `1px solid ${c.is_internal ? 'rgba(255,179,0,0.12)' : 'rgba(52,199,89,0.12)'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{c.user_name} <span style={{ fontSize: 10, color: '#6B6580', fontWeight: 400 }}>({c.user_role})</span></span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: c.is_internal ? '#FFB300' : '#34C759' }}>{c.is_internal ? '🔒 INTERNO' : '👁 CLIENTE'}</span>
                  </div>
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{c.content}</div>
                  <div style={{ fontSize: 10, color: '#6B6580', marginTop: 4 }}>{new Date(c.created_at).toLocaleString('pt-BR')}</div>
                </div>
              ))}
              {comments.length === 0 && <div style={{ textAlign: 'center', color: '#6B6580', padding: 30 }}>Nenhum comentario</div>}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="card" style={{ minHeight: 350 }}>
              {history.map((h, i) => (
                <div key={h.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: i < history.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FFB300', marginTop: 5, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13 }}>{h.from_stage_name ? `${h.from_stage_name} → ${h.to_stage_name}` : `Criado: ${h.to_stage_name}`}</div>
                    {h.comment && <div style={{ fontSize: 12, color: '#A8A3B8', marginTop: 2 }}>{h.comment}</div>}
                    <div style={{ fontSize: 10, color: '#6B6580' }}>{h.user_name} · {new Date(h.created_at).toLocaleString('pt-BR')}</div>
                  </div>
                </div>
              ))}
              {history.length === 0 && <div style={{ textAlign: 'center', color: '#6B6580', padding: 30 }}>Sem historico</div>}
            </div>
          )}

          {activeTab === 'time' && (
            <div className="card" style={{ minHeight: 350 }}>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-heading)', color: '#FFB300', marginBottom: 16 }}>
                Total: {formatTime(totalTime)}
              </div>
              {timeEntries.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#6B6580', padding: 30 }}>Nenhum registro de tempo</div>
              ) : timeEntries.map(te => (
                <div key={te.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{te.user_name}</div>
                    <div style={{ fontSize: 11, color: '#6B6580' }}>{new Date(te.started_at).toLocaleString('pt-BR')}{te.ended_at ? ` → ${new Date(te.ended_at).toLocaleString('pt-BR')}` : ' (ativo)'}</div>
                    {te.description && <div style={{ fontSize: 11, color: '#A8A3B8', marginTop: 2 }}>{te.description}</div>}
                  </div>
                  <div style={{ fontWeight: 700, color: te.ended_at ? '#A8A3B8' : '#34C759', fontFamily: 'var(--font-heading)' }}>
                    {te.duration_seconds ? formatTime(te.duration_seconds) : '⏱ Ativo'}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'attachments' && (
            <div className="card" style={{ minHeight: 350 }}>
              {canEdit && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                  <input className="input" placeholder="URL do arquivo..." value={newAttUrl} onChange={e => setNewAttUrl(e.target.value)} style={{ flex: 2 }} />
                  <input className="input" placeholder="Nome..." value={newAttName} onChange={e => setNewAttName(e.target.value)} style={{ flex: 1 }} />
                  <button className="btn btn-primary btn-icon" onClick={handleAddAttachment} disabled={!newAttUrl || !newAttName}><Plus size={16} /></button>
                </div>
              )}
              {attachments.map(a => (
                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div><div style={{ fontSize: 13, fontWeight: 600 }}>{a.filename}</div><div style={{ fontSize: 10, color: '#6B6580' }}>{a.uploaded_by_name} · {new Date(a.created_at).toLocaleString('pt-BR')}</div></div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm"><Eye size={12} /> Ver</a>
                    {canEdit && <button className="btn btn-danger btn-sm btn-icon" onClick={() => { if (confirm(`Excluir anexo "${a.filename}"?`)) { deleteTaskAttachment(task!.id, a.id).then(loadTask) } }}><Trash2 size={12} /></button>}
                  </div>
                </div>
              ))}
              {attachments.length === 0 && <div style={{ textAlign: 'center', color: '#6B6580', padding: 30 }}>Nenhum anexo</div>}
            </div>
          )}
          </>
          )}
        </div>
      </div>

      {/* Confirm Recording modal */}
      {showRecording && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setShowRecording(false))() }}><div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
          <h2><Video size={18} style={{ marginRight: 8, verticalAlign: 'middle', color: '#FFB300' }} />Confirmar Data de Gravacao</h2>
          <p style={{ fontSize: 12, color: '#9B96B0', marginTop: -6, marginBottom: 16 }}>Sera criada a tarefa de Gravacao (no dia escolhido) e Criar Imagens (em paralelo). Apos a Gravacao concluir, Subir Arquivos e Editar Video sao criadas automaticamente.</p>
          <div className="form-group"><label>Data e Hora da Gravacao *</label><input className="input" type="datetime-local" value={recordingData.recording_datetime} onChange={e => setRecordingData(p => ({ ...p, recording_datetime: e.target.value }))} /></div>
          <div className="form-group">
            <label>Quem Grava (Captacao)</label>
            <select className="select" value={recordingData.capture_user_id} onChange={e => setRecordingData(p => ({ ...p, capture_user_id: e.target.value }))}>
              <option value="">Selecione</option>
              {users.filter(u => u.role !== 'cliente' && u.is_active).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Quem Edita Video</label>
              <select className="select" value={recordingData.edit_user_id} onChange={e => setRecordingData(p => ({ ...p, edit_user_id: e.target.value }))}>
                <option value="">Selecione</option>
                {users.filter(u => u.role !== 'cliente' && u.is_active).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Quem Cria Imagens (Design)</label>
              <select className="select" value={recordingData.design_user_id} onChange={e => setRecordingData(p => ({ ...p, design_user_id: e.target.value }))}>
                <option value="">Selecione</option>
                {users.filter(u => u.role !== 'cliente' && u.is_active).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ padding: '10px 12px', background: 'rgba(255,179,0,0.06)', border: '1px solid rgba(255,179,0,0.18)', borderRadius: 8, fontSize: 11, color: '#A8A3B8', marginBottom: 12 }}>
            <strong style={{ color: '#FFB300' }}>O que sera criado agora:</strong>
            <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
              <li>Gravacao (prazo no dia da gravacao)</li>
              <li>Criar Imagens (Design, em paralelo)</li>
            </ul>
            <strong style={{ color: '#FFB300', display: 'block', marginTop: 6 }}>Criadas automaticamente depois:</strong>
            <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
              <li>Subir Arquivos (apos gravacao concluir)</li>
              <li>Editar Video (apos subir arquivos concluir)</li>
            </ul>
          </div>
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={() => setShowRecording(false)}>Cancelar</button>
            <button className="btn btn-primary" onClick={handleConfirmRecording} disabled={!recordingData.recording_datetime}>Confirmar e Criar Tarefas</button>
          </div>
        </div></div>
      )}

      {/* New Subtarefa modal */}
      {showNewSub && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setShowNewSub(false))() }}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <h2><Plus size={18} style={{ marginRight: 8, verticalAlign: 'middle', color: '#FFB300' }} />Nova Subtarefa</h2>
            <p style={{ fontSize: 12, color: '#9B96B0', marginTop: -6, marginBottom: 16 }}>Vinculada a "{task?.title}". Ao concluir todas as subtarefas, a mae auto-conclui.</p>
            <div className="form-group"><label>Titulo *</label><input className="input" value={newSub.title} onChange={e => setNewSub(p => ({ ...p, title: e.target.value }))} placeholder="Ex: Desenhar capa" autoFocus /></div>
            <div className="form-group"><label>Descricao</label><textarea className="input" rows={3} value={newSub.description} onChange={e => setNewSub(p => ({ ...p, description: e.target.value }))} /></div>
            <div className="form-row">
              <div className="form-group"><label>Categoria</label><select className="select" value={newSub.category_id} onChange={e => setNewSub(p => ({ ...p, category_id: e.target.value }))}><option value="">Nenhuma</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div className="form-group"><label>Departamento</label><select className="select" value={newSub.department_id} onChange={e => setNewSub(p => ({ ...p, department_id: e.target.value }))}><option value="">Nenhum</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            </div>
            <div className="form-group">
              <label>Responsaveis</label>
              <AssigneesMultiSelect users={users} selected={newSub.assigned_to} onChange={arr => setNewSub(p => ({ ...p, assigned_to: arr }))} />
            </div>
            <div className="form-row">
              <div className="form-group"><label>Prazo</label><input className="input" type="date" value={newSub.due_date} onChange={e => setNewSub(p => ({ ...p, due_date: e.target.value }))} /></div>
              <div className="form-group"><label>Prioridade</label><select className="select" value={newSub.priority} onChange={e => setNewSub(p => ({ ...p, priority: e.target.value }))}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>Link Drive (Arquivo Bruto)</label><input className="input" value={newSub.drive_link_raw} onChange={e => setNewSub(p => ({ ...p, drive_link_raw: e.target.value }))} placeholder="https://drive.google.com/..." /></div>
              <div className="form-group"><label>Link Drive (Arquivo Pronto)</label><input className="input" value={newSub.drive_link} onChange={e => setNewSub(p => ({ ...p, drive_link: e.target.value }))} placeholder="https://drive.google.com/..." /></div>
            </div>
            {/* Conteudo pra aprovacao — accordion (colapsado por default) */}
            <div style={{ marginTop: 8, padding: '10px 14px', background: 'rgba(245,166,35,0.04)', border: '1px solid rgba(245,166,35,0.12)', borderRadius: 10 }}>
              <button
                type="button"
                onClick={() => setNewSubShowApproval(v => !v)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: '#F5A623', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {newSubShowApproval ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  Conteudo pra Aprovacao (opcional)
                </span>
                <span style={{ fontSize: 10, color: '#A8A3B8', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                  {newSubShowApproval ? 'recolher' : 'expandir'}
                </span>
              </button>
              {newSubShowApproval && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 10 }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#A8A3B8', cursor: 'pointer' }}>
                      <input type="checkbox" checked={newSubIsCarrossel} onChange={e => {
                        const checked = e.target.checked
                        if (checked) { setNewSubIsCarrossel(true); setNewSubFiles(newSub.approval_link ? [newSub.approval_link] : ['']) }
                        else { setNewSubIsCarrossel(false); setNewSub(p => ({ ...p, approval_link: newSubFiles[0] || '' })) }
                      }} style={{ accentColor: '#FFB300' }} />
                      Carrossel (varios arquivos)
                    </label>
                  </div>
                  {newSubIsCarrossel ? (
                    <div className="form-group">
                      <label>Arquivos do carrossel</label>
                      {newSubFiles.map((url, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <span style={{ minWidth: 56, fontSize: 11, color: '#6B6580', fontWeight: 700 }}>Slide {idx + 1}</span>
                          <input className="input" value={url} placeholder="Link do Drive (publico)" style={{ flex: 1 }} onChange={e => setNewSubFiles(arr => arr.map((x, i) => i === idx ? e.target.value : x))} />
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNewSubFiles(arr => arr.filter((_, i) => i !== idx))} title="Remover" style={{ padding: '6px 10px' }}><X size={12} /></button>
                        </div>
                      ))}
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNewSubFiles(arr => [...arr, ''])} style={{ marginTop: 4 }}><Plus size={12} /> Adicionar slide</button>
                    </div>
                  ) : (
                    <div className="form-group"><label>Link do arquivo finalizado</label><input className="input" value={newSub.approval_link} onChange={e => setNewSub(p => ({ ...p, approval_link: e.target.value }))} placeholder="Link do Drive — compartilhamento: qualquer pessoa com o link" /></div>
                  )}
                  <div className="form-group"><label>Texto / Legenda</label><textarea className="input" rows={3} value={newSub.approval_text} onChange={e => setNewSub(p => ({ ...p, approval_text: e.target.value }))} placeholder="Legenda do post, texto da publicacao..." /></div>
                  <div className="form-row">
                    <div className="form-group"><label>Data da Publicacao</label><input className="input" type="date" value={newSub.publish_date} onChange={e => setNewSub(p => ({ ...p, publish_date: e.target.value }))} /></div>
                    <div className="form-group"><label>Objetivo da Publicacao</label><input className="input" value={newSub.publish_objective} onChange={e => setNewSub(p => ({ ...p, publish_objective: e.target.value }))} placeholder="Ex: Gerar leads..." /></div>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNewSub(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleAddSubtask} disabled={savingSub || !newSub.title}>{savingSub ? 'Adicionando...' : 'Adicionar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {showReject && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setShowReject(false))() }}><div className="modal" onClick={e => e.stopPropagation()}>
          <h2>Rejeitar Tarefa</h2>
          <div className="form-group"><label>Motivo da rejeicao *</label><textarea className="input" rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Descreva o que precisa ser alterado..." /></div>
          <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setShowReject(false)}>Cancelar</button><button className="btn btn-danger" onClick={handleReject} disabled={!rejectReason.trim()}>Rejeitar</button></div>
        </div></div>
      )}

      {/* Timer hourly check popup */}
      {showTimerCheck && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400, textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>&#9202;</div>
            <h2 style={{ marginBottom: 8 }}>Tarefa em producao ha mais de 2 horas</h2>
            <p style={{ color: '#9B96B0', fontSize: 14, marginBottom: 8 }}>O timer desta tarefa esta ativo ha <strong style={{ color: '#FFB300' }}>{formatTime(timerElapsed)}</strong></p>
            <p style={{ color: '#6B6580', fontSize: 12, marginBottom: 6 }}>"{task?.title}"</p>
            <p style={{ color: '#A8A3B8', fontSize: 12, marginBottom: 20 }}>Confirma que ainda esta trabalhando nela ou deseja parar o timer e mover pro backlog?</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={() => setShowTimerCheck(false)} style={{ minWidth: 120 }}>Sim, continuar</button>
              <button className="btn btn-danger" onClick={handleTimerCheckNo} style={{ minWidth: 120 }}>Parar timer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
