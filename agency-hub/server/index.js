process.env.TZ = 'America/Sao_Paulo'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../../.env') })

import db from './db.js'
import authRoutes from './routes/auth.js'
import clientRoutes from './routes/clients.js'
import departmentRoutes from './routes/departments.js'
import userRoutes from './routes/users.js'
import categoryRoutes from './routes/categories.js'
import taskRoutes from './routes/tasks.js'
import approvalRoutes from './routes/approvals.js'
import dashboardRoutes from './routes/dashboard.js'
import notificationRoutes from './routes/notifications.js'
import financialRoutes from './routes/financial.js'
import performanceRoutes, { publicRouter as performancePublicRoutes } from './routes/performance.js'
import taskTemplateRoutes from './routes/task-templates.js'
import settingsRoutes, { seedSettingsFromEnv } from './routes/settings.js'
import configRoutes from './routes/config.js'
import coreCompatRoutes from './routes/coreCompat.js'
import { runDueTemplates } from './services/taskTemplates.js'
import { authenticate } from './middleware/auth.js'
import { addSSEClient, removeSSEClient, addSSEUserClient, removeSSEUserClient, sendToUser } from './sse.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '5mb' }))

const PORT = 3005

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/clients', authenticate, clientRoutes)
app.use('/api/departments', authenticate, departmentRoutes)
app.use('/api/users', authenticate, userRoutes)
app.use('/api/categories', authenticate, categoryRoutes)
app.use('/api/tasks', authenticate, taskRoutes)
app.use('/api/approvals', authenticate, approvalRoutes)
app.use('/api/dashboard', authenticate, dashboardRoutes)
app.use('/api/notifications', authenticate, notificationRoutes)
app.use('/api/financial', authenticate, financialRoutes)
app.use('/api/performance', performancePublicRoutes)
app.use('/api/performance', authenticate, performanceRoutes)
app.use('/api/task-templates', authenticate, taskTemplateRoutes)
app.use('/api/settings', authenticate, settingsRoutes)
app.use('/api/config', configRoutes)   // server-to-server via X-Core-Secret, NAO usa authenticate (JWT user)
app.use('/api', coreCompatRoutes)  // rotas espelho pros componentes vindos do Core (auth inline dentro do router)

// Active timers for current user
app.get('/api/my-timers', authenticate, (req, res) => {
  const timers = db.prepare(`
    SELECT te.*, t.title as task_title, t.id as task_id
    FROM time_entries te JOIN tasks t ON te.task_id = t.id
    WHERE te.user_id = ? AND te.ended_at IS NULL
    ORDER BY te.started_at DESC
  `).all(req.user.id)
  res.json({ timers })
})

// SSE
app.get('/api/events', async (req, res) => {
  const token = req.query.token
  if (!token) return res.status(401).end()
  let user
  try {
    const jwtMod = await import('jsonwebtoken')
    user = jwtMod.default.verify(token, process.env.JWT_SECRET || 'dros-hub-v2-secret-2026')
  } catch { return res.status(401).end() }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' })
  res.write('data: {"type":"connected"}\n\n')
  const key = user.client_id || 'admin'
  addSSEClient(key, res)
  addSSEUserClient(user.id, res)
  req.on('close', () => { removeSSEClient(key, res); removeSSEUserClient(user.id, res) })
})

// Pipeline stages CRUD
app.get('/api/stages', authenticate, (req, res) => {
  res.json({ stages: db.prepare('SELECT * FROM pipeline_stages ORDER BY position').all() })
})

app.post('/api/stages', authenticate, (req, res) => {
  if (req.user.role !== 'dono') return res.status(403).json({ error: 'Forbidden' })
  const { name, slug, color, position, is_terminal } = req.body
  if (!name || !slug) return res.status(400).json({ error: 'name and slug required' })
  const result = db.prepare('INSERT INTO pipeline_stages (name, slug, position, color, is_terminal) VALUES (?, ?, ?, ?, ?)').run(name, slug, position || 0, color || '#FFB300', is_terminal || 0)
  res.json({ stage: db.prepare('SELECT * FROM pipeline_stages WHERE id = ?').get(result.lastInsertRowid) })
})

