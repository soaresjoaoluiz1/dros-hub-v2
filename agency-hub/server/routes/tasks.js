import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { broadcastSSE } from '../sse.js'
import { notify, notifyMany, getDonoUsers, getClientUsers } from '../notifications.js'
import { createTaskFromTemplate } from '../services/taskTemplates.js'

const router = Router()

// Helper: get assignee IDs and names for a task
function getAssignees(taskId) {
  return db.prepare('SELECT ta.user_id, u.name FROM task_assignees ta JOIN users u ON ta.user_id = u.id WHERE ta.task_id = ?').all(taskId)
}
function setAssignees(taskId, userIds) {
  db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(taskId)
  if (userIds?.length) {
    const stmt = db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)')
    userIds.forEach(uid => stmt.run(taskId, uid))
  }
}

// Stage transition rules per role
const TRANSITIONS = {
  dono: null, // can do anything
  gerente: null, // mesmo poder do dono em mover etapas
  funcionario: null, // funcionarios can move to any stage
  cliente: { aguardando_cliente: ['aprovado_cliente', 'revisao_interna'] },
}

function canTransition(role, fromStage, toStage) {
  if (TRANSITIONS[role] === null) return true // null = can do anything
  const allowed = TRANSITIONS[role]?.[fromStage]
  return allowed ? allowed.includes(toStage) : false
}

// List tasks with filters
router.get('/', (req, res) => {
  const { client_id, department_id, stage, assigned_to, category_id, priority, search, date_from, date_to, date_field = 'created', page = '1', limit = '30' } = req.query
  const where = ['t.is_active = 1']
  const params = []

  // Mostrar: standalone, mae, primeira subtarefa nao-concluida da mae,
  // E qualquer subtarefa que esteja em stage "ativo" (em_producao, ajustar,
  // aguardando_cliente, etc) — qualquer coisa fora de backlog/programar_publicacao
  // precisa de atencao no pipeline mesmo nao sendo a "proxima da fila".
  where.push(`(
    t.parent_task_id IS NULL
    OR t.subtask_position = (
      SELECT MIN(t2.subtask_position) FROM tasks t2
      WHERE t2.parent_task_id = t.parent_task_id
        AND t2.is_active = 1
        AND t2.stage NOT IN ('concluido', 'rejeitado')
    )
    OR t.stage NOT IN ('concluido', 'rejeitado', 'backlog', 'programar_publicacao')
  )`)

  // Role-based scoping
  if (req.user.role === 'cliente') {
    // Cliente so ve tarefas voltadas pra ele: aguardando aprovacao, aprovadas, publicadas
    where.push('t.client_id = ?'); params.push(req.user.client_id)
    where.push("t.stage IN ('aguardando_cliente', 'aprovado_cliente', 'programar_publicacao', 'concluido', 'rejeitado', 'solicitacao_pendente')")
  } else if (req.user.role === 'funcionario' || req.user.role === 'gerente') {
    // Gerente comporta como funcionario em tarefas: ve so as suas + do seu departamento
    where.push('(t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?) OR t.department_id IN (SELECT department_id FROM user_departments WHERE user_id = ?))')
    params.push(req.user.id, req.user.id)
  }

  if (client_id) { where.push('t.client_id = ?'); params.push(client_id) }
  if (department_id) { where.push('t.department_id = ?'); params.push(department_id) }
  if (stage) { where.push('t.stage = ?'); params.push(stage) }
  if (assigned_to) { where.push('t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?)'); params.push(assigned_to) }
  if (category_id) { where.push('t.category_id = ?'); params.push(category_id) }
  if (priority) { where.push('t.priority = ?'); params.push(priority) }
  if (search) { where.push("(t.title LIKE ? OR t.description LIKE ?)"); params.push(`%${search}%`, `%${search}%`) }
  // Filtro de data: 'created' (default) filtra por criacao,
  // 'due' por prazo, 'completed' pela data em que a tarefa foi movida pra 'concluido' (task_history).
  if (date_field === 'due') {
    if (date_from) { where.push("date(t.due_date) >= date(?)"); params.push(date_from) }
    if (date_to) { where.push("date(t.due_date) <= date(?)"); params.push(date_to) }
  } else if (date_field === 'completed') {
    // Tarefa aparece se qualquer transicao pra 'concluido' cair dentro do range
    if (date_from || date_to) {
      const conds = ["th.task_id = t.id", "th.to_stage = 'concluido'"]
      const p2 = []
      if (date_from) { conds.push("date(th.created_at, '-3 hours') >= date(?)"); p2.push(date_from) }
      if (date_to) { conds.push("date(th.created_at, '-3 hours') <= date(?)"); p2.push(date_to) }
      where.push(`EXISTS (SELECT 1 FROM task_history th WHERE ${conds.join(' AND ')})`)
      params.push(...p2)
    }
  } else {
    if (date_from) { where.push('t.created_at >= ?'); params.push(date_from) }
    if (date_to) { where.push('t.created_at <= ?'); params.push(date_to + ' 23:59:59') }
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM tasks t WHERE ${where.join(' AND ')}`).get(...params).c
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const tasks = db.prepare(`
    SELECT t.*, c.name as client_name, d.name as department_name, d.color as department_color,
      cat.name as category_name, cat.color as category_color,
      (SELECT GROUP_CONCAT(u2.name, ', ') FROM task_assignees ta2 JOIN users u2 ON ta2.user_id = u2.id WHERE ta2.task_id = t.id) as assigned_name,
      creator.name as created_by_name,
      (SELECT COUNT(*) FROM task_comments WHERE task_id = t.id) as comment_count,
      (SELECT COUNT(*) FROM tasks ts WHERE ts.parent_task_id = t.id AND ts.is_active = 1) as subtask_count,
      (SELECT COUNT(*) FROM tasks ts WHERE ts.parent_task_id = t.id AND ts.is_active = 1 AND ts.stage = 'concluido') as subtask_done_count,
      (SELECT MAX(th.created_at) FROM task_history th WHERE th.task_id = t.id AND th.to_stage = 'aguardando_cliente') as waiting_client_since,
      ps.name as stage_name, ps.color as stage_color
    FROM tasks t
    LEFT JOIN clients c ON t.client_id = c.id
    LEFT JOIN departments d ON t.department_id = d.id
    LEFT JOIN task_categories cat ON t.category_id = cat.id
    LEFT JOIN users creator ON t.created_by = creator.id
    LEFT JOIN pipeline_stages ps ON t.stage = ps.slug
    WHERE ${where.join(' AND ')}
    ORDER BY t.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset)

  res.json({ tasks, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) })
})

// Pipeline view (grouped by stage)
router.get('/pipeline', (req, res) => {
  const { client_id, department_id, assigned_to } = req.query
  const where = ['t.is_active = 1']
  const params = []

  // Mostrar: standalone, mae, primeira subtarefa nao-concluida da mae,
  // E qualquer subtarefa que esteja em stage "ativo" (em_producao, ajustar,
  // aguardando_cliente, etc) — qualquer coisa fora de backlog/programar_publicacao
  // precisa de atencao no pipeline mesmo nao sendo a "proxima da fila".
  where.push(`(
    t.parent_task_id IS NULL
    OR t.subtask_position = (
      SELECT MIN(t2.subtask_position) FROM tasks t2
      WHERE t2.parent_task_id = t.parent_task_id
        AND t2.is_active = 1
        AND t2.stage NOT IN ('concluido', 'rejeitado')
    )
    OR t.stage NOT IN ('concluido', 'rejeitado', 'backlog', 'programar_publicacao')
  )`)

  if (req.user.role === 'cliente') {
    where.push('t.client_id = ?'); params.push(req.user.client_id)
    where.push("t.stage IN ('aguardando_cliente', 'aprovado_cliente', 'programar_publicacao', 'concluido', 'rejeitado', 'solicitacao_pendente')")
  }
  else if (req.user.role === 'funcionario' || req.user.role === 'gerente') { where.push('(t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?) OR t.department_id IN (SELECT department_id FROM user_departments WHERE user_id = ?))'); params.push(req.user.id, req.user.id) }
  if (client_id) { where.push('t.client_id = ?'); params.push(client_id) }
  if (department_id) { where.push('t.department_id = ?'); params.push(department_id) }
  if (assigned_to) { where.push('t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?)'); params.push(assigned_to) }

  // Pipeline esconde solicitacao_pendente (cliente usa so a lista de Tarefas, dono usa aba Aprovacoes)
  where.push("t.stage != 'solicitacao_pendente'")
  const stages = db.prepare("SELECT * FROM pipeline_stages WHERE slug != 'solicitacao_pendente' ORDER BY position").all()
  const tasks = db.prepare(`
    SELECT t.*, c.name as client_name, d.name as department_name, d.color as department_color,
      (SELECT GROUP_CONCAT(u2.name, ', ') FROM task_assignees ta2 JOIN users u2 ON ta2.user_id = u2.id WHERE ta2.task_id = t.id) as assigned_name,
      (SELECT COUNT(*) FROM tasks ts WHERE ts.parent_task_id = t.id AND ts.is_active = 1) as subtask_count,
      (SELECT COUNT(*) FROM tasks ts WHERE ts.parent_task_id = t.id AND ts.is_active = 1 AND ts.stage = 'concluido') as subtask_done_count,
      ps.name as stage_name, ps.color as stage_color
    FROM tasks t
    LEFT JOIN clients c ON t.client_id = c.id LEFT JOIN departments d ON t.department_id = d.id
    LEFT JOIN pipeline_stages ps ON t.stage = ps.slug
    WHERE ${where.join(' AND ')}
    ORDER BY t.updated_at DESC
  `).all(...params)

  res.json({ stages, tasks })
})

