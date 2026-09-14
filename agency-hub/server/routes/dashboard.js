import { Router } from 'express'
import db from '../db.js'

const router = Router()

// Feriados nacionais BR pra calculo de streak.
// Fixos (todo ano) usam MM-DD; moveis (Carnaval/Sexta-Santa/Corpus Christi)
// usam YYYY-MM-DD e precisam ser atualizados anualmente.
// Atualizar lista quando virar o ano (adicionar proximo ano).
const BR_HOLIDAYS = new Set([
  // Fixos nacionais
  '01-01', // Confraternizacao Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independencia
  '10-12', // N. Sra. Aparecida
  '11-02', // Finados
  '11-15', // Proclamacao da Republica
  '11-20', // Consciencia Negra (Lei 14.759/2023)
  '12-25', // Natal

  // Moveis 2024
  '2024-02-12', '2024-02-13', // Carnaval (seg/ter)
  '2024-03-29',               // Sexta-feira Santa
  '2024-05-30',               // Corpus Christi
  // Moveis 2025
  '2025-03-03', '2025-03-04',
  '2025-04-18',
  '2025-06-19',
  // Moveis 2026
  '2026-02-16', '2026-02-17',
  '2026-04-03',
  '2026-06-04',               // <- Corpus Christi 2026
  // Moveis 2027
  '2027-02-08', '2027-02-09',
  '2027-03-26',
  '2027-05-27',
])

function isBrHoliday(dateStr) {
  // dateStr formato 'YYYY-MM-DD'
  if (!dateStr || dateStr.length < 10) return false
  const mmdd = dateStr.slice(5)  // 'MM-DD'
  if (BR_HOLIDAYS.has(mmdd)) return true
  return BR_HOLIDAYS.has(dateStr)
}

// Dias off por usuario — ignorados no calculo do streak (nao quebram nem somam).
// Uso interno pra dias em que houve trabalho fora do Hub. Keys: user_id numero.
const USER_STREAK_SKIP = {
  20: new Set([  // Joao Luiz
    '2026-07-03', '2026-07-09', '2026-07-13', '2026-07-15', '2026-07-16',
    '2026-07-17', '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23',
    '2026-07-24', '2026-07-27',
  ]),
}

function isSkippedForUser(uid, dateStr) {
  const set = USER_STREAK_SKIP[uid]
  return !!(set && set.has(dateStr))
}

