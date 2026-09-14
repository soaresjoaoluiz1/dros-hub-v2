// =====================================================================
// Tarefas recorrentes — funcoes puras para o cron e endpoints CRUD.
//
// computeNextRunAt(type, day, hour, fromDate?) — calcula proxima execucao
//   em BRT. Mensal: ajusta automaticamente se o dia nao existe no mes alvo
//   (ex: dia 31 em fev vira ultimo dia do mes).
//
// createTaskFromTemplate(templateId) — clona o template numa task real
//   (e suas subtarefas se task_type='mae'). Tudo em uma transaction.
//   Retorna { taskId, task }. Atualiza last_run_at e next_run_at do template.
// =====================================================================

import db from '../db.js'
import { broadcastSSE } from '../sse.js'
import { notify, getDonoUsers, getClientUsers } from '../notifications.js'

// ============== helpers de data ==============

// Pega "agora" em BRT (UTC-3) como objeto Date "ajustado"
function nowBRT() {
  const now = new Date()
  return new Date(now.getTime() - 3 * 3600 * 1000)
}

// Formata Date pra string DB ('YYYY-MM-DD HH:MM:SS')
function fmtDB(d) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const h = String(d.getUTCHours()).padStart(2, '0')
  const mi = String(d.getUTCMinutes()).padStart(2, '0')
  const s = String(d.getUTCSeconds()).padStart(2, '0')
  return `${y}-${m}-${day} ${h}:${mi}:${s}`
}

// Data soh: YYYY-MM-DD
function fmtDate(d) {
  return fmtDB(d).slice(0, 10)
}

// Cria Date BRT a partir de componentes (year, month 0-based, day, hour)
function makeBRTDate(year, monthZero, day, hour) {
  return new Date(Date.UTC(year, monthZero, day, hour, 0, 0))
}

// Ultimo dia do mes (mesma logica de moment/luxon)
function lastDayOfMonth(year, monthZero) {
  return new Date(Date.UTC(year, monthZero + 1, 0)).getUTCDate()
}

// Computa o proximo run_at em BRT (string DB).
// type: 'weekly' | 'monthly'
// day: weekly 1-7 (1=segunda, 7=domingo). monthly 1-31.
// hour: 0-23
// fromDate: opcional, default = nowBRT
export function computeNextRunAt(type, day, hour, fromDate) {
  const base = fromDate ? new Date(fromDate.getTime()) : nowBRT()
  const baseYear = base.getUTCFullYear()
  const baseMonth = base.getUTCMonth()
  const baseDay = base.getUTCDate()
  const baseHour = base.getUTCHours()
  const baseMin = base.getUTCMinutes()

  if (type === 'weekly') {
    // JS getUTCDay: 0=dom, 1=seg, ..., 6=sab
    // Nosso schema: 1=seg, ..., 7=dom
    // Converter day pra getDay: day 7 -> 0, outros -> day
    const targetDow = day === 7 ? 0 : day
    const todayDow = base.getUTCDay()
    let diff = targetDow - todayDow
    if (diff < 0) diff += 7
    if (diff === 0) {
      // Mesmo dia da semana: se ja passou da hora, vai pra proxima semana
      if (baseHour > hour || (baseHour === hour && baseMin > 0)) diff = 7
    }
    const next = makeBRTDate(baseYear, baseMonth, baseDay + diff, hour)
    return fmtDB(next)
  }

  if (type === 'monthly') {
    // Tenta no mes atual
    let targetMonth = baseMonth
    let targetYear = baseYear
    let actualDay = Math.min(day, lastDayOfMonth(targetYear, targetMonth))
    // Se ja passou no mes atual, vai pro proximo
    const alreadyPassed = baseDay > actualDay || (baseDay === actualDay && (baseHour > hour || (baseHour === hour && baseMin > 0)))
    if (alreadyPassed) {
      targetMonth += 1
      if (targetMonth > 11) { targetMonth = 0; targetYear += 1 }
      actualDay = Math.min(day, lastDayOfMonth(targetYear, targetMonth))
    }
    const next = makeBRTDate(targetYear, targetMonth, actualDay, hour)
    return fmtDB(next)
  }

  throw new Error(`Tipo de recorrencia invalido: ${type}`)
}

// Calcula due_date (YYYY-MM-DD) a partir de hoje + offset dias
function computeDueDate(offsetDays) {
  const d = nowBRT()
  d.setUTCDate(d.getUTCDate() + (offsetDays || 0))
  return fmtDate(d)
}