// Create task
router.post('/', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  const { client_id, title, description, category_id, department_id, assigned_to, due_date, priority, drive_link, drive_link_raw, recording_datetime, approval_link, approval_text, approval_files, publish_date, publish_objective } = req.body
  if (!client_id || !title) return res.status(400).json({ error: 'client_id e title obrigatorios' })

  // assigned_to can be a single ID or array of IDs
  const assigneeIds = Array.isArray(assigned_to) ? assigned_to.filter(Boolean).map(Number) : (assigned_to ? [Number(assigned_to)] : [])
  const primaryAssignee = assigneeIds[0] || null

  // approval_files: array de strings. Quando preenchido, approval_link recebe o primeiro item (retrocompat).
  const filesArr = Array.isArray(approval_files) ? approval_files.filter(s => s && String(s).trim()) : []
  const filesJson = filesArr.length > 0 ? JSON.stringify(filesArr) : null
  const effectiveApprovalLink = filesArr.length > 0 ? filesArr[0] : (approval_link || null)

  const result = db.prepare(`
    INSERT INTO tasks (client_id, category_id, department_id, title, description, due_date, priority, assigned_to, drive_link, drive_link_raw, approval_link, approval_files, approval_text, publish_date, publish_objective, created_by, recording_datetime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(client_id, category_id || null, department_id || null, title, description || null, due_date || null, priority || 'normal', primaryAssignee, drive_link || null, drive_link_raw || null, effectiveApprovalLink, filesJson, approval_text || null, publish_date || null, publish_objective || null, req.user.id, recording_datetime || null)

  setAssignees(result.lastInsertRowid, assigneeIds)
  db.prepare('INSERT INTO task_history (task_id, to_stage, user_id) VALUES (?, ?, ?)').run(result.lastInsertRowid, 'backlog', req.user.id)

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid)
  broadcastSSE(task.client_id, 'task:created', task)
  // Notify all assignees
  assigneeIds.filter(uid => uid !== req.user.id).forEach(uid => {
    notify(uid, 'task_assigned', 'Nova tarefa atribuida', `"${task.title}" foi atribuida a voce`, task.id, req.user.id)
  })
  res.json({ task })
})

// Client creates a task request (requires internal approval before becoming work)
router.post('/request', (req, res) => {
  if (req.user.role !== 'cliente') return res.status(403).json({ error: 'Apenas clientes podem criar solicitacoes' })
  const { title, description, drive_link_raw } = req.body
  if (!title) return res.status(400).json({ error: 'title obrigatorio' })
  const result = db.prepare(`
    INSERT INTO tasks (client_id, title, description, stage, priority, created_by, requested_by_client, drive_link_raw)
    VALUES (?, ?, ?, 'solicitacao_pendente', 'normal', ?, 1, ?)
  `).run(req.user.client_id, title, description || null, req.user.id, drive_link_raw || null)
  db.prepare('INSERT INTO task_history (task_id, to_stage, user_id, comment) VALUES (?, ?, ?, ?)').run(result.lastInsertRowid, 'solicitacao_pendente', req.user.id, 'Solicitacao criada pelo cliente')
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid)
  broadcastSSE(task.client_id, 'task:created', task)
  // Notify dono/gerente
  notifyMany(getDonoUsers().map(d => d.id), 'client_request', 'Nova solicitacao de cliente', `"${task.title}"`, task.id, req.user.id)
  res.json({ task })
})

// Approve client request (moves to backlog for team)
router.post('/:id/approve-request', requireRole('dono', 'gerente'), (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Tarefa nao encontrada' })
  if (task.stage !== 'solicitacao_pendente') return res.status(400).json({ error: 'Solicitacao nao esta pendente' })
  db.prepare("UPDATE tasks SET stage = 'backlog', updated_at = datetime('now', '-3 hours') WHERE id = ?").run(task.id)
  db.prepare('INSERT INTO task_history (task_id, from_stage, to_stage, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(task.id, 'solicitacao_pendente', 'backlog', req.user.id, 'Solicitacao aprovada internamente')
  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)
  broadcastSSE(updated.client_id, 'task:stage_changed', updated)
  // Notify client user who created it
  if (task.created_by !== req.user.id) notify(task.created_by, 'task_approved', 'Solicitacao aprovada', `"${task.title}" foi aprovada e entrara em producao`, task.id, req.user.id)
  res.json({ task: updated })
})

// Reject client request (moves to rejeitado)
router.post('/:id/reject-request', requireRole('dono', 'gerente'), (req, res) => {
  const { comment } = req.body
  if (!comment) return res.status(400).json({ error: 'comment obrigatorio' })
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Tarefa nao encontrada' })
  if (task.stage !== 'solicitacao_pendente') return res.status(400).json({ error: 'Solicitacao nao esta pendente' })
  db.prepare("UPDATE tasks SET stage = 'rejeitado', updated_at = datetime('now', '-3 hours') WHERE id = ?").run(task.id)
  db.prepare('INSERT INTO task_history (task_id, from_stage, to_stage, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(task.id, 'solicitacao_pendente', 'rejeitado', req.user.id, comment)
  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)
  broadcastSSE(updated.client_id, 'task:stage_changed', updated)
  if (task.created_by !== req.user.id) notify(task.created_by, 'task_rejected', 'Solicitacao rejeitada', `"${task.title}": ${comment}`, task.id, req.user.id)
  res.json({ task: updated })
})

// List pending client requests (for dono/gerente)
router.get('/requests/pending', requireRole('dono', 'gerente'), (req, res) => {
  const tasks = db.prepare(`
    SELECT t.*, c.name as client_name, creator.name as created_by_name
    FROM tasks t
    LEFT JOIN clients c ON t.client_id = c.id
    LEFT JOIN users creator ON t.created_by = creator.id
    WHERE t.stage = 'solicitacao_pendente' AND t.requested_by_client = 1 AND t.is_active = 1
    ORDER BY t.created_at DESC
  `).all()
  res.json({ tasks })
})

// Gravacoes calendar — list recording tasks for a given month
router.get('/gravacoes/calendar', (req, res) => {
  const { month } = req.query
  if (!month) return res.status(400).json({ error: 'month obrigatorio (ex: 2026-05)' })
  const startDate = `${month}-01`
  const endParts = month.split('-')
  const endYear = parseInt(endParts[0])
  const endMonth = parseInt(endParts[1])
  const lastDay = new Date(endYear, endMonth, 0).getDate()
  const endDate = `${month}-${String(lastDay).padStart(2, '0')}`

  const gravacoes = db.prepare(`
    SELECT t.id, t.title, t.recording_datetime, t.due_date, t.stage, t.client_id, t.parent_task_id,
      c.name as client_name,
      (SELECT GROUP_CONCAT(u2.name, ', ') FROM task_assignees ta2 JOIN users u2 ON ta2.user_id = u2.id WHERE ta2.task_id = t.id) as assigned_name,
      ps.name as stage_name, ps.color as stage_color
    FROM tasks t
    LEFT JOIN clients c ON t.client_id = c.id
    LEFT JOIN pipeline_stages ps ON t.stage = ps.slug
    LEFT JOIN departments d ON t.department_id = d.id
    WHERE t.is_active = 1
      AND t.recording_datetime IS NOT NULL
      AND substr(t.recording_datetime, 1, 10) BETWEEN ? AND ?
      AND (
        t.subtask_kind = 'gravacao'
        OR d.name LIKE '%Capt%'
        OR d.name LIKE '%Producao%'
      )
    ORDER BY t.recording_datetime
  `).all(startDate, endDate)

  res.json({ gravacoes })
})

// Create generic mae task — sem subtarefas auto-criadas (option C)
// Subtarefas sao adicionadas manualmente via POST /:id/subtasks
router.post('/mae', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  const { client_id, title, description, due_date, category_id, department_id, priority, drive_link, drive_link_raw, approval_link, approval_files, approval_text, publish_date, publish_objective, assigned_to, sequential_subtasks } = req.body
  if (!client_id || !title) return res.status(400).json({ error: 'client_id e title obrigatorios' })
  const assigneeIds = Array.isArray(assigned_to) ? assigned_to.filter(Boolean).map(Number) : (assigned_to ? [Number(assigned_to)] : [])
  const primaryAssignee = assigneeIds[0] || null
  const filesArr = Array.isArray(approval_files) ? approval_files.filter(s => s && String(s).trim()) : []
  const filesJson = filesArr.length > 0 ? JSON.stringify(filesArr) : null
  const effectiveApprovalLink = filesArr.length > 0 ? filesArr[0] : (approval_link || null)
  const result = db.prepare(`
    INSERT INTO tasks (client_id, category_id, department_id, title, description, priority, due_date, created_by, stage, task_type, assigned_to, drive_link, drive_link_raw, approval_link, approval_files, approval_text, publish_date, publish_objective, sequential_subtasks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'backlog', 'mae', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(client_id, category_id || null, department_id || null, title, description || null, priority || 'normal', due_date || null, req.user.id, primaryAssignee, drive_link || null, drive_link_raw || null, effectiveApprovalLink, filesJson, approval_text || null, publish_date || null, publish_objective || null, sequential_subtasks ? 1 : 0)
  setAssignees(result.lastInsertRowid, assigneeIds)
  db.prepare('INSERT INTO task_history (task_id, to_stage, user_id) VALUES (?, ?, ?)').run(result.lastInsertRowid, 'backlog', req.user.id)
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid)
  broadcastSSE(task.client_id, 'task:created', task)
  res.json({ task })
})

