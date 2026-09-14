import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

router.get('/', (req, res) => {
  const departments = db.prepare(`
    SELECT d.*, (SELECT COUNT(*) FROM user_departments WHERE department_id = d.id) as employee_count,
    (SELECT COUNT(*) FROM tasks WHERE department_id = d.id AND is_active = 1) as task_count
    FROM departments d WHERE d.is_active = 1 ORDER BY d.name
  `).all()
  res.json({ departments })
})

router.post('/', requireRole('dono', 'gerente'), (req, res) => {
  const { name, color } = req.body
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' })
  try {
    const result = db.prepare('INSERT INTO departments (name, color) VALUES (?, ?)').run(name, color || '#FFB300')
    res.json({ department: db.prepare('SELECT * FROM departments WHERE id = ?').get(result.lastInsertRowid) })
  } catch { res.status(400).json({ error: 'Departamento ja existe' }) }
})

router.put('/:id', requireRole('dono', 'gerente'), (req, res) => {
  const { name, color, is_active } = req.body
  const sets = []; const params = []
  if (name !== undefined) { sets.push('name = ?'); params.push(name) }
  if (color !== undefined) { sets.push('color = ?'); params.push(color) }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0) }
  if (!sets.length) return res.status(400).json({ error: 'Nada pra atualizar' })
  params.push(req.params.id)
  db.prepare(`UPDATE departments SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  res.json({ department: db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id) })
})

export default router
