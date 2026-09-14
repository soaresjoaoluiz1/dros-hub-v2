import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { broadcastSSE } from '../sse.js'
import { notify, notifyMany, getDonoUsers, getClientUsers } from '../notifications.js'

const router = Router()

// Internal approval queue (dono)
router.get('/internal', requireRole('dono', 'gerente'), (req, res) => {
  const tasks = db.prepare(`
    SELECT t.*, c.name as client_name, d.name as department_name, u.name as assigned_name,
      cat.name as category_name, ps.name as stage_name, ps.color as stage_color
    FROM tasks t LEFT JOIN clients c ON t.client_id = c.id LEFT JOIN departments d ON t.department_id = d.id
    LEFT JOIN users u ON t.assigned_to = u.id LEFT JOIN task_categories cat ON t.category_id = cat.id
    LEFT JOIN pipeline_stages ps ON t.stage = ps.slug
    WHERE t.stage = 'aprovacao_interna' AND t.is_active = 1
    ORDER BY t.due_date ASC, t.updated_at ASC
  `).all()
  res.json({ tasks })
})

// Client approval queue
router.get('/client', (req, res) => {
  let sql = `
    SELECT t.*, c.name as client_name, d.name as department_name, d.color as department_color,
      u.name as assigned_name, cat.name as category_name, ps.name as stage_name, ps.color as stage_color
    FROM tasks t LEFT JOIN clients c ON t.client_id = c.id LEFT JOIN departments d ON t.department_id = d.id
    LEFT JOIN users u ON t.assigned_to = u.id LEFT JOIN task_categories cat ON t.category_id = cat.id
    LEFT JOIN pipeline_stages ps ON t.stage = ps.slug
    WHERE t.stage = 'aguardando_cliente' AND t.is_active = 1`
  const params = []

  if (req.user.role === 'cliente') {
    sql += ' AND t.client_id = ?'; params.push(req.user.client_id)
  } else if (req.query.client_id) {
    sql += ' AND t.client_id = ?'; params.push(req.query.client_id)
  }
  sql += ' ORDER BY t.due_date ASC, t.updated_at ASC'

  const tasks = db.prepare(sql).all(...params)
  res.json({ tasks })
})

// Approve task
router.post('/:id/approve', (req, res) => {
  const { comment } = req.body
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Tarefa nao encontrada' })

  let newStage
  if ((req.user.role === 'dono' || req.user.role === 'gerente') && task.stage === 'aprovacao_interna') {
    newStage = 'aguardando_cliente'
  } else if (req.user.role === 'cliente' && task.stage === 'aguardando_cliente' && task.client_id === req.user.client_id) {
    newStage = 'programar_publicacao'
  } else {
    return res.status(403).json({ error: 'Nao pode aprovar neste estado' })
  }

  db.prepare("UPDATE tasks SET stage = ?, updated_at = datetime('now', '-3 hours') WHERE id = ?").run(newStage, task.id)
  db.prepare('INSERT INTO task_history (task_id, from_stage, to_stage, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(task.id, task.stage, newStage, req.user.id, comment || 'Aprovado')
  if (comment) db.prepare('INSERT INTO task_comments (task_id, user_id, content, is_internal) VALUES (?, ?, ?, 0)').run(task.id, req.user.id, comment)

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)
  broadcastSSE(updated.client_id, 'task:stage_changed', updated)
  // Notify on approval
  if (task.assigned_to) notify(task.assigned_to, 'task_approved', 'Tarefa aprovada', `"${updated.title}"`, updated.id, req.user.id)
  if (newStage === 'aguardando_cliente') notifyMany(getClientUsers(updated.client_id).map(u => u.id), 'task_ready_for_approval', 'Tarefa pronta pra aprovar', `"${updated.title}"`, updated.id, req.user.id)
  if (newStage === 'programar_publicacao') notifyMany(getDonoUsers().map(d => d.id), 'task_approved', 'Cliente aprovou tarefa', `"${updated.title}"`, updated.id, req.user.id)
  res.json({ task: updated })
})

// Request changes (cliente specifies what needs to change)
router.post('/:id/request-changes', (req, res) => {
  const { comment } = req.body
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'Descreva o que precisa ser alterado' })
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Tarefa nao encontrada' })
  if (req.user.role !== 'cliente' || task.stage !== 'aguardando_cliente' || task.client_id !== req.user.client_id) {
    return res.status(403).json({ error: 'Nao pode solicitar alteracao neste estado' })
  }

  db.prepare("UPDATE tasks SET stage = 'revisao_interna', changes_requested = ?, updated_at = datetime('now', '-3 hours') WHERE id = ?").run(comment, task.id)
  db.prepare('INSERT INTO task_history (task_id, from_stage, to_stage, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(task.id, task.stage, 'revisao_interna', req.user.id, `Alteracao solicitada: ${comment}`)
  db.prepare('INSERT INTO task_comments (task_id, user_id, content, is_internal) VALUES (?, ?, ?, 0)').run(task.id, req.user.id, `🔄 Alteracao solicitada: ${comment}`)

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)
  broadcastSSE(updated.client_id, 'task:stage_changed', updated)
  // Notify all assignees
  const assignees = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(task.id)
  assignees.forEach(a => notify(a.user_id, 'task_changes_requested', 'Cliente solicitou alteracao', `"${updated.title}": ${comment}`, updated.id, req.user.id))
  notifyMany(getDonoUsers().map(d => d.id), 'task_changes_requested', 'Cliente solicitou alteracao', `"${updated.title}": ${comment}`, updated.id, req.user.id)
  res.json({ task: updated })
})

// Reject task
router.post('/:id/reject', (req, res) => {
  const { comment } = req.body
  if (!comment) return res.status(400).json({ error: 'Motivo da rejeicao obrigatorio' })
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Tarefa nao encontrada' })

  let newStage
  if ((req.user.role === 'dono' || req.user.role === 'gerente') && task.stage === 'aprovacao_interna') {
    newStage = 'em_producao'
  } else if (req.user.role === 'cliente' && task.stage === 'aguardando_cliente' && task.client_id === req.user.client_id) {
    newStage = 'revisao_interna'
  } else {
    return res.status(403).json({ error: 'Nao pode rejeitar neste estado' })
  }

  db.prepare("UPDATE tasks SET stage = ?, updated_at = datetime('now', '-3 hours') WHERE id = ?").run(newStage, task.id)
  db.prepare('INSERT INTO task_history (task_id, from_stage, to_stage, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(task.id, task.stage, newStage, req.user.id, `Rejeitado: ${comment}`)
  db.prepare('INSERT INTO task_comments (task_id, user_id, content, is_internal) VALUES (?, ?, ?, 0)').run(task.id, req.user.id, `Rejeitado: ${comment}`)

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)
  broadcastSSE(updated.client_id, 'task:stage_changed', updated)
  // Notify on rejection
  if (task.assigned_to) notify(task.assigned_to, 'task_rejected', 'Tarefa rejeitada', `"${updated.title}" — ${comment}`, updated.id, req.user.id)
  if (req.user.role === 'cliente') notifyMany(getDonoUsers().map(d => d.id), 'client_rejected', 'Cliente rejeitou tarefa', `"${updated.title}" — ${comment}`, updated.id, req.user.id)
  res.json({ task: updated })
})

export default router