// Add a custom subtask to a mae (works for task_type='mae' OR 'mae_editorial')
router.post('/:id/subtasks', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  const parent = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!parent) return res.status(404).json({ error: 'Tarefa-mae nao encontrada' })
  if (!parent.task_type || parent.task_type === 'normal') return res.status(400).json({ error: 'Tarefa nao e mae — nao aceita subtarefas' })
  const { title, description, due_date, category_id, department_id, priority, assigned_to, drive_link, drive_link_raw, approval_link, approval_files, approval_text, publish_date, publish_objective } = req.body
  if (!title) return res.status(400).json({ error: 'title obrigatorio' })
  const assigneeIds = Array.isArray(assigned_to) ? assigned_to.filter(Boolean).map(Number) : (assigned_to ? [Number(assigned_to)] : [])
  const primaryAssignee = assigneeIds[0] || null
  const filesArr = Array.isArray(approval_files) ? approval_files.filter(s => s && String(s).trim()) : []
  const filesJson = filesArr.length > 0 ? JSON.stringify(filesArr) : null
  const effectiveApprovalLink = filesArr.length > 0 ? filesArr[0] : (approval_link || null)
  const maxPos = db.prepare('SELECT COALESCE(MAX(subtask_position), 0) as m FROM tasks WHERE parent_task_id = ?').get(parent.id).m
  const result = db.prepare(`
    INSERT INTO tasks (client_id, category_id, department_id, title, description, priority, due_date, created_by, stage, task_type, parent_task_id, subtask_position, assigned_to, drive_link, drive_link_raw, approval_link, approval_files, approval_text, publish_date, publish_objective)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'backlog', 'normal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(parent.client_id, category_id || null, department_id || null, title, description || null, priority || 'normal', due_date || null, req.user.id, parent.id, maxPos + 1, primaryAssignee, drive_link || null, drive_link_raw || null, effectiveApprovalLink, filesJson, approval_text || null, publish_date || null, publish_objective || null)
  setAssignees(result.lastInsertRowid, assigneeIds)
  db.prepare('INSERT INTO task_history (task_id, to_stage, user_id) VALUES (?, ?, ?)').run(result.lastInsertRowid, 'backlog', req.user.id)
  const subtask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid)
  broadcastSSE(parent.client_id, 'task:created', subtask)
  res.json({ subtask })
})

// Save an existing task (idealmente mae com subtarefas) como task_template
// no modo biblioteca (is_recurring=0). Copia titulo, dept, priority, assignees + subs.
// Body opcional: { name?: string } — override do nome do modelo (default = task.title)
router.post('/:id/save-as-template', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Tarefa nao encontrada' })
  if (task.parent_task_id) return res.status(400).json({ error: 'Nao da pra salvar uma subtarefa como modelo — use a tarefa mae' })
  const templateName = (req.body?.name || task.title).trim()
  if (!templateName) return res.status(400).json({ error: 'nome do modelo obrigatorio' })

  const taskType = (task.task_type === 'mae' || task.task_type === 'mae_editorial') ? 'mae' : 'normal'
  const rootAssignees = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(task.id).map(r => r.user_id)
  const subs = taskType === 'mae'
    ? db.prepare('SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY subtask_position, id').all(task.id)
    : []

  const tx = db.transaction(() => {
    // Cria o template com is_recurring=0 (biblioteca — sem cron)
    const r = db.prepare(`
      INSERT INTO task_templates (
        name, is_active, is_recurring, task_type, client_id, category_id, department_id,
        title, description, priority,
        drive_link, drive_link_raw, approval_link, approval_files, approval_text,
        publish_date, publish_objective,
        due_date_offset_days, recurrence_type, recurrence_day, recurrence_hour,
        next_run_at, created_by, mode, sequential_subtasks
      ) VALUES (?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'monthly', 1, 6, NULL, ?, 'on_complete', ?)
    `).run(
      templateName, taskType, task.client_id,
      task.category_id || null, task.department_id || null,
      task.title, task.description || null, task.priority || 'normal',
      task.drive_link || null, task.drive_link_raw || null,
      task.approval_link || null, task.approval_files || null, task.approval_text || null,
      task.publish_date || null, task.publish_objective || null,
      7, req.user.id, task.sequential_subtasks ? 1 : 0
    )
    const tplId = r.lastInsertRowid
    const insertRootAssignee = db.prepare('INSERT OR IGNORE INTO task_template_assignees (template_id, user_id) VALUES (?, ?)')
    rootAssignees.forEach(uid => insertRootAssignee.run(tplId, uid))

    if (taskType === 'mae' && subs.length > 0) {
      const insertSub = db.prepare(`
        INSERT INTO task_template_subtasks (
          template_id, subtask_position, title, description, priority,
          category_id, department_id, due_date_offset_days,
          drive_link, drive_link_raw, approval_link, approval_files, approval_text,
          publish_date, publish_objective
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertSubAssignee = db.prepare('INSERT OR IGNORE INTO task_template_subtask_assignees (template_subtask_id, user_id) VALUES (?, ?)')
      subs.forEach((s, idx) => {
        const sr = insertSub.run(
          tplId, s.subtask_position != null ? s.subtask_position : idx + 1,
          s.title, s.description || null, s.priority || 'normal',
          s.category_id || null, s.department_id || null, null,
          s.drive_link || null, s.drive_link_raw || null,
          s.approval_link || null, s.approval_files || null, s.approval_text || null,
          s.publish_date || null, s.publish_objective || null
        )
        const subTplId = sr.lastInsertRowid
        const subAssignees = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(s.id).map(rr => rr.user_id)
        subAssignees.forEach(uid => insertSubAssignee.run(subTplId, uid))
      })
    }
    return tplId
  })
  const tplId = tx()
  const created = db.prepare('SELECT * FROM task_templates WHERE id = ?').get(tplId)
  res.json({ template: created, subtasks_copied: subs.length })
})

// Convert a normal task INTO a mae — permite adicionar subtarefas depois
// Regras: task tem que ser 'normal' (ou sem type) E nao pode ser ela mesma uma subtarefa
router.post('/:id/convert-to-mae', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Tarefa nao encontrada' })
  if (task.parent_task_id) return res.status(400).json({ error: 'Nao da pra tornar uma subtarefa em mae — ela ja pertence a outra mae' })
  if (task.task_type && task.task_type !== 'normal') return res.status(400).json({ error: 'Tarefa ja e mae ou de tipo especial' })
  db.prepare("UPDATE tasks SET task_type = 'mae', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id)
  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)
  broadcastSSE(task.client_id, 'task:updated', updated)
  res.json({ task: updated })
})

// Create Editorial parent task with fixed subtasks (hardcoded workflow)
router.post('/editorial', requireRole('dono', 'gerente'), (req, res) => {
  const { client_id, month_label, num_posts, num_videos, due_date, category_id } = req.body
  if (!client_id || !month_label) return res.status(400).json({ error: 'client_id e month_label obrigatorios' })

  const client = db.prepare('SELECT name FROM clients WHERE id = ?').get(client_id)
  if (!client) return res.status(404).json({ error: 'Cliente nao encontrado' })

  // Find departments by name
  const socialDept = db.prepare("SELECT id FROM departments WHERE name LIKE '%Social%' AND is_active = 1").get()
  const socialId = socialDept?.id || null

  // Find Ivandro to auto-assign Briefing
  const ivandro = db.prepare("SELECT id FROM users WHERE name LIKE '%Ivandro%' AND is_active = 1").get()
  const ivandroId = ivandro?.id || null

  const parentTitle = `Linha Editorial ${month_label} - ${client.name}`
  const createTask = db.prepare(`
    INSERT INTO tasks (client_id, category_id, department_id, title, description, priority, due_date, created_by, stage, task_type, parent_task_id, subtask_position, num_posts, num_videos, subtask_kind, assigned_to)
    VALUES (?, ?, ?, ?, ?, 'normal', ?, ?, 'backlog', ?, ?, ?, ?, ?, ?, ?)
  `)
  const histStmt = db.prepare('INSERT INTO task_history (task_id, to_stage, user_id) VALUES (?, ?, ?)')
  const insertAssignee = db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)')

  const tx = db.transaction(() => {
    // Parent
    const parentResult = createTask.run(
      client_id, category_id || null, null, parentTitle,
      `Linha editorial com ${num_posts || 0} posts e ${num_videos || 0} videos`,
      due_date || null, req.user.id, 'mae_editorial', null, null,
      num_posts || 0, num_videos || 0, null, null
    )
    const parentId = parentResult.lastInsertRowid
    histStmt.run(parentId, 'backlog', req.user.id)

    // Initial subtasks — 2 iniciais + 3 finais (producao dinamica entre elas)
    // Positions: 1 briefing, 2 reuniao, 3-8 reservadas pras tarefas dinamicas, 9-11 finais
    const subs = [
      {
        title: 'Briefing (Ideias + Copies)',
        dept: socialId, pos: 1, kind: 'briefing',
        description: 'Criar um documento no Docs com Briefing completo do conteudo + Ideias/Referencias + Copy/roteiro de todos os conteudos e anexar para aprovacao.\n\nAo concluir, e obrigatorio informar a Data e Hora da Reuniao de Apresentacao.\n\nQuando concluir, criara automaticamente a tarefa de Criar Imagens (Design) em paralelo.',
        assigned: ivandroId,
      },
      {
        title: 'Reuniao Aprovacao Cliente (Briefing)',
        dept: socialId, pos: 2, kind: 'aprov_briefing',
        description: 'Apresentar Briefing, ideias e copys/roteiros para o cliente em reuniao e pedir aprovacao do mesmo.\n\nAo concluir, e obrigatorio informar a Data e Hora da Gravacao para criar a tarefa de Gravacao automaticamente.',
        assigned: null,
      },
      {
        title: 'Aprovacao Interna Final',
        dept: null, pos: 9, kind: 'aprov_interna_final',
        description: 'Revisao interna final de todo o material produzido antes de enviar pra aprovacao do cliente.',
        assigned: null,
      },
      {
        title: 'Aprovacao Cliente (Final)',
        dept: null, pos: 10, kind: 'aprov_cliente_final',
        description: 'Cliente aprova todo o material final produzido no mes.',
        assigned: null,
      },
      {
        title: 'Publicacao',
        dept: socialId, pos: 11, kind: 'publicacao',
        description: 'Confirmar que todas as pecas foram publicadas conforme cronograma.',
        assigned: null,
      },
    ]
    subs.forEach(s => {
      const r = createTask.run(
        client_id, category_id || null, s.dept,
        `${s.title} - ${parentTitle}`, s.description,
        due_date || null, req.user.id, 'normal', parentId, s.pos, null, null, s.kind, s.assigned
      )
      histStmt.run(r.lastInsertRowid, 'backlog', req.user.id)
      if (s.assigned) insertAssignee.run(r.lastInsertRowid, s.assigned)
    })

    return parentId
  })

  const parentId = tx()
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(parentId)
  broadcastSSE(task.client_id, 'task:created', task)
  res.json({ task, parent_id: parentId })
})