// ============== createTaskFromTemplate ==============

// Cria uma task real (e subtarefas) a partir de um template.
// Atualiza last_run_at + recalcula next_run_at do template.
// Retorna { taskId, task, subtasksCreated }
export function createTaskFromTemplate(templateId, opts = {}) {
  const tpl = db.prepare('SELECT * FROM task_templates WHERE id = ?').get(templateId)
  if (!tpl) throw new Error(`Template ${templateId} nao encontrado`)
  if (!tpl.is_active && !opts.force) throw new Error(`Template ${templateId} inativo`)

  const assignees = db.prepare('SELECT user_id FROM task_template_assignees WHERE template_id = ?').all(templateId).map(r => r.user_id)
  const allSubTemplates = db.prepare('SELECT * FROM task_template_subtasks WHERE template_id = ? ORDER BY subtask_position').all(templateId)
  // Se opts.includeSubtaskIds vier setado (array), filtra subs criadas. Undefined/null = cria todas.
  const subTemplates = Array.isArray(opts.includeSubtaskIds)
    ? allSubTemplates.filter(s => opts.includeSubtaskIds.map(Number).includes(s.id))
    : allSubTemplates

  const createdBy = opts.userId || tpl.created_by || null
  // Due date da tarefa mae:
  //  - modo 'on_complete': due_date = proxima ocorrencia do dia configurado (ex: proxima segunda,
  //    ou dia 15 do proximo mes). Ignora due_date_offset_days porque a "rotina" pede data fixa.
  //  - modo 'auto' (legado): due_date = hoje + offset_dias (comportamento antigo, o cron ja controla
  //    a data de CRIACAO, entao offset da folga pra executar).
  const nextRunIso = computeNextRunAt(tpl.recurrence_type, tpl.recurrence_day, tpl.recurrence_hour)
  const motherDueDate = tpl.mode === 'on_complete'
    ? nextRunIso.slice(0, 10)               // 'YYYY-MM-DD' da proxima ocorrencia
    : computeDueDate(tpl.due_date_offset_days)
  const primaryAssignee = assignees[0] || null

  const insertTask = db.prepare(`
    INSERT INTO tasks (
      client_id, category_id, department_id, title, description,
      priority, due_date, assigned_to, drive_link, drive_link_raw,
      approval_link, approval_files, approval_text, publish_date, publish_objective,
      created_by, stage, task_type, template_id, sequential_subtasks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'backlog', ?, ?, ?)
  `)
  const insertSubtask = db.prepare(`
    INSERT INTO tasks (
      client_id, category_id, department_id, title, description,
      priority, due_date, assigned_to, drive_link, drive_link_raw,
      approval_link, approval_files, approval_text, publish_date, publish_objective,
      created_by, stage, task_type, parent_task_id, subtask_position, template_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'backlog', 'normal', ?, ?, ?)
  `)
  const insertAssignee = db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)')
  const insertHistory = db.prepare('INSERT INTO task_history (task_id, to_stage, user_id) VALUES (?, ?, ?)')
  const updateTpl = db.prepare("UPDATE task_templates SET last_run_at = datetime('now', '-3 hours'), next_run_at = ?, updated_at = datetime('now', '-3 hours') WHERE id = ?")

  const tx = db.transaction(() => {
    // 1. Insere a tarefa raiz (normal ou mae) — grava template_id pra UI mostrar badge + trigger de proxima ao concluir
    const result = insertTask.run(
      tpl.client_id, tpl.category_id || null, tpl.department_id || null,
      tpl.title, tpl.description || null,
      tpl.priority || 'normal', motherDueDate, primaryAssignee,
      tpl.drive_link || null, tpl.drive_link_raw || null,
      tpl.approval_link || null, tpl.approval_files || null, tpl.approval_text || null,
      tpl.publish_date || null, tpl.publish_objective || null,
      createdBy, tpl.task_type || 'normal', templateId, tpl.sequential_subtasks ? 1 : 0
    )
    const taskId = result.lastInsertRowid

    // 2. Assignees da raiz
    assignees.forEach(uid => insertAssignee.run(taskId, uid))

    // 3. Historico
    insertHistory.run(taskId, 'backlog', createdBy)

    // 4. Subtarefas (so se mae)
    let subtasksCreated = 0
    if (tpl.task_type === 'mae' && subTemplates.length > 0) {
      subTemplates.forEach(sub => {
        // Em modo on_complete, subtarefas herdam data da mae (mesma data da proxima ocorrencia).
        // Em modo auto, mantem o comportamento antigo (hoje + offset da subtarefa ou da mae).
        const subDueDate = tpl.mode === 'on_complete'
          ? motherDueDate
          : computeDueDate(sub.due_date_offset_days != null ? sub.due_date_offset_days : tpl.due_date_offset_days)
        const subAssignees = db.prepare('SELECT user_id FROM task_template_subtask_assignees WHERE template_subtask_id = ?').all(sub.id).map(r => r.user_id)
        const subPrimary = subAssignees[0] || null
        const subResult = insertSubtask.run(
          tpl.client_id, sub.category_id || null, sub.department_id || null,
          sub.title, sub.description || null,
          sub.priority || 'normal', subDueDate, subPrimary,
          sub.drive_link || null, sub.drive_link_raw || null,
          sub.approval_link || null, sub.approval_files || null, sub.approval_text || null,
          sub.publish_date || null, sub.publish_objective || null,
          createdBy, taskId, sub.subtask_position || 0, templateId
        )
        const subId = subResult.lastInsertRowid
        subAssignees.forEach(uid => insertAssignee.run(subId, uid))
        insertHistory.run(subId, 'backlog', createdBy)
        subtasksCreated++
      })
    }

    // 5. Atualiza template (proxima execucao) — so faz sentido pra recorrentes
    if (tpl.is_recurring !== 0) {
      const nextRunAt = computeNextRunAt(tpl.recurrence_type, tpl.recurrence_day, tpl.recurrence_hour)
      updateTpl.run(nextRunAt, templateId)
    } else {
      // Biblioteca: so atualiza last_run_at, mantem next_run_at NULL
      db.prepare("UPDATE task_templates SET last_run_at = datetime('now', '-3 hours'), updated_at = datetime('now', '-3 hours') WHERE id = ?").run(templateId)
    }

    return { taskId, subtasksCreated }
  })

  const { taskId, subtasksCreated } = tx()
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)

  // 6. Broadcast SSE + notify (fora da transaction pra nao bloquear)
  try {
    broadcastSSE(task.client_id, 'task:created', task)
    assignees.filter(uid => uid !== createdBy).forEach(uid => {
      notify(uid, 'task_assigned', 'Nova tarefa recorrente', `"${task.title}" foi atribuida a voce`, taskId, createdBy)
    })
  } catch (e) {
    console.error('[Recurring] broadcast/notify falhou:', e.message)
  }

  return { taskId, task, subtasksCreated }
}

