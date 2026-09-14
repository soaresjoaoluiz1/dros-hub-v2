// =====================================================================
// CRUD de templates de tarefa recorrente.
// Restrito a dono/gerente. Funcionario nao tem acesso.
// =====================================================================

import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { computeNextRunAt, createTaskFromTemplate } from '../services/taskTemplates.js'

const router = Router()

// Helper: carrega template completo (com assignees + subtasks + sub-assignees)
function loadFullTemplate(id) {
  const tpl = db.prepare('SELECT * FROM task_templates WHERE id = ?').get(id)
  if (!tpl) return null
  tpl.assigned_to = db.prepare('SELECT user_id FROM task_template_assignees WHERE template_id = ?').all(id).map(r => r.user_id)
  tpl.subtasks = db.prepare('SELECT * FROM task_template_subtasks WHERE template_id = ? ORDER BY subtask_position, id').all(id)
  tpl.subtasks.forEach(s => {
    s.assigned_to = db.prepare('SELECT user_id FROM task_template_subtask_assignees WHERE template_subtask_id = ?').all(s.id).map(r => r.user_id)
  })
  return tpl
}

// GET / — lista todos os templates (com nomes de cliente e count de subtarefas)
// Query: ?is_recurring=1 (so recorrentes) | ?is_recurring=0 (so biblioteca) | omite (todos)
// Query: ?client_id=X (pra popular botao 'Usar modelo' filtrando por cliente)
router.get('/', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  const conds = []
  const params = []
  if (req.query.is_recurring === '0') { conds.push('t.is_recurring = 0'); }
  else if (req.query.is_recurring === '1') { conds.push('t.is_recurring = 1'); }
  if (req.query.client_id) { conds.push('t.client_id = ?'); params.push(+req.query.client_id) }
  if (req.query.only_active === '1') { conds.push('t.is_active = 1') }
  const where = conds.length > 0 ? 'WHERE ' + conds.join(' AND ') : ''
  const templates = db.prepare(`
    SELECT t.*,
      c.name as client_name,
      (SELECT COUNT(*) FROM task_template_subtasks WHERE template_id = t.id) as subtasks_count
    FROM task_templates t
    LEFT JOIN clients c ON c.id = t.client_id
    ${where}
    ORDER BY t.is_active DESC, t.is_recurring DESC, t.next_run_at ASC, t.name
  `).all(...params)
  res.json({ templates })
})

// GET /:id — detalhe completo
router.get('/:id', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  const tpl = loadFullTemplate(req.params.id)
  if (!tpl) return res.status(404).json({ error: 'Template nao encontrado' })
  res.json({ template: tpl })
})