// Confirm recording date — creates Gravacao + Subir + Editar + Imagens subtasks
router.post('/:id/confirm-recording', requireRole('dono', 'gerente'), (req, res) => {
  const { recording_datetime, capture_user_id, edit_user_id, design_user_id } = req.body
  if (!recording_datetime) return res.status(400).json({ error: 'recording_datetime obrigatorio' })

  const parent = db.prepare('SELECT * FROM tasks WHERE id = ? AND task_type = ?').get(req.params.id, 'mae_editorial')
  if (!parent) return res.status(404).json({ error: 'Tarefa-mae editorial nao encontrada' })

  // Check if production tasks already exist
  const existing = db.prepare("SELECT id FROM tasks WHERE parent_task_id = ? AND subtask_kind IN ('gravacao', 'subir_arquivos', 'editar_video', 'criar_imagens')").get(parent.id)
  if (existing) return res.status(400).json({ error: 'Tarefas de producao ja foram criadas' })

  const captacaoDept = db.prepare("SELECT id FROM departments WHERE (name LIKE '%Capt%' OR name LIKE '%Video%' OR name LIKE '%Producao%') AND is_active = 1").get()
  const designDept = db.prepare("SELECT id FROM departments WHERE name LIKE '%Design%' AND is_active = 1").get()

  const recordingDate = recording_datetime.slice(0, 10)
  const insertTask = db.prepare(`
    INSERT INTO tasks (client_id, category_id, department_id, title, description, priority, due_date, created_by, stage, task_type, parent_task_id, subtask_position, subtask_kind, recording_datetime)
    VALUES (?, ?, ?, ?, ?, 'normal', ?, ?, 'backlog', 'normal', ?, ?, ?, ?)
  `)
  const histStmt = db.prepare('INSERT INTO task_history (task_id, to_stage, user_id) VALUES (?, ?, ?)')

  const tx = db.transaction(() => {
    // Update parent with recording datetime
    db.prepare("UPDATE tasks SET recording_datetime = ?, updated_at = datetime('now', '-3 hours') WHERE id = ?").run(recording_datetime, parent.id)

    const baseTitle = parent.title

    // 1. Gravacao (Captacao, due = recording date)
    const gravR = insertTask.run(parent.client_id, parent.category_id, captacaoDept?.id || null,
      `${baseTitle} - Gravacao`, `Gravar conteudo em ${recordingDate}`,
      recordingDate, req.user.id, parent.id, 3, 'gravacao', recording_datetime)
    histStmt.run(gravR.lastInsertRowid, 'backlog', req.user.id)
    if (capture_user_id) {
      db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(gravR.lastInsertRowid, capture_user_id)
      db.prepare('UPDATE tasks SET assigned_to = ? WHERE id = ?').run(capture_user_id, gravR.lastInsertRowid)
    }

    // 4. Criar Imagens (Design, em paralelo)
    const imgR = insertTask.run(parent.client_id, parent.category_id, designDept?.id || null,
      `${baseTitle} - Criar Imagens`, `Criar ${parent.num_posts || 0} imagens para os posts`,
      parent.due_date || null, req.user.id, parent.id, 6, 'criar_imagens', null)
    histStmt.run(imgR.lastInsertRowid, 'backlog', req.user.id)
    if (design_user_id) {
      db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(imgR.lastInsertRowid, design_user_id)
      db.prepare('UPDATE tasks SET assigned_to = ? WHERE id = ?').run(imgR.lastInsertRowid, design_user_id)
    }

    // Store edit_user_id for later (when Subir Arquivos creates Editar Video)
    if (edit_user_id) {
      db.prepare("UPDATE tasks SET briefing_content = ? WHERE id = ?").run(JSON.stringify({ edit_user_id }), parent.id)
    }

    return { gravacaoId: gravR.lastInsertRowid, imagensId: imgR.lastInsertRowid }
  })

  const result = tx()
  // Notifications
  if (capture_user_id) notify(capture_user_id, 'task_assigned', 'Nova tarefa de gravacao', `"${parent.title} - Gravacao" em ${recordingDate}`, result.gravacaoId, req.user.id)
  if (design_user_id) notify(design_user_id, 'task_assigned', 'Nova tarefa de imagens', `"${parent.title} - Criar Imagens"`, result.imagensId, req.user.id)
  broadcastSSE(parent.client_id, 'task:created', { parent_id: parent.id })

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(parent.id)
  res.json({ task: updated, ...result })
})

// Get task detail
router.get('/:id', (req, res) => {
  const task = db.prepare(`
    SELECT t.*, c.name as client_name, d.name as department_name, d.color as department_color,
      cat.name as category_name, cat.color as category_color,
      (SELECT GROUP_CONCAT(u2.name, ', ') FROM task_assignees ta2 JOIN users u2 ON ta2.user_id = u2.id WHERE ta2.task_id = t.id) as assigned_name,
      creator.name as created_by_name, ps.name as stage_name, ps.color as stage_color
    FROM tasks t LEFT JOIN clients c ON t.client_id = c.id LEFT JOIN departments d ON t.department_id = d.id
    LEFT JOIN task_categories cat ON t.category_id = cat.id
    LEFT JOIN users creator ON t.created_by = creator.id LEFT JOIN pipeline_stages ps ON t.stage = ps.slug
    WHERE t.id = ?
  `).get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Tarefa nao encontrada' })
  task.assignees = getAssignees(task.id)
  if (req.user.role === 'cliente' && task.client_id !== req.user.client_id) return res.status(403).json({ error: 'Forbidden' })

  // Subtasks (children) — full data for inline display
  task.subtasks = db.prepare(`
    SELECT t.*, ps.name as stage_name, ps.color as stage_color, d.name as department_name, d.color as department_color,
      (SELECT GROUP_CONCAT(u2.name, ', ') FROM task_assignees ta2 JOIN users u2 ON ta2.user_id = u2.id WHERE ta2.task_id = t.id) as assigned_name,
      (SELECT COUNT(*) FROM task_comments WHERE task_id = t.id) as comment_count
    FROM tasks t
    LEFT JOIN pipeline_stages ps ON t.stage = ps.slug
    LEFT JOIN departments d ON t.department_id = d.id
    WHERE t.parent_task_id = ? AND t.is_active = 1
    ORDER BY t.subtask_position
  `).all(task.id)
  for (const sub of task.subtasks) sub.assignees = getAssignees(sub.id)

  // Parent (if this is a subtask) — full data
  if (task.parent_task_id) {
    task.parent = db.prepare(`
      SELECT t.*, c.name as client_name, ps.name as stage_name, ps.color as stage_color,
        (SELECT GROUP_CONCAT(u2.name, ', ') FROM task_assignees ta2 JOIN users u2 ON ta2.user_id = u2.id WHERE ta2.task_id = t.id) as assigned_name
      FROM tasks t
      LEFT JOIN clients c ON t.client_id = c.id
      LEFT JOIN pipeline_stages ps ON t.stage = ps.slug
      WHERE t.id = ?
    `).get(task.parent_task_id)
    if (task.parent) {
      // Irmas com dados completos (description, drive, approval) pra expansao inline no TaskDetail
      task.parent.subtasks = db.prepare(`
        SELECT t.id, t.title, t.stage, t.subtask_position, t.description,
          t.drive_link, t.drive_link_raw, t.approval_link, t.approval_files, t.approval_text,
          t.publish_date, t.publish_objective, t.due_date, t.priority,
          ps.name as stage_name, ps.color as stage_color,
          (SELECT GROUP_CONCAT(u2.name, ', ') FROM task_assignees ta2 JOIN users u2 ON ta2.user_id = u2.id WHERE ta2.task_id = t.id) as assigned_name
        FROM tasks t LEFT JOIN pipeline_stages ps ON t.stage = ps.slug
        WHERE t.parent_task_id = ? AND t.is_active = 1 ORDER BY t.subtask_position
      `).all(task.parent_task_id)
      // Anexos da mae — pra o card mostrar sem precisar navegar
      // Schema real: task_attachments tem (id, task_id, url, filename, type, uploaded_by, created_at)
      task.parent.attachments = db.prepare(`
        SELECT ta.id, ta.filename, ta.url, ta.type, ta.created_at,
          u.name as uploaded_by_name
        FROM task_attachments ta LEFT JOIN users u ON ta.uploaded_by = u.id
        WHERE ta.task_id = ? ORDER BY ta.created_at DESC
      `).all(task.parent_task_id)
    }
  }

  // Comments (filter internal for clients)
  const commentWhere = req.user.role === 'cliente' ? 'AND tc.is_internal = 0' : ''
  const comments = db.prepare(`SELECT tc.*, u.name as user_name, u.role as user_role FROM task_comments tc LEFT JOIN users u ON tc.user_id = u.id WHERE tc.task_id = ? ${commentWhere} ORDER BY tc.created_at`).all(task.id)
  const history = db.prepare(`SELECT th.*, u.name as user_name, ps_from.name as from_stage_name, ps_to.name as to_stage_name
    FROM task_history th LEFT JOIN users u ON th.user_id = u.id
    LEFT JOIN pipeline_stages ps_from ON th.from_stage = ps_from.slug LEFT JOIN pipeline_stages ps_to ON th.to_stage = ps_to.slug
    WHERE th.task_id = ? ORDER BY th.created_at DESC`).all(task.id)
  const attachments = db.prepare('SELECT ta.*, u.name as uploaded_by_name FROM task_attachments ta LEFT JOIN users u ON ta.uploaded_by = u.id WHERE ta.task_id = ? ORDER BY ta.created_at DESC').all(task.id)

  const timeEntries = db.prepare('SELECT te.*, u.name as user_name FROM time_entries te LEFT JOIN users u ON te.user_id = u.id WHERE te.task_id = ? ORDER BY te.created_at DESC').all(task.id)
  let totalTimeSeconds = timeEntries.reduce((sum, e) => sum + (e.duration_seconds || 0), 0)
  const activeTimer = db.prepare('SELECT * FROM time_entries WHERE task_id = ? AND ended_at IS NULL').get(task.id)

  // For mother tasks, aggregate time from all subtasks
  if (task.task_type && task.task_type !== 'normal' && task.subtasks?.length) {
    const subtaskIds = task.subtasks.map(s => s.id)
    const subtaskTotal = db.prepare(`
      SELECT COALESCE(SUM(duration_seconds), 0) as total
      FROM time_entries WHERE task_id IN (${subtaskIds.map(() => '?').join(',')})
    `).get(...subtaskIds).total
    totalTimeSeconds += subtaskTotal
    // Annotate each subtask with its own total time for display
    const subTotalStmt = db.prepare('SELECT COALESCE(SUM(duration_seconds), 0) as total FROM time_entries WHERE task_id = ?')
    for (const sub of task.subtasks) {
      sub.total_time_seconds = subTotalStmt.get(sub.id).total
    }
  }

  // Checklist da tarefa (bloqueia conclusao se algum nao done)
  const checklist = db.prepare('SELECT id, position, text, done, done_at FROM task_checklist_items WHERE task_id = ? ORDER BY position, id').all(task.id)

  res.json({ task, comments, history, attachments, timeEntries, totalTimeSeconds, activeTimer, checklist })
})

