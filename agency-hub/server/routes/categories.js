import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

router.get('/', (req, res) => {
  res.json({ categories: db.prepare('SELECT * FROM task_categories WHERE is_active = 1 ORDER BY name').all() })
})

router.post('/', requireRole('dono', 'gerente'), (req, res) => {
  const { name, color } = req.body
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' })
  try {
    const result = db.prepare('INSERT INTO task_categories (name, color) VALUES (?, ?)').run(name, color || '#5DADE2')
    res.json({ category: db.prepare('SELECT * FROM task_categories WHERE id = ?').get(result.lastInsertRowid) })
  } catch { res.status(400).json({ error: 'Categoria ja existe' }) }
})

router.put('/:id', requireRole('dono', 'gerente'), (req, res) => {
  const { name, color, is_active } = req.body
  const sets = []; const params = []
  if (name !== undefined) { sets.push('name = ?'); params.push(name) }
  if (color !== undefined) { sets.push('color = ?'); params.push(color) }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0) }
  if (!sets.length) return res.status(400).json({ error: 'Nada pra atualizar' })
  params.push(req.params.id)
  db.prepare(`UPDATE task_categories SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  res.json({ category: db.prepare('SELECT * FROM task_categories WHERE id = ?').get(req.params.id) })
})

export default router