app.put('/api/stages/:id', authenticate, (req, res) => {
  if (req.user.role !== 'dono') return res.status(403).json({ error: 'Forbidden' })
  const { name, color, position, is_terminal } = req.body
  const sets = []; const params = []
  if (name !== undefined) { sets.push('name = ?'); params.push(name) }
  if (color !== undefined) { sets.push('color = ?'); params.push(color) }
  if (position !== undefined) { sets.push('position = ?'); params.push(position) }
  if (is_terminal !== undefined) { sets.push('is_terminal = ?'); params.push(is_terminal) }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  params.push(req.params.id)
  db.prepare(`UPDATE pipeline_stages SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  res.json({ stage: db.prepare('SELECT * FROM pipeline_stages WHERE id = ?').get(req.params.id) })
})

// Services CRUD
app.get('/api/services', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM services WHERE is_active = 1 ORDER BY name').all()
  res.json({ services: rows.map(r => ({ ...r, fields: JSON.parse(r.fields || '[]') })) })
})
app.post('/api/services', authenticate, (req, res) => {
  if (req.user.role !== 'dono') return res.status(403).json({ error: 'Forbidden' })
  const { name, color, fields } = req.body
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' })
  const result = db.prepare('INSERT INTO services (name, color, fields) VALUES (?, ?, ?)').run(name, color || '#5DADE2', JSON.stringify(fields || []))
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(result.lastInsertRowid)
  res.json({ service: { ...svc, fields: JSON.parse(svc.fields || '[]') } })
})
app.put('/api/services/:id', authenticate, (req, res) => {
  if (req.user.role !== 'dono') return res.status(403).json({ error: 'Forbidden' })
  const { name, color, fields, is_active } = req.body
  const sets = []; const params = []
  if (name !== undefined) { sets.push('name = ?'); params.push(name) }
  if (color !== undefined) { sets.push('color = ?'); params.push(color) }
  if (fields !== undefined) { sets.push('fields = ?'); params.push(JSON.stringify(fields)) }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active) }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  params.push(req.params.id)
  db.prepare(`UPDATE services SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id)
  res.json({ service: { ...svc, fields: JSON.parse(svc.fields || '[]') } })
})

// Client services (with config)
app.get('/api/clients/:id/services', authenticate, (req, res) => {
  const rows = db.prepare('SELECT s.*, cs.config FROM services s JOIN client_services cs ON cs.service_id = s.id WHERE cs.client_id = ? AND s.is_active = 1 ORDER BY s.name').all(req.params.id)
  res.json({ services: rows.map(r => ({ ...r, config: JSON.parse(r.config || '{}') })) })
})
app.put('/api/clients/:id/services', authenticate, (req, res) => {
  if (req.user.role !== 'dono') return res.status(403).json({ error: 'Forbidden' })
  const { services } = req.body
  db.prepare('DELETE FROM client_services WHERE client_id = ?').run(req.params.id)
  if (services?.length) {
    const stmt = db.prepare('INSERT INTO client_services (client_id, service_id, config) VALUES (?, ?, ?)')
    services.forEach(s => stmt.run(req.params.id, s.id, JSON.stringify(s.config || {})))
  }
  res.json({ ok: true })
})

// Public onboard endpoints (no auth)
app.get('/api/onboard/:token', (req, res) => {
  const client = db.prepare('SELECT id, name FROM clients WHERE onboard_token = ?').get(req.params.token)
  if (!client) return res.status(404).json({ error: 'Link invalido' })
  const existing = db.prepare('SELECT id FROM client_onboard WHERE client_id = ?').get(client.id)
  res.json({ client: { id: client.id, name: client.name }, filled: !!existing })
})

app.post('/api/onboard/:token', (req, res) => {
  const client = db.prepare('SELECT id, name FROM clients WHERE onboard_token = ?').get(req.params.token)
  if (!client) return res.status(404).json({ error: 'Link invalido' })
  const { data } = req.body
  if (!data) return res.status(400).json({ error: 'Dados obrigatorios' })
  db.prepare('INSERT INTO client_onboard (client_id, data) VALUES (?, ?)').run(client.id, JSON.stringify(data))
  res.json({ ok: true })
})

// =====================================================================
// Public approvals — cliente entra sem login via token e aprova tarefas
// =====================================================================
import { broadcastSSE } from './sse.js'
import { notifyMany, getDonoUsers } from './notifications.js'

function findClientByApprovalToken(token) {
  return db.prepare('SELECT id, name, logo_url FROM clients WHERE approval_token = ? AND is_active = 1').get(token)
}

