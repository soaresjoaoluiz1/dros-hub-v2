// Rotas compat com os componentes do Core que foram espelhados no Hub.
// Suportam: personalizacao de dashboard, sync manual Meta, cache clear, publicacao publica.
// Persistencia usa tabela dashboard_config (criada aqui idempotente).

import { Router } from 'express'
import db from '../db.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()

// IMPORTANTE: NAO usar router.use(authenticate) global — Express roda middlewares
// do router mesmo em requests que caem em rotas irmas do mesmo prefixo /api/.
// Aplicamos authenticate INLINE em cada rota abaixo, garantindo que /api/public/*
// (rotas publicas registradas com app.get) fiquem livres do middleware.

// Tabela pra guardar config personalizada por conta Meta (accountId = string do id da conta Meta)
db.exec(`
  CREATE TABLE IF NOT EXISTS dashboard_config (
    account_id  TEXT PRIMARY KEY,
    config      TEXT NOT NULL,
    public_slug TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
  )
`)

// ─── Config de dashboard ─────────────────────────────────────
// GET config atual
router.get('/dashboard/config/:accountId', authenticate, (req, res) => {
  const row = db.prepare('SELECT config, public_slug FROM dashboard_config WHERE account_id = ?').get(req.params.accountId)
  if (!row) return res.json({ config: null, public_slug: null })
  let config
  try { config = JSON.parse(row.config) } catch { config = null }
  res.json({ config, public_slug: row.public_slug })
})

// PUT config (upsert)
router.put('/dashboard/config/:accountId', authenticate, (req, res) => {
  const cfg = JSON.stringify(req.body?.config ?? req.body ?? {})
  db.prepare(`
    INSERT INTO dashboard_config (account_id, config, updated_at)
    VALUES (?, ?, datetime('now', '-3 hours'))
    ON CONFLICT(account_id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at
  `).run(req.params.accountId, cfg)
  res.json({ ok: true })
})

// Publicar (gera slug simples). NAO expoe rota publica ainda — so guarda o slug.
router.post('/dashboard/config/:accountId/publish', authenticate, (req, res) => {
  const slug = Math.random().toString(36).slice(2, 10)
  db.prepare(`
    INSERT INTO dashboard_config (account_id, config, public_slug, updated_at)
    VALUES (?, '{}', ?, datetime('now', '-3 hours'))
    ON CONFLICT(account_id) DO UPDATE SET public_slug = excluded.public_slug, updated_at = excluded.updated_at
  `).run(req.params.accountId, slug)
  res.json({ slug })
})

// Despublicar
router.delete('/dashboard/config/:accountId/publish', authenticate, (req, res) => {
  db.prepare('UPDATE dashboard_config SET public_slug = NULL, updated_at = datetime(\'now\', \'-3 hours\') WHERE account_id = ?').run(req.params.accountId)
  res.json({ ok: true })
})

// ─── Meta sync stub ──────────────────────────────────────────
// O Hub nao mantem cache de insights Meta (bate direto na API a cada req),
// entao sync eh no-op. Retorna sucesso pra UI nao dar erro no botao.
router.post('/meta/sync/:accountId', authenticate, (req, res) => {
  res.json({ ok: true, synced: 0, message: 'Hub nao usa cache, sync no-op' })
})

// Status do cache — retorna sempre 'live' (sem cache)
router.get('/meta/cached/accounts/:accountId/status', authenticate, (req, res) => {
  res.json({ from: 'live', updated: null })
})

// Cache clear no-op
router.post('/cache/clear', authenticate, (req, res) => {
  res.json({ ok: true, cleared: 0 })
})

// Hub refresh no-op (era pra Core puxar do Hub — nao se aplica dentro do Hub)
router.post('/hub/refresh', authenticate, (req, res) => {
  res.json({ ok: true })
})

export default router
