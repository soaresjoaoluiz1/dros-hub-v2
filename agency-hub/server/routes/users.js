import { Router } from 'express'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

router.get('/', requireRole('dono', 'gerente', 'funcionario'), (req, res) => {
  const { role, client_id, department_id } = req.query
  let sql = `SELECT u.id, u.client_id, u.name, u.email, u.role, u.is_active, u.created_at,
    c.name as client_name FROM users u LEFT JOIN clients c ON u.client_id = c.id WHERE 1=1`
  const params = []
  if (role) { sql += ' AND u.role = ?'; params.push(role) }
  if (client_id) { sql += ' AND u.client_id = ?'; params.push(client_id) }
  if (department_id) { sql += ' AND u.id IN (SELECT user_id FROM user_departments WHERE department_id = ?)'; params.push(department_id) }
  sql += ' ORDER BY u.name'
  const users = db.prepare(sql).all(...params)
  // Attach departments
  const deptStmt = db.prepare('SELECT d.id, d.name, d.color FROM user_departments ud JOIN departments d ON ud.department_id = d.id WHERE ud.user_id = ?')
  for (const u of users) u.departments = deptStmt.all(u.id)
  res.json({ users })
})

router.post('/', requireRole('dono', 'gerente'), (req, res) => {
  const { name, email, password, role, client_id } = req.body
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'Campos obrigatorios: name, email, password, role' })
  if (req.user.role === 'gerente' && role === 'dono') return res.status(403).json({ error: 'Gerente nao pode criar dono' })
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return res.status(400).json({ error: 'Email ja cadastrado' })
  const cid = role === 'cliente' ? (client_id || null) : null
  const result = db.prepare('INSERT INTO users (name, email, password, role, client_id) VALUES (?, ?, ?, ?, ?)').run(name, email, bcrypt.hashSync(password, 10), role, cid)
  const user = db.prepare('SELECT id, name, email, role, client_id, is_active FROM users WHERE id = ?').get(result.lastInsertRowid)
  res.json({ user })
})

router.put('/:id', requireRole('dono', 'gerente'), (req, res) => {
  const { name, is_active, password, client_id, role } = req.body
  const sets = []; const params = []

  if (role !== undefined) {
    const validRoles = ['dono', 'gerente', 'funcionario', 'cliente']
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Role invalido' })
    // Gerente nao pode promover/criar dono nem rebaixar dono existente
    if (req.user.role === 'gerente') {
      if (role === 'dono') return res.status(403).json({ error: 'Gerente nao pode promover a dono' })
      const target = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id)
      if (target?.role === 'dono') return res.status(403).json({ error: 'Gerente nao pode mudar role de dono' })
    }
    sets.push('role = ?'); params.push(role)
  }

  if (name !== undefined) { sets.push('name = ?'); params.push(name) }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0) }
  if (password) { sets.push('password = ?'); params.push(bcrypt.hashSync(password, 10)) }
  if (client_id !== undefined) { sets.push('client_id = ?'); params.push(client_id) }
  if (!sets.length) return res.status(400).json({ error: 'Nada pra atualizar' })
  sets.push("updated_at = datetime('now', '-3 hours')"); params.push(req.params.id)
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  res.json({ user: db.prepare('SELECT id, name, email, role, client_id, is_active FROM users WHERE id = ?').get(req.params.id) })
})

// Set departments for a user
router.put('/:id/departments', requireRole('dono', 'gerente'), (req, res) => {
  const { department_ids } = req.body
  if (!Array.isArray(department_ids)) return res.status(400).json({ error: 'department_ids array required' })
  db.prepare('DELETE FROM user_departments WHERE user_id = ?').run(req.params.id)
  const stmt = db.prepare('INSERT INTO user_departments (user_id, department_id) VALUES (?, ?)')
  for (const deptId of department_ids) stmt.run(req.params.id, deptId)
  res.json({ ok: true })
})

router.delete('/:id', requireRole('dono', 'gerente'), (req, res) => {
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router
