// =====================================================================
// Configuracoes globais (tokens, integracoes).
// Lista canonica de chaves esta em KNOWN_KEYS — define quais sao secrets
// e como aparecem no UI. Routes sao dono-only.
//
// getSetting(key) — helper exportado pra outros modulos (performance.js)
//                   lerem token do DB com fallback pro process.env.
// =====================================================================

import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

// Lista canonica das chaves gerenciaveis. Define a ordem que aparece no UI,
// se eh secret, label amigavel, e instrucoes pra obter.
export const KNOWN_KEYS = [
  // Meta / Instagram
  {
    key: 'META_ACCESS_TOKEN',
    label: 'Meta Access Token',
    is_secret: true,
    group: 'Meta / Instagram',
    description: 'Token de acesso Meta Ads / Instagram. Vence em 60 dias (User token) ou nunca (System User token).',
    howto: [
      'Acesse https://developers.facebook.com/tools/explorer/',
      'Selecione o app "Cloude_app_DROS" no topo',
      '"Usuario ou Pagina" -> "Obter token de acesso do usuario"',
      'Marque permissoes: ads_read, ads_management, business_management, pages_show_list, pages_read_engagement, instagram_basic',
      'Copie o token gerado (curto, 1-2h)',
      'Pra estender pra 60 dias, rode: curl "https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id={APP_ID}&client_secret={APP_SECRET}&fb_exchange_token={TOKEN_CURTO}"',
      'Cole o access_token longo aqui.',
      'Alternativa permanente: gerar System User Token em business.facebook.com -> Configuracoes -> Usuarios do sistema (nao vence).',
    ],
  },

  // Google Ads (mesmas credenciais OAuth tambem cobrem GA4 — escopos analytics.readonly + adwords no fluxo OAuth)
  {
    key: 'GOOGLE_ADS_DEVELOPER_TOKEN',
    label: 'Google Ads Developer Token',
    is_secret: true,
    group: 'Google Ads + GA4',
    description: 'Developer token da conta MCC do Google Ads.',
    howto: [
      'Acesse https://ads.google.com/aw/apicenter (com a conta MCC logada)',
      'Copie o "Developer Token". Status precisa ser "Approved" ou "Test Account".',
    ],
  },
  {
    key: 'GOOGLE_ADS_CLIENT_ID',
    label: 'OAuth Client ID (Google)',
    is_secret: false,
    group: 'Google Ads + GA4',
    description: 'Client ID OAuth 2.0 (Google Cloud Console). Usado pra GAds E GA4.',
    howto: [
      'Acesse https://console.cloud.google.com/apis/credentials',
      'Crie credencial "OAuth 2.0 Client ID" tipo "Web application"',
      'Adicione scopes: adwords + analytics.readonly',
      'Copie o Client ID (termina em .apps.googleusercontent.com)',
    ],
  },
  {
    key: 'GOOGLE_ADS_CLIENT_SECRET',
    label: 'OAuth Client Secret (Google)',
    is_secret: true,
    group: 'Google Ads + GA4',
    description: 'Client Secret do mesmo OAuth 2.0 acima.',
    howto: ['No mesmo lugar do Client ID, copie o Client Secret (lado direito).'],
  },
  {
    key: 'GOOGLE_ADS_REFRESH_TOKEN',
    label: 'OAuth Refresh Token (Google)',
    is_secret: true,
    group: 'Google Ads + GA4',
    description: 'Refresh Token gerado via OAuth flow. Cobre GAds + GA4 (multi-scope).',
    howto: [
      'Use OAuth Playground (https://developers.google.com/oauthplayground/)',
      'Settings (engrenagem) -> marque "Use your own OAuth credentials" e cole Client ID/Secret',
      'Scopes (ambos): https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/analytics.readonly',
      'Autorize -> "Exchange authorization code for tokens" -> copie Refresh Token',
    ],
  },
  {
    key: 'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
    label: 'Google Ads MCC Customer ID',
    is_secret: false,
    group: 'Google Ads + GA4',
    description: 'ID da conta MCC (gerenciadora) sem tracos. Ex: 1234567890.',
    howto: [
      'No Google Ads, canto superior direito mostra o ID da conta MCC.',
      'Remova os tracos (ex: 123-456-7890 vira 1234567890).',
    ],
  },
]

const KEY_INDEX = Object.fromEntries(KNOWN_KEYS.map(k => [k.key, k]))

// Mascara valores sensiveis: '****' + ultimos 4 chars (se >= 4 caracteres)
function maskSecret(value) {
  if (!value) return ''
  if (value.length <= 4) return '****'
  return '****' + value.slice(-4)
}

// Helper interno e exportado: pega valor de uma chave, ou fallback no env.
// Usado por performance.js pra ler tokens.
export function getSetting(key) {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)
    if (row && row.value && row.value.trim()) return row.value
  } catch {}
  return process.env[key] || null
}

// Seed one-time: pra cada chave KNOWN_KEYS, se DB nao tem entry E .env tem
// valor configurado, importa pro DB. Roda no startup do server. Idempotente:
// nao sobrescreve nada ja preenchido no DB.
export function seedSettingsFromEnv() {
  const existing = new Set(db.prepare('SELECT key FROM app_settings').all().map(r => r.key))
  const insertStmt = db.prepare(`
    INSERT INTO app_settings (key, value, is_secret, updated_at, updated_by)
    VALUES (?, ?, ?, datetime('now', '-3 hours'), NULL)
  `)
  let imported = 0
  for (const k of KNOWN_KEYS) {
    if (existing.has(k.key)) continue
    const envValue = process.env[k.key]
    if (envValue && envValue.trim()) {
      insertStmt.run(k.key, envValue, k.is_secret ? 1 : 0)
      imported++
    }
  }
  if (imported > 0) console.log(`[settings] seed inicial: ${imported} chaves importadas do .env`)
}

// GET / — lista todas as chaves conhecidas (com value mascarado se secret).
router.get('/', requireRole('dono'), (req, res) => {
  const rows = db.prepare('SELECT key, value, is_secret, updated_at FROM app_settings').all()
  const dbValues = Object.fromEntries(rows.map(r => [r.key, r]))

  const settings = KNOWN_KEYS.map(k => {
    const stored = dbValues[k.key]
    const rawValue = stored?.value || ''
    const isConfiguredEnv = !rawValue && process.env[k.key] ? true : false
    return {
      key: k.key,
      label: k.label,
      group: k.group,
      description: k.description,
      howto: k.howto,
      is_secret: k.is_secret ? 1 : 0,
      value: k.is_secret ? maskSecret(rawValue) : rawValue,
      has_value: !!rawValue,
      from_env_fallback: isConfiguredEnv, // sinaliza se o token tah no .env mas nao no DB
      updated_at: stored?.updated_at || null,
    }
  })

  res.json({ settings })
})

// PUT /:key — atualiza valor. Aceita string vazia pra limpar.
router.put('/:key', requireRole('dono'), (req, res) => {
  const { key } = req.params
  const def = KEY_INDEX[key]
  if (!def) return res.status(400).json({ error: 'Chave desconhecida: ' + key })

  const value = (req.body?.value ?? '').toString()
  const isSecret = def.is_secret ? 1 : 0
  const userId = req.user.id

  db.prepare(`
    INSERT INTO app_settings (key, value, is_secret, updated_at, updated_by)
    VALUES (?, ?, ?, datetime('now', '-3 hours'), ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      is_secret = excluded.is_secret,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(key, value, isSecret, userId)

  res.json({ ok: true, key, has_value: !!value })
})

export default router
