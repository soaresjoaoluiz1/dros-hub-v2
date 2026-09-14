import { Router } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { authenticate, JWT_SECRET } from '../middleware/auth.js'

const router = Router()

const loginAttempts = new Map()
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress
  const now = Date.now()
  const attempts = (loginAttempts.get(ip) || []).filter(t => now - t < 60000)
  if (attempts.length >= 10) return res.status(429).json({ error: 'Muitas tentativas. Tente em 1 minuto.' })
  attempts.push(now); loginAttempts.set(ip, attempts); next()
}

router.post('/login', rateLimit, (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatorios' })
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email)
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Credenciais invalidas' })
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role, client_id: user.client_id }, JWT_SECRET, { expiresIn: '7d' })
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, client_id: user.client_id } })
})

router.get('/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT id, email, name, role, client_id, avatar_url FROM users WHERE id = ?').get(req.user.id)
  if (!user) return res.status(401).json({ error: 'User not found' })
  res.json({ user })
})

router.post('/logout', (_req, res) => res.json({ ok: true }))

export default router