// ============== runDueTemplates ==============

// Chamado pelo cron. Pega todos os templates ativos com next_run_at <= agora
// e executa cada um. Retorna lista de { templateId, taskId } criados.
// Templates com mode='on_complete' sao pulados se ainda existe alguma instancia PENDENTE
// (task com template_id igual + stage nao terminal). Assim nao acumula tarefas se o dono
// nao concluiu a anterior — proximo ciclo dispara so quando ela fechar (em routes/tasks.js).
export function runDueTemplates() {
  const due = db.prepare(`
    SELECT id, mode FROM task_templates
    WHERE is_active = 1
      AND next_run_at IS NOT NULL
      AND next_run_at <= datetime('now', '-3 hours')
  `).all()
  const created = []
  for (const { id, mode } of due) {
    try {
      if (mode === 'on_complete' && hasPendingInstance(id)) {
        console.log(`[Recurring] template ${id} pulado — mode=on_complete e ha instancia pendente`)
        continue
      }
      const r = createTaskFromTemplate(id)
      created.push({ templateId: id, taskId: r.taskId })
    } catch (err) {
      console.error(`[Recurring] template ${id} falhou:`, err.message)
    }
  }
  return created
}

// Retorna true se ha pelo menos 1 task pendente (nao terminal, nao arquivada) originada deste template.
// Terminal stages: concluido, rejeitado. Se essa lista muda, ajustar aqui.
export function hasPendingInstance(templateId) {
  const row = db.prepare(`
    SELECT 1 FROM tasks
    WHERE template_id = ?
      AND stage NOT IN ('concluido', 'rejeitado')
      AND (parent_task_id IS NULL)
    LIMIT 1
  `).get(templateId)
  return !!row
}