// ============ CHECKLIST ============
// GET /:id/checklist
router.get('/:id/checklist', (req, res) => {
  const task = db.prepare('SELECT id, client_id FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Tarefa nao encontrada' })
  if (req.user.role === 'cliente' && task.client_id !== req.user.client_id) return res.status(403).json({ error: 'Forbidden' })
  const items = db.prepare('SELECT id, position, text, done, done_at FROM task_checklist_items WHERE task_id = ? ORDER BY position, id').all(task.id)
  res.json({ checklist: items })
})

// POST /:id/checklist — add item
router.post('/:id/checklist', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Tarefa nao encontrada' })
  const text = (req.body?.text || '').trim()
  if (!text) return res.status(400).json({ error: 'text obrigatorio' })
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), 0) as m FROM task_checklist_items WHERE task_id = ?').get(task.id).m
  const r = db.prepare('INSERT INTO task_checklist_items (task_id, position, text) VALUES (?, ?, ?)').run(task.id, maxPos + 1, text)
  const item = db.prepare('SELECT id, position, text, done, done_at FROM task_checklist_items WHERE id = ?').get(r.lastInsertRowid)
  res.json({ item })
})

// PUT /checklist/:itemId — toggle done ou editar text
router.put('/checklist/:itemId', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  const item = db.prepare('SELECT * FROM task_checklist_items WHERE id = ?').get(req.params.itemId)
  if (!item) return res.status(404).json({ error: 'Item nao encontrado' })
  const sets = [], params = []
  if (req.body.text !== undefined) { sets.push('text = ?'); params.push(String(req.body.text).trim()) }
  if (req.body.done !== undefined) {
    const done = req.body.done ? 1 : 0
    sets.push('done = ?'); params.push(done)
    sets.push('done_at = ?'); params.push(done ? new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ') : null)
  }
  if (req.body.position !== undefined) { sets.push('position = ?'); params.push(parseInt(req.body.position) || 0) }
  if (sets.length === 0) return res.status(400).json({ error: 'Nada pra atualizar' })
  params.push(req.params.itemId)
  db.prepare(`UPDATE task_checklist_items SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  const updated = db.prepare('SELECT id, position, text, done, done_at FROM task_checklist_items WHERE id = ?').get(req.params.itemId)
  res.json({ item: updated })
})

// DELETE /checklist/:itemId
router.delete('/checklist/:itemId', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  db.prepare('DELETE FROM task_checklist_items WHERE id = ?').run(req.params.itemId)
  res.json({ ok: true })
})

// Update task
router.put('/:id', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Tarefa nao encontrada' })
  // Funcionario can edit if they are one of the assignees
  if (req.user.role === 'funcionario') {
    const isAssignee = db.prepare('SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ?').get(task.id, req.user.id)
    if (!isAssignee && task.assigned_to !== req.user.id) return res.status(403).json({ error: 'Sem permissao' })
  }

  const { title, description, due_date, priority, department_id, assigned_to, drive_link, drive_link_raw, category_id, approval_link, approval_text, approval_files, publish_date, publish_objective, meeting_datetime, recording_datetime, client_id, sequential_subtasks } = req.body
  const sets = []; const params = []
  // Trocar cliente: so dono/gerente. Funcionario nao pode.
  if (client_id !== undefined && (req.user.role === 'dono' || req.user.role === 'gerente')) {
    const newClient = db.prepare('SELECT id, name FROM clients WHERE id = ?').get(client_id)
    if (!newClient) return res.status(400).json({ error: 'Cliente nao encontrado' })
    if (newClient.id !== task.client_id) {
      const oldClient = db.prepare('SELECT name FROM clients WHERE id = ?').get(task.client_id)
      sets.push('client_id = ?'); params.push(newClient.id)
      db.prepare('INSERT INTO task_history (task_id, from_stage, to_stage, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(task.id, task.stage, task.stage, req.user.id, `Cliente: ${oldClient?.name || 'N/A'} → ${newClient.name}`)
    }
  }
  if (title !== undefined) { sets.push('title = ?'); params.push(title) }
  if (description !== undefined) { sets.push('description = ?'); params.push(description) }
  if (due_date !== undefined) { sets.push('due_date = ?'); params.push(due_date) }
  if (priority !== undefined) { sets.push('priority = ?'); params.push(priority) }
  if (department_id !== undefined) { sets.push('department_id = ?'); params.push(department_id) }
  if (drive_link !== undefined) { sets.push('drive_link = ?'); params.push(drive_link) }
  if (drive_link_raw !== undefined) { sets.push('drive_link_raw = ?'); params.push(drive_link_raw) }
  if (category_id !== undefined) { sets.push('category_id = ?'); params.push(category_id) }
  if (sequential_subtasks !== undefined) { sets.push('sequential_subtasks = ?'); params.push(sequential_subtasks ? 1 : 0) }
  // approval_files (array) — quando enviado, escreve JSON e sincroniza approval_link com o primeiro item
  if (approval_files !== undefined) {
    const filesArr = Array.isArray(approval_files) ? approval_files.filter(s => s && String(s).trim()) : []
    sets.push('approval_files = ?'); params.push(filesArr.length > 0 ? JSON.stringify(filesArr) : null)
    // Sincroniza approval_link com primeiro item (retrocompat) — so se nao foi enviado approval_link explicitamente
    if (approval_link === undefined) {
      sets.push('approval_link = ?'); params.push(filesArr.length > 0 ? filesArr[0] : null)
    }
  }
  if (approval_link !== undefined) { sets.push('approval_link = ?'); params.push(approval_link) }
  if (approval_text !== undefined) { sets.push('approval_text = ?'); params.push(approval_text) }
  if (publish_date !== undefined) { sets.push('publish_date = ?'); params.push(publish_date) }
  if (publish_objective !== undefined) { sets.push('publish_objective = ?'); params.push(publish_objective) }
  if (meeting_datetime !== undefined) { sets.push('meeting_datetime = ?'); params.push(meeting_datetime) }
  if (recording_datetime !== undefined) { sets.push('recording_datetime = ?'); params.push(recording_datetime) }

  // Handle multi-assignee
  if (assigned_to !== undefined) {
    const newIds = Array.isArray(assigned_to) ? assigned_to.filter(Boolean).map(Number) : (assigned_to ? [Number(assigned_to)] : [])
    const oldAssignees = getAssignees(task.id)
    const oldIds = oldAssignees.map(a => a.user_id)
    setAssignees(task.id, newIds)
    sets.push('assigned_to = ?'); params.push(newIds[0] || null)
    // Log history
    const oldNames = oldAssignees.map(a => a.name).join(', ') || 'Ninguem'
    const newNames = newIds.length ? db.prepare(`SELECT GROUP_CONCAT(name, ', ') as n FROM users WHERE id IN (${newIds.map(() => '?').join(',')})`).get(...newIds)?.n || 'Ninguem' : 'Ninguem'
    if (oldNames !== newNames) {
      db.prepare('INSERT INTO task_history (task_id, from_stage, to_stage, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(task.id, task.stage, task.stage, req.user.id, `Responsavel: ${oldNames} → ${newNames}`)
    }
    // Notify removed assignees
    oldIds.filter(uid => !newIds.includes(uid) && uid !== req.user.id).forEach(uid => notify(uid, 'task_reassigned', 'Tarefa reatribuida', `"${task.title}" foi reatribuida`, task.id, req.user.id))
    // Notify new assignees
    newIds.filter(uid => !oldIds.includes(uid) && uid !== req.user.id).forEach(uid => notify(uid, 'task_assigned', 'Nova tarefa atribuida', `"${task.title}" foi atribuida a voce`, task.id, req.user.id))
  }

  if (!sets.length) return res.status(400).json({ error: 'Nada pra atualizar' })
  sets.push("updated_at = datetime('now', '-3 hours')"); params.push(req.params.id)
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  broadcastSSE(updated.client_id, 'task:updated', updated)
  res.json({ task: updated })
})

// Move task stage
router.put('/:id/stage', (req, res) => {
  const { stage, comment } = req.body
  if (!stage) return res.status(400).json({ error: 'stage required' })
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Tarefa nao encontrada' })
  if (req.user.role === 'cliente' && task.client_id !== req.user.client_id) return res.status(403).json({ error: 'Forbidden' })

  if (!canTransition(req.user.role, task.stage, stage)) {
    return res.status(403).json({ error: `Transicao ${task.stage} → ${stage} nao permitida para ${req.user.role}` })
  }

  // Require approval_link for approval stages
  if ((stage === 'aprovacao_interna' || stage === 'aguardando_cliente') && !task.approval_link) {
    return res.status(400).json({ error: 'Preencha o conteudo de aprovacao (link + texto) antes de enviar pra aprovacao' })
  }

  // Checklist: se tem items e algum nao esta done, bloqueia conclusao
  if (stage === 'concluido') {
    const pending = db.prepare('SELECT COUNT(*) as n FROM task_checklist_items WHERE task_id = ? AND done = 0').get(task.id).n
    if (pending > 0) {
      const total = db.prepare('SELECT COUNT(*) as n FROM task_checklist_items WHERE task_id = ?').get(task.id).n
      return res.status(400).json({ error: `Checklist tem ${pending} item(s) pendente(s) de ${total}. Marca todos antes de concluir.` })
    }
  }

  // Editorial workflow: Briefing -> concluido requires meeting_datetime
  if (stage === 'concluido' && task.subtask_kind === 'briefing' && !task.meeting_datetime) {
    return res.status(400).json({ error: 'Preencha a Data e Hora da Reuniao de Apresentacao antes de concluir o Briefing.' })
  }
  // Editorial workflow: Reuniao Aprovacao Cliente Briefing -> concluido requires recording_datetime
  if (stage === 'concluido' && task.subtask_kind === 'aprov_briefing' && !task.recording_datetime) {
    return res.status(400).json({ error: 'Preencha a Data e Hora da Gravacao antes de concluir esta etapa.' })
  }

  // Regra: tarefa MAE nao pode ser concluida manualmente enquanto tem subtarefas ativas em aberto.
  // Ela so fecha via auto-close (quando a ultima sub termina). Vale sempre pra maes, nao depende
  // de sequential_subtasks.
  if (stage === 'concluido' && !task.parent_task_id && (task.task_type === 'mae' || task.task_type === 'mae_editorial')) {
    const abertas = db.prepare(`
      SELECT COUNT(*) as c FROM tasks
      WHERE parent_task_id = ? AND is_active = 1 AND stage != 'concluido' AND stage != 'rejeitado'
    `).get(task.id).c
    if (abertas > 0) {
      return res.status(400).json({
        error: `Esta tarefa mae ainda tem ${abertas} subtarefa(s) em aberto. Conclua ou rejeite cada uma antes de fechar a mae — ela fecha sozinha quando a ultima terminar.`,
      })
    }
  }

  // Sequential subtasks: se a mae tem sequential_subtasks=1, so pode concluir esta subtarefa
  // se todas com subtask_position < currentPos estiverem concluidas (ou rejeitadas).
  if (stage === 'concluido' && task.parent_task_id) {
    const mae = db.prepare('SELECT sequential_subtasks FROM tasks WHERE id = ?').get(task.parent_task_id)
    if (mae && mae.sequential_subtasks === 1) {
      const currentPos = task.subtask_position || 0
      const blocking = db.prepare(`
        SELECT id, title, subtask_position
        FROM tasks
        WHERE parent_task_id = ? AND is_active = 1
          AND (subtask_position || 0) < ?
          AND stage != 'concluido' AND stage != 'rejeitado'
        ORDER BY subtask_position LIMIT 1
      `).get(task.parent_task_id, currentPos)
      if (blocking) {
        return res.status(400).json({
          error: `Nao pode concluir agora. A subtarefa "${blocking.title}" (posicao ${blocking.subtask_position}) precisa ser concluida antes desta.`,
          blocked_by: { id: blocking.id, title: blocking.title, subtask_position: blocking.subtask_position },
        })
      }
    }
  }

  db.prepare("UPDATE tasks SET stage = ?, updated_at = datetime('now', '-3 hours') WHERE id = ?").run(stage, task.id)
  // Limpa changes_requested quando reenvia pra aprovacao
  if (stage === 'aprovacao_interna' || stage === 'aguardando_cliente') {
    db.prepare("UPDATE tasks SET changes_requested = NULL WHERE id = ?").run(task.id)
  }
  db.prepare('INSERT INTO task_history (task_id, from_stage, to_stage, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(task.id, task.stage, stage, req.user.id, comment || null)

  // Auto-start timer when entering em_producao
  if (stage === 'em_producao') {
    const activeTimer = db.prepare('SELECT id FROM time_entries WHERE task_id = ? AND ended_at IS NULL').get(task.id)
    if (!activeTimer) {
      db.prepare("INSERT INTO time_entries (task_id, user_id, started_at) VALUES (?, ?, datetime('now', '-3 hours'))").run(task.id, req.user.id)
    }
  }
  // Auto-stop timer when leaving em_producao
  if (task.stage === 'em_producao' && stage !== 'em_producao') {
    const activeTimer = db.prepare('SELECT * FROM time_entries WHERE task_id = ? AND ended_at IS NULL').get(task.id)
    if (activeTimer) {
      const duration = Math.max(0, Math.floor((Date.now() - new Date(activeTimer.started_at + '-03:00').getTime()) / 1000))
      db.prepare("UPDATE time_entries SET ended_at = datetime('now', '-3 hours'), duration_seconds = ? WHERE id = ?").run(duration, activeTimer.id)
    }
  }

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)
  broadcastSSE(updated.client_id, 'task:stage_changed', updated)
  // Stage-specific notifications
  if (stage === 'revisao_interna' || stage === 'aprovacao_interna') {
    notifyMany(getDonoUsers().map(d => d.id), 'task_submitted_review', stage === 'revisao_interna' ? 'Tarefa em revisao' : 'Aguardando aprovacao', `"${updated.title}"`, updated.id, req.user.id)
  }
  if (stage === 'aguardando_cliente') {
    notifyMany(getClientUsers(updated.client_id).map(u => u.id), 'task_ready_for_approval', 'Tarefa pronta pra aprovar', `"${updated.title}" aguarda sua aprovacao`, updated.id, req.user.id)
  }
  if (stage === 'concluido') {
    getAssignees(updated.id).filter(a => a.user_id !== req.user.id).forEach(a => notify(a.user_id, 'task_completed', 'Tarefa concluida', `"${updated.title}"`, updated.id, req.user.id))
    notifyMany(getClientUsers(updated.client_id).map(u => u.id), 'task_completed', 'Tarefa concluida', `"${updated.title}"`, updated.id, req.user.id)
  }

  // ===== Recorrencia: se task de template mode=on_complete concluiu, dispara proxima instancia =====
  // So dispara pra task raiz (parent_task_id NULL) — subtarefas nao geram recorrencia propria.
  // Fire-and-forget: erro nao quebra resposta ao usuario, so loga.
  if (stage === 'concluido' && updated.template_id && !updated.parent_task_id) {
    try {
      const tpl = db.prepare('SELECT mode, is_active FROM task_templates WHERE id = ?').get(updated.template_id)
      if (tpl && tpl.is_active && tpl.mode === 'on_complete') {
        setImmediate(() => {
          try {
            const r = createTaskFromTemplate(updated.template_id, { userId: req.user.id })
            console.log(`[Recurring] on_complete: template=${updated.template_id} concluiu task=${updated.id}, criada proxima task=${r.taskId}`)
          } catch (e) {
            console.error(`[Recurring] on_complete: falha ao criar proxima do template=${updated.template_id}:`, e.message)
          }
        })
      }
    } catch (e) {
      console.error('[Recurring] on_complete lookup falhou:', e.message)
    }
  }

  // ===== Editorial workflow triggers (when subtask completes) =====
  if (stage === 'concluido' && updated.parent_task_id && updated.subtask_kind) {
    triggerEditorialWorkflow(updated, req.user.id)
  }

  // ===== Mae generica auto-close: quando todas as filhas de uma mae='mae' concluem =====
  if (stage === 'concluido' && updated.parent_task_id) {
    const maeParent = db.prepare("SELECT * FROM tasks WHERE id = ? AND task_type = 'mae'").get(updated.parent_task_id)
    if (maeParent && maeParent.stage !== 'concluido') {
      const status = db.prepare(`
        SELECT COUNT(*) as total,
          SUM(CASE WHEN stage = 'concluido' THEN 1 ELSE 0 END) as done
        FROM tasks WHERE parent_task_id = ? AND is_active = 1
      `).get(maeParent.id)
      if (status.total > 0 && status.total === status.done) {
        db.prepare("UPDATE tasks SET stage = 'concluido', updated_at = datetime('now', '-3 hours') WHERE id = ?").run(maeParent.id)
        db.prepare('INSERT INTO task_history (task_id, from_stage, to_stage, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(maeParent.id, maeParent.stage, 'concluido', req.user.id, 'Auto: todas as subtarefas concluidas')
        const updatedMae = db.prepare('SELECT * FROM tasks WHERE id = ?').get(maeParent.id)
        broadcastSSE(maeParent.client_id, 'task:stage_changed', updatedMae)

        // Recorrencia on_complete: se a mae fechada e' de template on_complete, dispara proxima.
        // Necessario aqui tambem porque este auto-close nao passa pelo hook do inicio do endpoint
        // (que so ve `updated`, nao a mae). Fire-and-forget.
        if (updatedMae.template_id) {
          try {
            const tpl = db.prepare('SELECT mode, is_active FROM task_templates WHERE id = ?').get(updatedMae.template_id)
            if (tpl && tpl.is_active && tpl.mode === 'on_complete') {
              setImmediate(() => {
                try {
                  const r = createTaskFromTemplate(updatedMae.template_id, { userId: req.user.id })
                  console.log(`[Recurring] on_complete (mae auto-close): template=${updatedMae.template_id} mae=${updatedMae.id}, criada proxima task=${r.taskId}`)
                } catch (e) {
                  console.error(`[Recurring] on_complete mae auto-close: falha template=${updatedMae.template_id}:`, e.message)
                }
              })
            }
          } catch (e) {
            console.error('[Recurring] on_complete mae lookup falhou:', e.message)
          }
        }
      }
    }
  }

  res.json({ task: updated })
})

// Editorial workflow trigger handler
function triggerEditorialWorkflow(completedTask, userId) {
  const parent = db.prepare('SELECT * FROM tasks WHERE id = ?').get(completedTask.parent_task_id)
  if (!parent || parent.task_type !== 'mae_editorial') return

  const insertTask = db.prepare(`
    INSERT INTO tasks (client_id, category_id, department_id, title, description, priority, due_date, created_by, stage, task_type, parent_task_id, subtask_position, subtask_kind, assigned_to, recording_datetime)
    VALUES (?, ?, ?, ?, ?, 'normal', ?, ?, 'backlog', 'normal', ?, ?, ?, ?, ?)
  `)
  const histStmt = db.prepare('INSERT INTO task_history (task_id, to_stage, user_id) VALUES (?, ?, ?)')
  const insertAssignee = db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)')

  // Helpers — buscar departamentos e usuarios fixos
  const findDept = (pattern) => db.prepare(`SELECT id FROM departments WHERE name LIKE ? AND is_active = 1`).get(pattern)?.id || null
  const findUser = (pattern) => db.prepare(`SELECT id FROM users WHERE name LIKE ? AND is_active = 1`).get(pattern)?.id || null
  const socialId = findDept('%Social%')
  const captacaoId = findDept('%Capt%') || findDept('%Video%') || findDept('%Producao%')
  const designId = findDept('%Design%')
  const edicaoId = findDept('%Ed%Vid%') || findDept('%Edit%')
  const ivandroId = findUser('%Ivandro%')
  const dalilaId = findUser('%Dalila%')
  const grazielleId = findUser('%Graziele%') || findUser('%Grazi%')

  const createSubtask = (opts) => {
    const exists = db.prepare("SELECT id FROM tasks WHERE parent_task_id = ? AND subtask_kind = ?").get(parent.id, opts.kind)
    if (exists) return null
    const r = insertTask.run(
      parent.client_id, parent.category_id, opts.dept || null,
      `${opts.title} - ${parent.title}`, opts.description || null,
      opts.due_date || null, userId, parent.id, opts.pos, opts.kind, opts.assigned || null, opts.recording_datetime || null
    )
    histStmt.run(r.lastInsertRowid, 'backlog', userId)
    if (opts.assigned) {
      insertAssignee.run(r.lastInsertRowid, opts.assigned)
      notify(opts.assigned, 'task_assigned', opts.notifyTitle || 'Nova tarefa atribuida', `"${opts.title} - ${parent.title}"`, r.lastInsertRowid, userId)
    }
    broadcastSSE(parent.client_id, 'task:created', { parent_id: parent.id })
    return r.lastInsertRowid
  }

  // === BRIEFING concluido ===
  if (completedTask.subtask_kind === 'briefing') {
    // Propaga meeting_datetime para a Reuniao
    if (completedTask.meeting_datetime) {
      const meetingDate = completedTask.meeting_datetime.slice(0, 10)
      db.prepare("UPDATE tasks SET due_date = ?, meeting_datetime = ?, updated_at = datetime('now', '-3 hours') WHERE parent_task_id = ? AND subtask_kind = 'aprov_briefing'")
        .run(meetingDate, completedTask.meeting_datetime, parent.id)
    }
    // Cria Criar Imagens (Dalila) em paralelo
    createSubtask({
      title: 'Criar Imagens', kind: 'criar_imagens', pos: 3, dept: designId,
      description: `Criar ${parent.num_posts || 0} imagens para os posts da linha editorial.\n\nQuando concluir, criara automaticamente a tarefa Programar Publicacao das Imagens.`,
      assigned: dalilaId,
      notifyTitle: 'Nova tarefa de criar imagens',
    })
  }

  // === CRIAR IMAGENS concluido -> Programar Publicacao Imagens ===
  if (completedTask.subtask_kind === 'criar_imagens') {
    createSubtask({
      title: 'Programar Publ Imagens', kind: 'prog_publ_imagens', pos: 4, dept: socialId,
      description: 'Programar a publicacao das imagens nas redes sociais conforme briefing aprovado.',
      assigned: grazielleId,
      notifyTitle: 'Programar publicacao de imagens',
    })
  }

  // === REUNIAO concluida -> cria Gravacao ===
  if (completedTask.subtask_kind === 'aprov_briefing' && completedTask.recording_datetime) {
    db.prepare("UPDATE tasks SET recording_datetime = ?, updated_at = datetime('now', '-3 hours') WHERE id = ?")
      .run(completedTask.recording_datetime, parent.id)
    const recordingDate = completedTask.recording_datetime.slice(0, 10)
    createSubtask({
      title: 'Gravacao', kind: 'gravacao', pos: 5, dept: captacaoId,
      description: `Gravar todo o conteudo do mes em ${recordingDate}.\n\nQuando concluir, criara automaticamente a tarefa Subir Arquivos.`,
      due_date: recordingDate,
      recording_datetime: completedTask.recording_datetime,
      assigned: ivandroId,
      notifyTitle: 'Nova tarefa de gravacao',
    })
  }

  // === GRAVACAO concluida -> Subir Arquivos (Ivandro) ===
  if (completedTask.subtask_kind === 'gravacao') {
    createSubtask({
      title: 'Subir Arquivos', kind: 'subir_arquivos', pos: 6, dept: captacaoId,
      description: 'Subir arquivos brutos da gravacao pro Drive para edicao.\n\nQuando concluir, criara automaticamente a tarefa Editar Videos.',
      assigned: ivandroId,
      notifyTitle: 'Subir arquivos da gravacao',
    })
  }

  // === SUBIR ARQUIVOS concluido -> Editar Videos (Ivandro) ===
  if (completedTask.subtask_kind === 'subir_arquivos') {
    createSubtask({
      title: 'Editar Videos', kind: 'editar_video', pos: 7, dept: edicaoId,
      description: `Editar ${parent.num_videos || 0} videos da linha editorial.\n\nQuando concluir, criara automaticamente a tarefa Programar Publicacao dos Videos.`,
      assigned: ivandroId,
      notifyTitle: 'Editar videos',
    })
  }

  // === EDITAR VIDEOS concluido -> Programar Publ Videos (Grazielle) ===
  if (completedTask.subtask_kind === 'editar_video') {
    createSubtask({
      title: 'Programar Publ Videos', kind: 'prog_publ_videos', pos: 8, dept: socialId,
      description: 'Programar a publicacao dos videos nas redes sociais conforme briefing aprovado.',
      assigned: grazielleId,
      notifyTitle: 'Programar publicacao de videos',
    })
  }

  // === Quando TODAS as subtarefas conhecidas estiverem concluidas, mae vai pra concluido ===
  const allKinds = ['briefing', 'aprov_briefing', 'criar_imagens', 'prog_publ_imagens', 'gravacao', 'subir_arquivos', 'editar_video', 'prog_publ_videos', 'aprov_interna_final', 'aprov_cliente_final', 'publicacao']
  const status = db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN stage = 'concluido' THEN 1 ELSE 0 END) as done
    FROM tasks WHERE parent_task_id = ? AND is_active = 1 AND subtask_kind IN (${allKinds.map(() => '?').join(',')})
  `).get(parent.id, ...allKinds)

  if (status.total > 0 && status.total === status.done && parent.stage !== 'concluido') {
    db.prepare("UPDATE tasks SET stage = 'concluido', updated_at = datetime('now', '-3 hours') WHERE id = ?").run(parent.id)
    db.prepare('INSERT INTO task_history (task_id, from_stage, to_stage, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(parent.id, parent.stage, 'concluido', userId, 'Auto: todas as etapas concluidas')
    notifyMany(getDonoUsers().map(d => d.id), 'task_completed', 'Linha editorial concluida', `"${parent.title}"`, parent.id, userId)
    const updatedParent = db.prepare('SELECT * FROM tasks WHERE id = ?').get(parent.id)
    broadcastSSE(parent.client_id, 'task:stage_changed', updatedParent)
  }
}

// Add comment
router.post('/:id/comments', (req, res) => {
  const { content, is_internal } = req.body
  if (!content) return res.status(400).json({ error: 'content required' })
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Tarefa nao encontrada' })
  // Clients can't post internal comments
  const internal = req.user.role === 'cliente' ? 0 : (is_internal ? 1 : 0)
  const result = db.prepare('INSERT INTO task_comments (task_id, user_id, content, is_internal) VALUES (?, ?, ?, ?)').run(task.id, req.user.id, content, internal)
  const comment = db.prepare('SELECT tc.*, u.name as user_name, u.role as user_role FROM task_comments tc LEFT JOIN users u ON tc.user_id = u.id WHERE tc.id = ?').get(result.lastInsertRowid)
  broadcastSSE(task.client_id, 'task:comment', { taskId: task.id, comment })
  // Notify all assignees
  const assignees = getAssignees(task.id)
  assignees.filter(a => a.user_id !== req.user.id).forEach(a => notify(a.user_id, 'comment_added', 'Novo comentario', `Em "${task.title}"`, task.id, req.user.id))
  // Notify creator
  if (task.created_by && task.created_by !== req.user.id && !assignees.find(a => a.user_id === task.created_by)) notify(task.created_by, 'comment_added', 'Novo comentario', `Em "${task.title}"`, task.id, req.user.id)
  // Non-internal → notify client users
  if (!internal) notifyMany(getClientUsers(task.client_id).map(u => u.id).filter(uid => uid !== req.user.id), 'comment_added', 'Novo comentario', `Em "${task.title}"`, task.id, req.user.id)
  res.json({ comment })
})

// Add attachment
router.post('/:id/attachments', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  const { url, filename, type } = req.body
  if (!url || !filename) return res.status(400).json({ error: 'url e filename obrigatorios' })
  const task = db.prepare('SELECT stage FROM tasks WHERE id = ?').get(req.params.id)
  const result = db.prepare('INSERT INTO task_attachments (task_id, url, filename, type, uploaded_by) VALUES (?, ?, ?, ?, ?)').run(req.params.id, url, filename, type || 'file', req.user.id)
  db.prepare('INSERT INTO task_history (task_id, from_stage, to_stage, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(req.params.id, task?.stage, task?.stage, req.user.id, `Anexo adicionado: ${filename}`)
  res.json({ attachment: db.prepare('SELECT * FROM task_attachments WHERE id = ?').get(result.lastInsertRowid) })
})

// Delete attachment
router.delete('/:id/attachments/:attId', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  const att = db.prepare('SELECT * FROM task_attachments WHERE id = ? AND task_id = ?').get(req.params.attId, req.params.id)
  if (!att) return res.status(404).json({ error: 'Anexo nao encontrado' })
  const task = db.prepare('SELECT stage FROM tasks WHERE id = ?').get(req.params.id)
  db.prepare('DELETE FROM task_attachments WHERE id = ?').run(req.params.attId)
  db.prepare('INSERT INTO task_history (task_id, from_stage, to_stage, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(req.params.id, task?.stage, task?.stage, req.user.id, `Anexo removido: ${att.filename}`)
  res.json({ ok: true })
})

// Pipeline stages list
router.get('/stages/list', (req, res) => {
  res.json({ stages: db.prepare('SELECT * FROM pipeline_stages ORDER BY position').all() })
})

// Time entries
router.get('/:id/time', (req, res) => {
  const entries = db.prepare('SELECT te.*, u.name as user_name FROM time_entries te LEFT JOIN users u ON te.user_id = u.id WHERE te.task_id = ? ORDER BY te.created_at DESC').all(req.params.id)
  const totalSeconds = entries.reduce((sum, e) => sum + (e.duration_seconds || 0), 0)
  res.json({ entries, totalSeconds })
})

router.post('/:id/time/start', (req, res) => {
  // Check if there's an active timer
  const active = db.prepare('SELECT id FROM time_entries WHERE task_id = ? AND user_id = ? AND ended_at IS NULL').get(req.params.id, req.user.id)
  if (active) return res.status(400).json({ error: 'Timer ja ativo' })
  const result = db.prepare("INSERT INTO time_entries (task_id, user_id, started_at) VALUES (?, ?, datetime('now', '-3 hours'))").run(req.params.id, req.user.id)
  res.json({ entry: db.prepare('SELECT * FROM time_entries WHERE id = ?').get(result.lastInsertRowid) })
})

router.post('/:id/time/stop', (req, res) => {
  const active = db.prepare('SELECT * FROM time_entries WHERE task_id = ? AND user_id = ? AND ended_at IS NULL').get(req.params.id, req.user.id)
  if (!active) return res.status(400).json({ error: 'Nenhum timer ativo' })
  const duration = Math.floor((Date.now() - new Date(active.started_at + '-03:00').getTime()) / 1000)
  db.prepare("UPDATE time_entries SET ended_at = datetime('now', '-3 hours'), duration_seconds = ?, description = ? WHERE id = ?").run(Math.max(0, duration), req.body.description || null, active.id)
  res.json({ entry: db.prepare('SELECT * FROM time_entries WHERE id = ?').get(active.id) })
})

// Bulk operations
router.post('/bulk/stage', requireRole('dono', 'gerente'), (req, res) => {
  const { task_ids, stage } = req.body
  if (!task_ids?.length || !stage) return res.status(400).json({ error: 'task_ids and stage required' })
  const stmtUpdate = db.prepare("UPDATE tasks SET stage = ?, updated_at = datetime('now', '-3 hours') WHERE id = ?")
  const stmtHistory = db.prepare('INSERT INTO task_history (task_id, from_stage, to_stage, user_id) VALUES (?, (SELECT stage FROM tasks WHERE id = ?), ?, ?)')
  const transaction = db.transaction(() => { for (const id of task_ids) { stmtHistory.run(id, id, stage, req.user.id); stmtUpdate.run(stage, id) } })
  transaction()
  res.json({ ok: true, count: task_ids.length })
})

router.post('/bulk/assign', requireRole('dono', 'gerente'), (req, res) => {
  const { task_ids, assigned_to } = req.body
  if (!task_ids?.length) return res.status(400).json({ error: 'task_ids required' })
  const stmt = db.prepare("UPDATE tasks SET assigned_to = ?, updated_at = datetime('now', '-3 hours') WHERE id = ?")
  const transaction = db.transaction(() => { for (const id of task_ids) stmt.run(assigned_to || null, id) })
  transaction()
  res.json({ ok: true, count: task_ids.length })
})

// CSV export
router.get('/export', requireRole('dono', 'gerente'), (req, res) => {
  const { client_id, stage, department_id, date_from, date_to, date_field = 'created' } = req.query
  const where = ['t.is_active = 1']; const params = []
  if (client_id) { where.push('t.client_id = ?'); params.push(client_id) }
  if (stage) { where.push('t.stage = ?'); params.push(stage) }
  if (department_id) { where.push('t.department_id = ?'); params.push(department_id) }
  if (date_field === 'due') {
    if (date_from) { where.push("date(t.due_date) >= date(?)"); params.push(date_from) }
    if (date_to) { where.push("date(t.due_date) <= date(?)"); params.push(date_to) }
  } else if (date_field === 'completed') {
    if (date_from || date_to) {
      const conds = ["th.task_id = t.id", "th.to_stage = 'concluido'"]
      const p2 = []
      if (date_from) { conds.push("date(th.created_at, '-3 hours') >= date(?)"); p2.push(date_from) }
      if (date_to) { conds.push("date(th.created_at, '-3 hours') <= date(?)"); p2.push(date_to) }
      where.push(`EXISTS (SELECT 1 FROM task_history th WHERE ${conds.join(' AND ')})`)
      params.push(...p2)
    }
  } else {
    if (date_from) { where.push('t.created_at >= ?'); params.push(date_from) }
    if (date_to) { where.push('t.created_at <= ?'); params.push(date_to + ' 23:59:59') }
  }

  const tasks = db.prepare(`
    SELECT t.title, c.name as cliente, ps.name as etapa, d.name as departamento, u.name as responsavel,
      cat.name as categoria, t.priority as prioridade, t.due_date as prazo, t.created_at as criado, t.updated_at as atualizado
    FROM tasks t LEFT JOIN clients c ON t.client_id = c.id LEFT JOIN pipeline_stages ps ON t.stage = ps.slug
    LEFT JOIN departments d ON t.department_id = d.id LEFT JOIN users u ON t.assigned_to = u.id
    LEFT JOIN task_categories cat ON t.category_id = cat.id
    WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC
  `).all(...params)

  const header = 'Titulo,Cliente,Etapa,Departamento,Responsavel,Categoria,Prioridade,Prazo,Criado,Atualizado'
  const rows = tasks.map(t => [t.title, t.cliente, t.etapa, t.departamento, t.responsavel, t.categoria, t.prioridade, t.prazo, t.criado, t.atualizado].map(v => `"${(v || '').replace(/"/g, '""')}"`).join(','))
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename=tarefas-${new Date().toISOString().slice(0, 10)}.csv`)
  res.send('\uFEFF' + [header, ...rows].join('\n'))
})

export default router