// POST / — cria template + assignees + subtasks
router.post('/', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  try {
  const b = req.body
  // is_recurring=0 → biblioteca de modelo (sem cron, recurrence opcional)
  const isRecurring = b.is_recurring === 0 || b.is_recurring === false ? 0 : 1
  if (!b.name || !b.client_id || !b.title) {
    return res.status(400).json({ error: 'name, client_id, title obrigatorios' })
  }
  if (isRecurring) {
    if (!b.recurrence_type || !b.recurrence_day) {
      return res.status(400).json({ error: 'Template recorrente exige recurrence_type e recurrence_day' })
    }
    if (!['weekly', 'monthly'].includes(b.recurrence_type)) {
      return res.status(400).json({ error: 'recurrence_type deve ser weekly ou monthly' })
    }
  }

  const filesJson = Array.isArray(b.approval_files) && b.approval_files.length > 0
    ? JSON.stringify(b.approval_files.filter(s => s && String(s).trim()))
    : null
  const effectiveApprovalLink = filesJson ? JSON.parse(filesJson)[0] : (b.approval_link || null)
  // Se nao recorrente, next_run_at = null (scheduler ignora). Se recorrente, calcula normal.
  const nextRunAt = isRecurring ? computeNextRunAt(b.recurrence_type, +b.recurrence_day, +b.recurrence_hour || 6) : null
  // Fallback pra recurrence_type/day quando modelo (CREATE TABLE tem NOT NULL — usa dummies)
  const recType = b.recurrence_type || 'monthly'
  const recDay = b.recurrence_day != null ? +b.recurrence_day : 1

  const mode = b.mode === 'on_complete' ? 'on_complete' : 'auto'
  const sequentialSubtasks = b.sequential_subtasks ? 1 : 0

  const tx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO task_templates (
        name, is_active, is_recurring, task_type, client_id, category_id, department_id,
        title, description, priority,
        drive_link, drive_link_raw, approval_link, approval_files, approval_text,
        publish_date, publish_objective,
        due_date_offset_days, recurrence_type, recurrence_day, recurrence_hour,
        next_run_at, created_by, mode, sequential_subtasks
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.name, isRecurring, b.task_type || 'normal', +b.client_id,
      b.category_id || null, b.department_id || null,
      b.title, b.description || null, b.priority || 'normal',
      b.drive_link || null, b.drive_link_raw || null, effectiveApprovalLink, filesJson, b.approval_text || null,
      b.publish_date || null, b.publish_objective || null,
      +b.due_date_offset_days || 7, recType, recDay, +b.recurrence_hour || 6,
      nextRunAt, req.user.id, mode, sequentialSubtasks
    )
    const tplId = result.lastInsertRowid

    // Assignees da raiz
    const insertA = db.prepare('INSERT OR IGNORE INTO task_template_assignees (template_id, user_id) VALUES (?, ?)')
    ;(b.assigned_to || []).filter(Boolean).map(Number).forEach(uid => insertA.run(tplId, uid))

    // Subtasks (so se mae)
    if (b.task_type === 'mae' && Array.isArray(b.subtasks)) {
      const insertSub = db.prepare(`
        INSERT INTO task_template_subtasks (
          template_id, subtask_position, title, description, priority,
          category_id, department_id, due_date_offset_days,
          drive_link, drive_link_raw, approval_link, approval_files, approval_text,
          publish_date, publish_objective
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertSubA = db.prepare('INSERT OR IGNORE INTO task_template_subtask_assignees (template_subtask_id, user_id) VALUES (?, ?)')
      b.subtasks.forEach((sub, idx) => {
        if (!sub.title) return
        const subFilesJson = Array.isArray(sub.approval_files) && sub.approval_files.length > 0
          ? JSON.stringify(sub.approval_files.filter(s => s && String(s).trim()))
          : null
        const subApprovalLink = subFilesJson ? JSON.parse(subFilesJson)[0] : (sub.approval_link || null)
        const subResult = insertSub.run(
          tplId, sub.subtask_position != null ? +sub.subtask_position : idx + 1,
          sub.title, sub.description || null, sub.priority || 'normal',
          sub.category_id || null, sub.department_id || null,
          sub.due_date_offset_days != null ? +sub.due_date_offset_days : null,
          sub.drive_link || null, sub.drive_link_raw || null, subApprovalLink, subFilesJson, sub.approval_text || null,
          sub.publish_date || null, sub.publish_objective || null
        )
        const subId = subResult.lastInsertRowid
        ;(sub.assigned_to || []).filter(Boolean).map(Number).forEach(uid => insertSubA.run(subId, uid))
      })
    }

    return tplId
  })

  const tplId = tx()

  // Se mode=on_complete E eh recorrente, ja cria a 1a instancia imediatamente.
  // Modelos de biblioteca (is_recurring=0) nunca disparam sozinhos — so via botao 'Usar modelo'.
  if (isRecurring && mode === 'on_complete') {
    try {
      const r = createTaskFromTemplate(tplId, { userId: req.user.id })
      console.log(`[Recurring] template=${tplId} criado em modo on_complete, 1a task=${r.taskId}`)
    } catch (e) {
      console.error(`[Recurring] template=${tplId} criado mas falha ao disparar 1a task:`, e.message)
    }
  }

  res.json({ template: loadFullTemplate(tplId) })
  } catch (err) {
    console.error('[task-templates POST] erro:', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

// PUT /:id — substitui campos + replaces assignees e subtasks
router.put('/:id', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  try {
  const tplId = +req.params.id
  const exists = db.prepare('SELECT id, recurrence_type, recurrence_day, recurrence_hour, is_recurring, next_run_at FROM task_templates WHERE id = ?').get(tplId)
  if (!exists) return res.status(404).json({ error: 'Template nao encontrado' })

  const b = req.body
  const filesJson = Array.isArray(b.approval_files) && b.approval_files.length > 0
    ? JSON.stringify(b.approval_files.filter(s => s && String(s).trim()))
    : null
  const effectiveApprovalLink = filesJson ? JSON.parse(filesJson)[0] : (b.approval_link || null)

  // Toggle is_recurring (default: mantem)
  const isRecurring = b.is_recurring != null ? (b.is_recurring === 0 || b.is_recurring === false ? 0 : 1) : exists.is_recurring
  // Recalcula next_run_at se mudou o agendamento OU se virou nao-recorrente
  let nextRunAt = exists.next_run_at
  const newType = b.recurrence_type || exists.recurrence_type
  const newDay = b.recurrence_day != null ? +b.recurrence_day : exists.recurrence_day
  const newHour = b.recurrence_hour != null ? +b.recurrence_hour : exists.recurrence_hour
  if (!isRecurring) {
    nextRunAt = null // biblioteca — nao roda automatico
  } else if (newType !== exists.recurrence_type || newDay !== exists.recurrence_day || newHour !== exists.recurrence_hour || !exists.is_recurring) {
    nextRunAt = computeNextRunAt(newType, newDay, newHour)
  }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE task_templates SET
        name = COALESCE(?, name),
        is_active = COALESCE(?, is_active),
        is_recurring = ?,
        task_type = COALESCE(?, task_type),
        client_id = COALESCE(?, client_id),
        category_id = ?, department_id = ?,
        title = COALESCE(?, title), description = ?, priority = COALESCE(?, priority),
        drive_link = ?, drive_link_raw = ?,
        approval_link = ?, approval_files = ?, approval_text = ?,
        publish_date = ?, publish_objective = ?,
        due_date_offset_days = COALESCE(?, due_date_offset_days),
        recurrence_type = ?, recurrence_day = ?, recurrence_hour = ?,
        next_run_at = ?,
        mode = COALESCE(?, mode),
        sequential_subtasks = COALESCE(?, sequential_subtasks),
        updated_at = datetime('now', '-3 hours')
      WHERE id = ?
    `).run(
      b.name || null,
      b.is_active != null ? (b.is_active ? 1 : 0) : null,
      isRecurring,
      b.task_type || null,
      b.client_id ? +b.client_id : null,
      b.category_id || null, b.department_id || null,
      b.title || null, b.description || null, b.priority || null,
      b.drive_link || null, b.drive_link_raw || null,
      effectiveApprovalLink, filesJson, b.approval_text || null,
      b.publish_date || null, b.publish_objective || null,
      b.due_date_offset_days != null ? +b.due_date_offset_days : null,
      newType, newDay, newHour,
      nextRunAt,
      b.mode === 'on_complete' || b.mode === 'auto' ? b.mode : null,
      b.sequential_subtasks != null ? (b.sequential_subtasks ? 1 : 0) : null,
      tplId
    )

    // Replace assignees
    db.prepare('DELETE FROM task_template_assignees WHERE template_id = ?').run(tplId)
    const insertA = db.prepare('INSERT OR IGNORE INTO task_template_assignees (template_id, user_id) VALUES (?, ?)')
    ;(b.assigned_to || []).filter(Boolean).map(Number).forEach(uid => insertA.run(tplId, uid))

    // Replace subtasks (drop + recreate). Mais simples que diff.
    db.prepare('DELETE FROM task_template_subtask_assignees WHERE template_subtask_id IN (SELECT id FROM task_template_subtasks WHERE template_id = ?)').run(tplId)
    db.prepare('DELETE FROM task_template_subtasks WHERE template_id = ?').run(tplId)
    if ((b.task_type === 'mae' || (!b.task_type && Array.isArray(b.subtasks))) && Array.isArray(b.subtasks)) {
      const insertSub = db.prepare(`
        INSERT INTO task_template_subtasks (
          template_id, subtask_position, title, description, priority,
          category_id, department_id, due_date_offset_days,
          drive_link, drive_link_raw, approval_link, approval_files, approval_text,
          publish_date, publish_objective
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertSubA = db.prepare('INSERT OR IGNORE INTO task_template_subtask_assignees (template_subtask_id, user_id) VALUES (?, ?)')
      b.subtasks.forEach((sub, idx) => {
        if (!sub.title) return
        const subFilesJson = Array.isArray(sub.approval_files) && sub.approval_files.length > 0
          ? JSON.stringify(sub.approval_files.filter(s => s && String(s).trim()))
          : null
        const subApprovalLink = subFilesJson ? JSON.parse(subFilesJson)[0] : (sub.approval_link || null)
        const subResult = insertSub.run(
          tplId, sub.subtask_position != null ? +sub.subtask_position : idx + 1,
          sub.title, sub.description || null, sub.priority || 'normal',
          sub.category_id || null, sub.department_id || null,
          sub.due_date_offset_days != null ? +sub.due_date_offset_days : null,
          sub.drive_link || null, sub.drive_link_raw || null, subApprovalLink, subFilesJson, sub.approval_text || null,
          sub.publish_date || null, sub.publish_objective || null
        )
        const subId = subResult.lastInsertRowid
        ;(sub.assigned_to || []).filter(Boolean).map(Number).forEach(uid => insertSubA.run(subId, uid))
      })
    }
  })
  tx()
  res.json({ template: loadFullTemplate(tplId) })
  } catch (err) {
    console.error('[task-templates PUT] erro:', err.message, err.stack)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /:id — soft delete (is_active=0). Mantem historico.
router.delete('/:id', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  const r = db.prepare("UPDATE task_templates SET is_active = 0, updated_at = datetime('now', '-3 hours') WHERE id = ?").run(req.params.id)
  if (r.changes === 0) return res.status(404).json({ error: 'Template nao encontrado' })
  res.json({ ok: true })
})

// POST /:id/run-now — forca criar uma tarefa do template agora (sem esperar cron)
// Body opcional: { include_subtask_ids: [id1, id2, ...] } — filtra quais subs vao ser criadas.
// Se omitido, cria todas as subs do template.
router.post('/:id/run-now', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  try {
    const opts = { userId: req.user.id, force: true }
    if (Array.isArray(req.body?.include_subtask_ids)) {
      opts.includeSubtaskIds = req.body.include_subtask_ids
    }
    const result = createTaskFromTemplate(+req.params.id, opts)
    res.json({ ok: true, task_id: result.taskId, subtasks_created: result.subtasksCreated })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
