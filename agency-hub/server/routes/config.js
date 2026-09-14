// =====================================================================
// /api/config/* — endpoints server-to-server pro /core consumir do Hub.
//
// Autenticacao: header X-Core-Secret precisa bater com CORE_EMBED_SECRET
// (chave compartilhada entre Hub e /core — mesma var que ja existe pro
// fluxo de auto-login no iframe).
//
// Endpoints:
//   GET /api/config/tokens     — tokens em claro pro /core usar nas APIs
//   GET /api/config/clients    — lista de clientes do painel + nomes Meta
//                                pra /core substituir ALLOWED_CLIENTS hardcoded
// =====================================================================

import { Router } from 'express'
import db from '../db.js'
import { getSetting, KNOWN_KEYS } from './settings.js'

const router = Router()

const CORE_EMBED_SECRET = process.env.CORE_EMBED_SECRET || 'dros-core-embed-2026-shared-key'

// Middleware: aceita acesso so com X-Core-Secret correto.
function requireCoreSecret(req, res, next) {
  const provided = req.headers['x-core-secret']
  if (!provided || provided !== CORE_EMBED_SECRET) {
    return res.status(401).json({ error: 'Invalid core secret' })
  }
  next()
}

// GET /api/config/tokens — tokens em claro
// Lista mesmos campos do GET /api/settings, mas com valores reais
// (pra /core poder usar nas chamadas Meta/Google/etc).
router.get('/tokens', requireCoreSecret, (req, res) => {
  const tokens = {}
  for (const k of KNOWN_KEYS) {
    const v = getSetting(k.key)
    if (v) tokens[k.key] = v
  }
  res.json({ tokens })
})

// GET /api/config/clients — lista clientes ativos com pelo menos 1 core_*_id
// Usado pelo /core pra substituir ALLOWED_CLIENTS hardcoded.
// Retorna nomes + IDs - /core compara isso com os accounts da Meta API.
router.get('/clients', requireCoreSecret, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, slug,
           core_client_name, core_meta_account_id, core_ig_page_id,
           core_gads_customer_id, core_ga4_property_id
    FROM clients
    WHERE is_active = 1
      AND (core_meta_account_id IS NOT NULL OR core_ig_page_id IS NOT NULL
           OR core_gads_customer_id IS NOT NULL OR core_ga4_property_id IS NOT NULL)
    ORDER BY name
  `).all()
  res.json({ clients: rows })
})

export default router