// GET — lista tarefas em aguardando_cliente do cliente (sem auth)
app.get('/api/public/approvals/:token', (req, res) => {
  const client = findClientByApprovalToken(req.params.token)
  if (!client) return res.status(404).json({ error: 'Link invalido ou revogado' })
  const tasks = db.prepare(`
    SELECT t.id, t.title, t.description, t.approval_link, t.approval_files, t.approval_text, t.publish_date, t.publish_objective,
      t.task_type, t.parent_task_id, t.subtask_kind, t.created_at, t.updated_at,
      ps.name as stage_name, ps.color as stage_color,
      cat.name as category_name, cat.color as category_color
    FROM tasks t
    LEFT JOIN pipeline_stages ps ON t.stage = ps.slug
    LEFT JOIN task_categories cat ON t.category_id = cat.id
    WHERE t.client_id = ? AND t.stage = 'aguardando_cliente' AND t.is_active = 1
    ORDER BY t.updated_at DESC
  `).all(client.id)
  // Public comments only (não internos)
  for (const t of tasks) {
    t.comments = db.prepare(`
      SELECT tc.content, tc.created_at, u.name as user_name
      FROM task_comments tc LEFT JOIN users u ON tc.user_id = u.id
      WHERE tc.task_id = ? AND tc.is_internal = 0
      ORDER BY tc.created_at
    `).all(t.id)
  }
  res.json({ client, tasks })
})

function publicApprovalAction(req, res, action) {
  const client = findClientByApprovalToken(req.params.token)
  if (!client) return res.status(404).json({ error: 'Link invalido ou revogado' })
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND client_id = ? AND stage = 'aguardando_cliente'").get(req.params.taskId, client.id)
  if (!task) return res.status(404).json({ error: 'Tarefa nao encontrada ou nao esta aguardando aprovacao' })

  const { approver_name, comment } = req.body
  if (!approver_name || !approver_name.trim()) return res.status(400).json({ error: 'Informe seu nome antes de aprovar/rejeitar' })
  if ((action === 'reject' || action === 'request-changes') && (!comment || !comment.trim())) {
    return res.status(400).json({ error: 'Descreva o motivo' })
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim()
  const ua = (req.headers['user-agent'] || '').substring(0, 200)
  const auditTag = `[Aprovacao publica · ${approver_name.trim()} · IP ${ip}]`

  let newStage, historyComment, publicCommentText, notifyTitle, notifyMsg
  if (action === 'approve') {
    newStage = 'aprovado_cliente'
    historyComment = `${auditTag} Aprovado pelo cliente`
    publicCommentText = `✓ Aprovado por ${approver_name.trim()}`
    notifyTitle = 'Cliente aprovou tarefa (link publico)'
    notifyMsg = `"${task.title}" aprovada por ${approver_name.trim()}`
  } else if (action === 'reject') {
    newStage = 'rejeitado'
    historyComment = `${auditTag} Rejeitado: ${comment}`
    publicCommentText = `✕ Rejeitado por ${approver_name.trim()}: ${comment}`
    notifyTitle = 'Cliente rejeitou tarefa (link publico)'
    notifyMsg = `"${task.title}" rejeitada por ${approver_name.trim()}: ${comment}`
  } else if (action === 'request-changes') {
    newStage = 'revisao_interna'
    historyComment = `${auditTag} Alteracao solicitada: ${comment}`
    publicCommentText = `🔄 Alteracao solicitada por ${approver_name.trim()}: ${comment}`
    notifyTitle = 'Cliente solicitou alteracao (link publico)'
    notifyMsg = `"${task.title}" — ${approver_name.trim()}: ${comment}`
  } else {
    return res.status(400).json({ error: 'Acao invalida' })
  }

  // Update stage; clear changes_requested if going back to approval; set if request-changes
  try {
    if (action === 'request-changes') {
      db.prepare("UPDATE tasks SET stage = ?, changes_requested = ?, updated_at = datetime('now', '-3 hours') WHERE id = ?").run(newStage, comment, task.id)
    } else {
      db.prepare("UPDATE tasks SET stage = ?, changes_requested = NULL, updated_at = datetime('now', '-3 hours') WHERE id = ?").run(newStage, task.id)
    }
    db.prepare('INSERT INTO task_history (task_id, from_stage, to_stage, user_id, comment) VALUES (?, ?, ?, NULL, ?)').run(task.id, task.stage, newStage, historyComment)
    // task_comments.user_id e NOT NULL — usa o primeiro dono como autor "sistema" pro registro publico
    const sysUser = db.prepare("SELECT id FROM users WHERE role = 'dono' AND is_active = 1 ORDER BY id LIMIT 1").get()
    if (sysUser) {
      db.prepare('INSERT INTO task_comments (task_id, user_id, content, is_internal) VALUES (?, ?, ?, 0)').run(task.id, sysUser.id, publicCommentText)
    }
  } catch (err) {
    console.error('[PublicApproval] DB error:', err.message)
    return res.status(500).json({ error: err.message || 'Erro ao salvar' })
  }

  console.log(`[PublicApproval] ${action} task=${task.id} client=${client.id} approver="${approver_name}" ip=${ip} ua="${ua.substring(0,40)}"`)

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)
  // SSE + notifications — best effort, nao derruba a resposta se falhar
  try {
    broadcastSSE(updated.client_id, 'task:stage_changed', updated)
    notifyMany(getDonoUsers().map(d => d.id), action === 'approve' ? 'task_approved' : action === 'reject' ? 'task_rejected' : 'task_changes_requested', notifyTitle, notifyMsg, updated.id, null)
    const assignees = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(task.id)
    assignees.forEach(a => {
      db.prepare('INSERT INTO notifications (user_id, type, title, message, task_id) VALUES (?, ?, ?, ?, ?)').run(a.user_id, action === 'approve' ? 'task_approved' : action === 'reject' ? 'task_rejected' : 'task_changes_requested', notifyTitle, notifyMsg, updated.id)
    })
  } catch (err) {
    console.error('[PublicApproval] notify error (ignored):', err.message)
  }

  res.json({ ok: true, task: updated })
}