router.get('/stats', (req, res) => {
  const { days = '30' } = req.query
  const since = new Date(); since.setDate(since.getDate() - parseInt(days))
  const sinceStr = since.toISOString().slice(0, 19).replace('T', ' ')

  if (req.user.role === 'dono' || req.user.role === 'gerente') {
    const totalTasks = db.prepare('SELECT COUNT(*) as c FROM tasks WHERE is_active = 1').get().c
    const byStage = db.prepare(`
      SELECT ps.name, ps.slug, ps.color, ps.position, COUNT(t.id) as count
      FROM pipeline_stages ps LEFT JOIN tasks t ON t.stage = ps.slug AND t.is_active = 1
      GROUP BY ps.id ORDER BY ps.position
    `).all()
    const byDepartment = db.prepare(`
      SELECT d.name, d.color, COUNT(t.id) as count FROM departments d
      LEFT JOIN tasks t ON t.department_id = d.id AND t.is_active = 1
      WHERE d.is_active = 1 GROUP BY d.id ORDER BY count DESC
    `).all()
    const byAssignee = db.prepare(`
      SELECT u.id, u.name,
        COUNT(DISTINCT ta.task_id) as count
      FROM users u
      LEFT JOIN task_assignees ta ON ta.user_id = u.id
      LEFT JOIN tasks t ON t.id = ta.task_id AND t.is_active = 1
      WHERE u.role IN ('funcionario', 'gerente', 'dono') AND u.is_active = 1
      GROUP BY u.id
      HAVING count > 0
      ORDER BY count DESC
    `).all()

    // Throughput: tarefas concluidas no periodo por funcionario
    const throughputByAssignee = db.prepare(`
      SELECT u.id, u.name, COUNT(DISTINCT t.id) as count
      FROM users u
      JOIN task_assignees ta ON ta.user_id = u.id
      JOIN tasks t ON t.id = ta.task_id
      WHERE u.role IN ('funcionario', 'gerente', 'dono') AND u.is_active = 1
        AND t.stage = 'concluido' AND t.updated_at >= ?
      GROUP BY u.id
      HAVING count > 0
      ORDER BY count DESC
    `).all(sinceStr)

    // Tempo medio em aguardando_cliente, por cliente (em horas)
    const clientWaitTime = db.prepare(`
      SELECT c.name, AVG(diff_hours) as avg_hours, COUNT(*) as samples
      FROM (
        SELECT th.task_id, t.client_id,
          (julianday(COALESCE(
            (SELECT created_at FROM task_history WHERE task_id = th.task_id AND id > th.id ORDER BY id LIMIT 1),
            datetime('now', '-3 hours')
          )) - julianday(th.created_at)) * 24.0 as diff_hours
        FROM task_history th
        JOIN tasks t ON t.id = th.task_id
        WHERE th.to_stage = 'aguardando_cliente'
          AND t.client_id IS NOT NULL
          AND th.created_at >= ?
      ) sub
      JOIN clients c ON c.id = sub.client_id
      WHERE diff_hours >= 0
      GROUP BY sub.client_id
      HAVING samples > 0
      ORDER BY avg_hours DESC
      LIMIT 20
    `).all(sinceStr)

    // Taxa de retrabalho: % de tarefas que voltaram da aprovacao pra revisao/producao
    const reworkData = db.prepare(`
      SELECT
        (SELECT COUNT(DISTINCT task_id) FROM task_history
         WHERE to_stage IN ('revisao_interna', 'em_producao')
           AND from_stage IN ('aprovacao_interna', 'aguardando_cliente')
           AND created_at >= ?
        ) as reworked,
        (SELECT COUNT(*) FROM tasks
         WHERE is_active = 1 AND created_at >= ?
        ) as totalCreated
    `).get(sinceStr, sinceStr)
    const reworkRate = reworkData.totalCreated > 0
      ? Math.round((reworkData.reworked / reworkData.totalCreated) * 1000) / 10
      : 0

    // Lista das tarefas que tiveram retrabalho recente — mais recente primeiro
    const reworkList = db.prepare(`
      SELECT
        t.id, t.title, t.stage,
        c.name as client_name,
        ps.name as stage_name, ps.color as stage_color,
        MAX(th.created_at) as last_rework_at
      FROM task_history th
      JOIN tasks t ON t.id = th.task_id
      LEFT JOIN clients c ON c.id = t.client_id
      LEFT JOIN pipeline_stages ps ON ps.slug = t.stage
      WHERE th.to_stage IN ('revisao_interna', 'em_producao')
        AND th.from_stage IN ('aprovacao_interna', 'aguardando_cliente')
        AND th.created_at >= ?
        AND t.is_active = 1
      GROUP BY t.id
      ORDER BY last_rework_at DESC
      LIMIT 25
    `).all(sinceStr)
    const byCategory = db.prepare(`
      SELECT cat.name, cat.color, COUNT(t.id) as count FROM task_categories cat
      LEFT JOIN tasks t ON t.category_id = cat.id AND t.is_active = 1
      WHERE cat.is_active = 1 GROUP BY cat.id ORDER BY count DESC
    `).all()
    const overdue = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE is_active = 1 AND due_date IS NOT NULL AND due_date != '' AND due_date < date('now', '-3 hours') AND stage NOT IN ('concluido', 'rejeitado')").get().c
    const pendingInternal = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE stage = 'aprovacao_interna' AND is_active = 1").get().c
    const pendingClient = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE stage = 'aguardando_cliente' AND is_active = 1").get().c
    const completedPeriod = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE stage = 'concluido' AND updated_at >= ?").get(sinceStr).c
    const daily = db.prepare("SELECT date(created_at) as date, COUNT(*) as count FROM tasks WHERE created_at >= ? AND is_active = 1 GROUP BY date(created_at) ORDER BY date").all(sinceStr)
    const toPublish = db.prepare("SELECT t.id, t.title, t.due_date, c.name as client_name, t.approval_link FROM tasks t LEFT JOIN clients c ON t.client_id = c.id WHERE t.stage = 'programar_publicacao' AND t.is_active = 1 ORDER BY t.due_date ASC").all()

    res.json({ totalTasks, byStage, byDepartment, byCategory, byAssignee, throughputByAssignee, clientWaitTime, reworkRate, reworkedCount: reworkData.reworked, reworkList, overdue, pendingInternal, pendingClient, completedPeriod, daily, toPublish })
  } else if (req.user.role === 'funcionario') {
    const uid = req.user.id
    const myTasks = db.prepare('SELECT COUNT(*) as c FROM tasks WHERE id IN (SELECT task_id FROM task_assignees WHERE user_id = ?) AND is_active = 1').get(uid).c
    const byStage = db.prepare(`
      SELECT ps.name, ps.slug, ps.color, ps.position, COUNT(t.id) as count
      FROM pipeline_stages ps LEFT JOIN tasks t ON t.stage = ps.slug AND t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?) AND t.is_active = 1
      GROUP BY ps.id ORDER BY ps.position
    `).all(uid)
    const overdue = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE id IN (SELECT task_id FROM task_assignees WHERE user_id = ?) AND is_active = 1 AND due_date IS NOT NULL AND due_date != '' AND due_date < date('now', '-3 hours') AND stage NOT IN ('concluido', 'rejeitado')").get(uid).c

    // Conclusoes pelo task_history (preciso porque updated_at de uma tarefa pode mudar por outras razoes)
    const completedSql = `
      SELECT date(th.created_at, '-3 hours') as date, COUNT(DISTINCT th.task_id) as count
      FROM task_history th
      JOIN task_assignees ta ON ta.task_id = th.task_id AND ta.user_id = ?
      WHERE th.to_stage = 'concluido' AND th.created_at >= ?
      GROUP BY date(th.created_at, '-3 hours')
      ORDER BY date
    `

    // Hoje, semana (ultimos 7d), mes (ultimos 30d)
    const concludedToday = db.prepare(`
      SELECT COUNT(DISTINCT th.task_id) as c FROM task_history th
      JOIN task_assignees ta ON ta.task_id = th.task_id AND ta.user_id = ?
      WHERE th.to_stage = 'concluido' AND date(th.created_at, '-3 hours') = date('now', '-3 hours')
    `).get(uid).c
    const concludedWeek = db.prepare(`
      SELECT COUNT(DISTINCT th.task_id) as c FROM task_history th
      JOIN task_assignees ta ON ta.task_id = th.task_id AND ta.user_id = ?
      WHERE th.to_stage = 'concluido' AND th.created_at >= datetime('now', '-7 days')
    `).get(uid).c
    const concludedMonth = db.prepare(`
      SELECT COUNT(DISTINCT th.task_id) as c FROM task_history th
      JOIN task_assignees ta ON ta.task_id = th.task_id AND ta.user_id = ?
      WHERE th.to_stage = 'concluido' AND th.created_at >= datetime('now', '-30 days')
    `).get(uid).c

    // Heatmap dos ultimos 90 dias (preenche array completo)
    const since90 = new Date(); since90.setDate(since90.getDate() - 90)
    const since90Str = since90.toISOString().slice(0, 19).replace('T', ' ')
    const completionRows = db.prepare(completedSql).all(uid, since90Str)
    const completionMap = new Map(completionRows.map(r => [r.date, r.count]))
    const heatmap = []
    for (let i = 89; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      heatmap.push({ date: key, count: completionMap.get(key) || 0 })
    }

    // Streak: dias uteis consecutivos com pelo menos 1 conclusao terminando em hoje.
    // - Sabado, domingo E feriado nacional NAO quebram a sequencia (sao ignorados)
    // - Tolera zero conclusoes hoje (comeca a contar de ontem)
    // - Quebra na primeira sexta/qua/etc com zero conclusoes
    let streak = 0
    for (let i = heatmap.length - 1; i >= 0; i--) {
      const d = new Date(heatmap[i].date + 'T12:00:00')
      const dow = d.getDay() // 0=domingo, 6=sabado
      if (dow === 0 || dow === 6) continue // fim de semana: nao quebra nem soma
      if (isBrHoliday(heatmap[i].date)) continue // feriado nacional: ignora
      if (isSkippedForUser(uid, heatmap[i].date)) continue // dia off do usuario: ignora
      if (heatmap[i].count > 0) { streak++; continue }
      if (i === heatmap.length - 1) continue // tolera zero hoje
      break
    }

    // Recorde de streak: maior sequencia de dias uteis com >=1 conclusao em toda a historia do usuario.
    // Mesma regra: fim de semana ignorado, dia util sem conclusao quebra.
    const allDatesRow = db.prepare(`
      SELECT date(th.created_at, '-3 hours') as date
      FROM task_history th
      JOIN task_assignees ta ON ta.task_id = th.task_id AND ta.user_id = ?
      WHERE th.to_stage = 'concluido'
      GROUP BY date(th.created_at, '-3 hours')
      ORDER BY date
    `).all(uid)
    let streakRecord = 0
    let streakRecordDate = null
    if (allDatesRow.length > 0) {
      const completedSet = new Set(allDatesRow.map(r => r.date))
      const firstDate = new Date(allDatesRow[0].date + 'T12:00:00')
      const todayDate = new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00')
      let current = 0
      let currentEnd = null
      for (let d = new Date(firstDate); d <= todayDate; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay()
        if (dow === 0 || dow === 6) continue
        const key = d.toISOString().slice(0, 10)
        if (isBrHoliday(key)) continue // feriado nacional: ignora
        if (isSkippedForUser(uid, key)) continue // dia off do usuario: ignora
        if (completedSet.has(key)) {
          current++
          currentEnd = key
          if (current > streakRecord) { streakRecord = current; streakRecordDate = currentEnd }
        } else {
          current = 0
          currentEnd = null
        }
      }
    }

    // Tarefas que requerem atencao agora: atrasadas (ja vencidas) + vencendo nos
    // proximos 2 dias. Ordenadas por due_date ASC (mais atrasadas primeiro).
    const upcoming = db.prepare(`
      SELECT t.id, t.title, t.due_date, t.stage, ps.name as stage_name, ps.color as stage_color, c.name as client_name
      FROM tasks t
      LEFT JOIN pipeline_stages ps ON ps.slug = t.stage
      LEFT JOIN clients c ON c.id = t.client_id
      WHERE t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?)
        AND t.is_active = 1
        AND t.stage NOT IN ('concluido', 'rejeitado')
        AND t.due_date IS NOT NULL AND t.due_date != ''
        AND date(t.due_date) <= date('now', '-3 hours', '+2 days')
      ORDER BY t.due_date ASC
      LIMIT 8
    `).all(uid)

    // Evolucao semanal (8 semanas)
    const weeklyHistory = []
    for (let w = 7; w >= 0; w--) {
      const start = new Date(); start.setDate(start.getDate() - (w + 1) * 7 + 1); start.setHours(0, 0, 0, 0)
      const end = new Date(); end.setDate(end.getDate() - w * 7); end.setHours(23, 59, 59, 999)
      const cnt = db.prepare(`
        SELECT COUNT(DISTINCT th.task_id) as c FROM task_history th
        JOIN task_assignees ta ON ta.task_id = th.task_id AND ta.user_id = ?
        WHERE th.to_stage = 'concluido' AND th.created_at >= ? AND th.created_at <= ?
      `).get(uid, start.toISOString().slice(0, 19).replace('T', ' '), end.toISOString().slice(0, 19).replace('T', ' ')).c
      const label = w === 0 ? 'Esta sem.' : w === 1 ? 'Sem. passada' : `${w} sem. atras`
      weeklyHistory.push({ label, count: cnt })
    }

    res.json({ myTasks, byStage, overdue, concludedToday, concludedWeek, concludedMonth, heatmap, streak, streakRecord, streakRecordDate, weeklyHistory, upcoming })
  } else { // cliente
    const totalTasks = db.prepare('SELECT COUNT(*) as c FROM tasks WHERE client_id = ? AND is_active = 1').get(req.user.client_id).c
    const pendingApproval = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE client_id = ? AND stage = 'aguardando_cliente' AND is_active = 1").get(req.user.client_id).c
    const byStage = db.prepare(`
      SELECT ps.name, ps.slug, ps.color, ps.position, COUNT(t.id) as count
      FROM pipeline_stages ps LEFT JOIN tasks t ON t.stage = ps.slug AND t.client_id = ? AND t.is_active = 1
      GROUP BY ps.id ORDER BY ps.position
    `).all(req.user.client_id)

    res.json({ totalTasks, pendingApproval, byStage })
  }
})

