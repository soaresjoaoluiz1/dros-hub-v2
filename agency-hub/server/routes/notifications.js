import { Router } from 'express'
import db from '../db.js'

const router = Router()

router.get('/', (req, res) => {
  const { page = '1', limit = '20', unread_only } = req.query
  const where = ['n.user_id = ?']; const params = [req.user.id]
  if (unread_only === '1') { where.push('n.is_read = 0') }
  const total = db.prepare(`SELECT COUNT(*) as c FROM notifications n WHERE ${where.join(' AND ')}`).get(...params).c
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const notifications = db.prepare(`
    SELECT n.*, u.name as triggered_by_name, t.title as task_title
    FROM notifications n LEFT JOIN users u ON n.triggered_by = u.id LEFT JOIN tasks t ON n.task_id = t.id
    WHERE ${where.join(' AND ')} ORDER BY n.is_read ASC, n.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset)
  res.json({ notifications, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) })
})

router.get('/unread-count', (req, res) => {
  const { count } = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id)
  res.json({ count })
})

router.put('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id)
  res.json({ ok: true })
})

router.put('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(req.user.id)
  res.json({ ok: true })
})

export default router