app.post('/api/public/approvals/:token/:taskId/approve', (req, res) => publicApprovalAction(req, res, 'approve'))
app.post('/api/public/approvals/:token/:taskId/reject', (req, res) => publicApprovalAction(req, res, 'reject'))
app.post('/api/public/approvals/:token/:taskId/request-changes', (req, res) => publicApprovalAction(req, res, 'request-changes'))

// Serve frontend (production)
const distPath = resolve(__dirname, '../dist')
import { readFileSync } from 'fs'
let indexHtml = ''
try { indexHtml = readFileSync(resolve(distPath, 'index.html'), 'utf-8') } catch {}

app.use(express.static(distPath, { etag: false, maxAge: 0, setHeaders: (res, path) => {
  if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  else if (path.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
}}))

// Dynamic OG tags for onboard links (WhatsApp preview)
app.get('/onboard/:token', (req, res) => {
  if (!indexHtml) return res.sendFile(resolve(distPath, 'index.html'))
  const client = db.prepare('SELECT name FROM clients WHERE onboard_token = ?').get(req.params.token)
  const name = client ? client.name : 'Cliente'
  const html = indexHtml
    .replace('<title>Dros Hub</title>', `<title>Formulario de Entrada — ${name}</title>`)
    .replace('content="Dros Hub — Gestao de Projetos"', `content="Formulario de Entrada — ${name}"`)
    .replace('content="Plataforma interna da Dros Agencia para gestao de projetos, aprovacoes e entregas."', `content="Preencha o formulario de entrada da ${name} para comecarmos o trabalho."`)
  res.send(html)
})

app.get('/{*path}', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.sendFile(resolve(distPath, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`[Dros Hub API] Running on http://localhost:${PORT}`)

  // One-time: importa tokens do .env pro DB se ainda nao tem (assim aba Tokens
  // ja aparece preenchida no primeiro acesso)
  try { seedSettingsFromEnv() } catch (e) { console.error('[settings] seed falhou:', e.message) }

  // Server-side timer check — every 1 hora
  // Pergunta "ainda esta produzindo?" a cada 1h de timer rodando
  const TIMER_CHECK_SECONDS = 3600 // 1 hora
  setInterval(() => {
    const activeTimers = db.prepare('SELECT te.*, t.title as task_title FROM time_entries te JOIN tasks t ON te.task_id = t.id WHERE te.ended_at IS NULL').all()
    for (const timer of activeTimers) {
      const startedAt = new Date(timer.started_at + '-03:00').getTime()
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      // Guarda: so dispara depois de pelo menos 1 intervalo cheio decorrido
      // (sem isso, qualquer timer com elapsed entre 0-60s tambem batia)
      if (elapsed >= TIMER_CHECK_SECONDS && elapsed % TIMER_CHECK_SECONDS < 60) {
        sendToUser(timer.user_id, 'timer:check', { taskId: timer.task_id, taskTitle: timer.task_title, elapsed })
      }
    }
  }, 30000) // Check every 30 seconds

  // Recurring task scheduler — a cada 5min, executa templates cujo next_run_at <= agora
  setInterval(() => {
    try {
      const created = runDueTemplates()
      if (created.length > 0) console.log(`[Recurring] criadas ${created.length} tarefa(s) dos templates:`, created)
    } catch (err) {
      console.error('[Recurring scheduler]', err.message)
    }
  }, 5 * 60 * 1000)
})