// Trends (tasks created/completed per day)
router.get('/trends', (req, res) => {
  const { days = '30' } = req.query
  const since = new Date(); since.setDate(since.getDate() - parseInt(days))
  const sinceStr = since.toISOString().slice(0, 19).replace('T', ' ')

  const created = db.prepare("SELECT date(created_at) as date, COUNT(*) as count FROM tasks WHERE created_at >= ? AND is_active = 1 GROUP BY date(created_at) ORDER BY date").all(sinceStr)
  const completed = db.prepare("SELECT date(updated_at) as date, COUNT(*) as count FROM tasks WHERE stage = 'concluido' AND updated_at >= ? GROUP BY date(updated_at) ORDER BY date").all(sinceStr)

  res.json({ created, completed })
})

// Team workload
router.get('/workload', (req, res) => {
  const workers = db.prepare(`
    SELECT u.id, u.name,
      (SELECT COUNT(*) FROM tasks WHERE id IN (SELECT task_id FROM task_assignees WHERE user_id = u.id) AND is_active = 1 AND stage NOT IN ('concluido', 'rejeitado')) as open_tasks,
      (SELECT COUNT(*) FROM tasks WHERE id IN (SELECT task_id FROM task_assignees WHERE user_id = u.id) AND is_active = 1 AND due_date IS NOT NULL AND due_date != '' AND due_date < date('now', '-3 hours') AND stage NOT IN ('concluido', 'rejeitado')) as overdue_tasks,
      (SELECT COUNT(*) FROM tasks WHERE id IN (SELECT task_id FROM task_assignees WHERE user_id = u.id) AND is_active = 1 AND stage = 'concluido') as completed_tasks
    FROM users u WHERE u.role IN ('funcionario', 'dono', 'gerente') AND u.is_active = 1
    ORDER BY open_tasks DESC
  `).all()
  // Attach departments
  const deptStmt = db.prepare('SELECT d.name, d.color FROM user_departments ud JOIN departments d ON ud.department_id = d.id WHERE ud.user_id = ?')
  workers.forEach(w => { w.departments = deptStmt.all(w.id); w.status = w.open_tasks > 8 ? 'overloaded' : w.open_tasks > 5 ? 'busy' : 'available' })
  res.json({ workers })
})

export default router
