// =====================================================================
// Performance routes — migracao do /core (Painel Performance) pra dentro do Hub
//
// Filtro por role:
//  - Admin (dono/gerente/funcionario): ve TODAS as contas Meta/IG/GAds/GA4
//    (vinculo por cliente e feito por ID no cadastro do cliente)
//  - Cliente: so ve a conta com ID exato vinculado em clients.core_*_id
//
// O /core continua rodando paralelo (porta 3004) — esta migracao duplica a logica.
// Quando ajustar uma das duas, lembrar de espelhar a outra.
// =====================================================================

import express from 'express'
import db from '../db.js'
import { getSetting } from './settings.js'

// Polyfill fetch para Node 16
if (!globalThis.fetch) {
  const mod = await import('node-fetch')
  globalThis.fetch = mod.default
}

const router = express.Router()
const publicRouter = express.Router()

// IMPORTANTE: tokens lidos lazy. Prioridade: app_settings (DB) -> process.env
// (fallback). Permite admin trocar token sem reiniciar processo.
// Kiwify nao esta na UI Settings (le so do .env, deixa como estava).
const getMetaToken = () => getSetting('META_ACCESS_TOKEN')
const getKiwifyClientId = () => process.env.KIWIFY_CLIENT_ID
const getKiwifyClientSecret = () => process.env.KIWIFY_CLIENT_SECRET
const getKiwifyAccountId = () => process.env.KIWIFY_ACCOUNT_ID
const META_BASE = 'https://graph.facebook.com/v21.0'
const GADS_API = 'https://googleads.googleapis.com/v22'
const GA4_API = 'https://analyticsdata.googleapis.com/v1beta'

// =====================================================================
// Role/scope helpers
// =====================================================================
// Retorna o "escopo" do cliente logado:
//   - admin (dono/gerente/funcionario): null  → ve tudo
//   - cliente: { name, metaId, igId, gadsId, ga4PropertyId } → ve so o vinculo
function getClientScope(user) {
  if (!user || user.role !== 'cliente') return null
  const row = db.prepare(`
    SELECT core_client_name, core_meta_account_id, core_ig_page_id, core_gads_customer_id, core_ga4_property_id
    FROM clients WHERE id = ?
  `).get(user.client_id)
  return {
    name: (row?.core_client_name || '').trim(),
    metaId: row?.core_meta_account_id || null,
    igId: row?.core_ig_page_id || null,
    gadsId: row?.core_gads_customer_id || null,
    ga4PropertyId: row?.core_ga4_property_id || null,
  }
}

// Para rotas com ?name=X: cliente nao pode escolher — forca o name dele.
function resolveAccountName(req) {
  const scope = getClientScope(req.user)
  if (scope !== null) return scope.name
  return req.query.name || ''
}

// =====================================================================
// Meta API helpers
// =====================================================================
async function metaFetch(path, params = {}) {
  const url = new URL(`${META_BASE}${path}`)
  url.searchParams.set('access_token', getMetaToken())
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  const resp = await fetch(url.toString())
  const data = await resp.json()
  if (data.error) throw new Error(data.error.message || 'Meta API error')
  return data
}

function fmtDate(date) {
  return date.toISOString().split('T')[0]
}

function getDateRanges(days, since, until) {
  if (since && until) {
    const start = new Date(since + 'T00:00:00')
    const end = new Date(until + 'T00:00:00')
    const diffDays = Math.ceil((end - start) / 86400000) + 1
    const prevEnd = new Date(start)
    prevEnd.setDate(prevEnd.getDate() - 1)
    const prevStart = new Date(prevEnd)
    prevStart.setDate(prevStart.getDate() - diffDays + 1)
    return {
      current: { since: fmtDate(start), until: fmtDate(end) },
      previous: { since: fmtDate(prevStart), until: fmtDate(prevEnd) },
    }
  }
  const now = new Date()
  const end = new Date(now)
  end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(start.getDate() - days + 1)
  const prevEnd = new Date(start)
  prevEnd.setDate(prevEnd.getDate() - 1)
  const prevStart = new Date(prevEnd)
  prevStart.setDate(prevStart.getDate() - days + 1)
  return {
    current: { since: fmtDate(start), until: fmtDate(end) },
    previous: { since: fmtDate(prevStart), until: fmtDate(prevEnd) },
  }
}

// =====================================================================
// Quais plataformas estao disponiveis pra este usuario
// Frontend usa pra esconder abas que nao foram vinculadas
// =====================================================================
router.get('/my-scope', (req, res) => {
  const scope = getClientScope(req.user)
  if (scope === null) {
    return res.json({ meta: true, ig: true, gads: true, ga4: true, isAdmin: true, name: '' })
  }
  res.json({
    meta: !!scope.metaId,
    ig: !!scope.igId,
    gads: !!scope.gadsId,
    ga4: !!scope.ga4PropertyId,
    isAdmin: false,
    name: scope.name || '',
  })
})

// =====================================================================
// META ADS ROUTES
// =====================================================================

// Lista contas de ad — filtra por role
router.get('/meta/accounts', async (req, res) => {
  try {
    if (!getMetaToken()) return res.status(500).json({ error: 'META_ACCESS_TOKEN nao configurado no .env do Hub' })
    const scope = getClientScope(req.user)
    let allAccounts = []
    let url = `${META_BASE}/me/adaccounts?fields=id,name,account_status,currency,amount_spent&limit=100&access_token=${getMetaToken()}`
    while (url) {
      const resp = await fetch(url)
      const data = await resp.json()
      if (data.error) {
        console.error('[Performance/Meta] /me/adaccounts error:', data.error)
        return res.status(400).json({ error: data.error.message || 'Meta API error' })
      }
      allAccounts = allAccounts.concat(data.data || [])
      url = data.paging?.next || null
    }
    // Filtragem:
    //   - admin (scope=null): TODAS as contas ativas (vinculo agora e por ID no cadastro)
    //   - cliente com metaId: so a conta com aquele ID exato
    //   - cliente sem metaId: nenhuma (cliente nao vinculado nao ve dados de Meta)
    const filtered = allAccounts
      .filter((a) => {
        if (![1, 2, 3].includes(a.account_status)) return false
        if (scope === null) return true
        return scope.metaId ? a.id === scope.metaId : false
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    res.json({ accounts: filtered })
  } catch (err) {
    console.error('[Performance/Meta] /meta/accounts:', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/meta/accounts/:accountId/insights/compare', async (req, res) => {
  try {
    const { accountId } = req.params
    const { days = '30', level = 'account', since, until } = req.query
    const ranges = getDateRanges(parseInt(days), since, until)
    const fields = 'spend,impressions,clicks,cpc,cpm,ctr,reach,frequency,actions,cost_per_action_type,action_values'
    const levelFields = level === 'campaign' ? `campaign_id,campaign_name,${fields}` : fields
    const [current, previous] = await Promise.all([
      metaFetch(`/${accountId}/insights`, { fields: levelFields, time_range: JSON.stringify(ranges.current), level, limit: '500' }).catch(() => ({ data: [] })),
      metaFetch(`/${accountId}/insights`, { fields: levelFields, time_range: JSON.stringify(ranges.previous), level, limit: '500' }).catch(() => ({ data: [] })),
    ])
    res.json({ current: current.data || [], previous: previous.data || [], ranges })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/meta/accounts/:accountId/insights/daily-compare', async (req, res) => {
  try {
    const { accountId } = req.params
    const { days = '30', since, until } = req.query
    const ranges = getDateRanges(parseInt(days), since, until)
    const fields = 'spend,impressions,clicks,cpc,ctr,reach,actions,action_values'
    const [current, previous] = await Promise.all([
      metaFetch(`/${accountId}/insights`, { fields, time_range: JSON.stringify(ranges.current), time_increment: '1', limit: '100' }).catch(() => ({ data: [] })),
      metaFetch(`/${accountId}/insights`, { fields, time_range: JSON.stringify(ranges.previous), time_increment: '1', limit: '100' }).catch(() => ({ data: [] })),
    ])
    res.json({ current: current.data || [], previous: previous.data || [], ranges })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/meta/accounts/:accountId/campaigns', async (req, res) => {
  try {
    const { accountId } = req.params
    const data = await metaFetch(`/${accountId}/campaigns`, {
      fields: 'id,name,status,objective,daily_budget,lifetime_budget,effective_status,start_time,created_time',
      limit: '100',
    })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// =====================================================================
// INSTAGRAM ROUTES
// =====================================================================

router.get('/instagram/accounts', async (req, res) => {
  try {
    if (!getMetaToken()) return res.status(500).json({ error: 'META_ACCESS_TOKEN nao configurado no .env do Hub' })
    const scope = getClientScope(req.user)
    let allPages = []
    let url = `${META_BASE}/me/accounts?fields=id,name,instagram_business_account{id,name,username,followers_count,follows_count,media_count,profile_picture_url}&limit=100&access_token=${getMetaToken()}`
    while (url) {
      const resp = await fetch(url)
      const data = await resp.json()
      if (data.error) {
        console.error('[Performance/IG] /me/accounts error:', data.error)
        return res.status(400).json({ error: data.error.message || 'Meta API error' })
      }
      allPages = allPages.concat(data.data || [])
      url = data.paging?.next || null
    }
    // Filtragem:
    //   - admin: TODAS as pages com IG vinculado
    //   - cliente com igPageId: so a page com aquele ID
    //   - cliente sem igPageId: nenhuma
    const igAccounts = allPages
      .filter((p) => {
        if (!p.instagram_business_account) return false
        if (scope === null) return true
        return scope.igId ? p.id === scope.igId : false
      })
      .map((p) => ({ pageId: p.id, pageName: p.name, ...p.instagram_business_account }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    res.json({ accounts: igAccounts })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/instagram/:igId/profile', async (req, res) => {
  try {
    const data = await metaFetch(`/${req.params.igId}`, {
      fields: 'id,name,username,followers_count,follows_count,media_count,profile_picture_url,biography',
    })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/instagram/:igId/insights', async (req, res) => {
  try {
    const { igId } = req.params
    const { days = '7', since, until } = req.query
    const d = parseInt(days)
    const ranges = getDateRanges(d, since, until)
    const toUnix = (dateStr) => Math.floor(new Date(dateStr + 'T00:00:00').getTime() / 1000)

    async function fetchPeriod(range) {
      const sinceU = String(toUnix(range.since))
      const untilU = String(toUnix(range.until) + 86400)
      const [dailyReach, dailyFollowers, totals] = await Promise.all([
        metaFetch(`/${igId}/insights`, { metric: 'reach', period: 'day', since: sinceU, until: untilU }).catch(() => ({ data: [] })),
        metaFetch(`/${igId}/insights`, { metric: 'follower_count', period: 'day', since: sinceU, until: untilU }).catch(() => ({ data: [] })),
        metaFetch(`/${igId}/insights`, { metric: 'profile_views,total_interactions,accounts_engaged,likes,comments,shares,saves', metric_type: 'total_value', period: 'day', since: sinceU, until: untilU }).catch(() => ({ data: [] })),
      ])
      const result = {}
      const dailyData = {}
      for (const dataset of [dailyReach, dailyFollowers]) {
        for (const m of (dataset.data || [])) {
          const values = m.values || []
          result[m.name] = values.reduce((sum, v) => sum + (v.value || 0), 0)
          dailyData[m.name] = values.map((v) => ({ date: v.end_time?.split('T')[0], value: v.value || 0 }))
        }
      }
      for (const m of (totals.data || [])) {
        const val = m.total_value?.value || 0
        result[m.name] = val
      }
      return { totals: result, daily: dailyData }
    }

    const [current, previous] = await Promise.all([fetchPeriod(ranges.current), fetchPeriod(ranges.previous)])
    res.json({ current, previous, ranges })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/instagram/:igId/media', async (req, res) => {
  try {
    const { igId } = req.params
    const { limit = '20' } = req.query
    const data = await metaFetch(`/${igId}/media`, {
      fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
      limit,
    })
    res.json({ data: (data.data || []).map(m => ({ ...m, insights: {} })) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// =====================================================================
// CRM (Google Sheets) helpers + routes
// =====================================================================
const CRM_SHEETS = {
  'invista': { id: '1XOKIFDn9HwbWFHrI7tQovV-Vvrk9DqbdA8Skrmr1R4Q', type: 'invista' },
  'kellermann': { id: '1am9NoQoCuIkyAAj4H4QnEnOgWCFSf669wtLVU2EwLko', type: 'kellermann' },
  'sameco': { id: '1u4EnAU1Mqhi4ZqulnI3sYU5-wWkuqo9R67QtJ-usWaY', type: 'sameco' },
  'ludus': { id: '1quQYCC86UGZqx8Cf1uuSoIamm29IgcTfCnwrscFsSOs', type: 'ludus' },
  'bg imob': { id: '1dZjSUqcZJ_4IDyXhRrY9i9GcJvqxCLYp3YTl7Ij45zY', type: 'bgimob' },
  'bg im': { id: '1dZjSUqcZJ_4IDyXhRrY9i9GcJvqxCLYp3YTl7Ij45zY', type: 'bgimob' },
  'fernando correa': { id: '1Eg5qp_3ErytuayQwMinKBjB0emBFoC11veiSdlr3m3o', type: 'fernando' },
}

function getCRMConfig(accountName) {
  const lower = (accountName || '').toLowerCase()
  for (const [pattern, config] of Object.entries(CRM_SHEETS)) {
    if (lower.includes(pattern)) return config
  }
  return null
}

async function fetchSheetCSV(spreadsheetId, sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Sheet fetch failed: ${resp.status}`)
  const text = await resp.text()
  const rows = []
  let current = ''
  let inQuotes = false
  const lines = text.split('\n')
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') inQuotes = !inQuotes
    }
    current += (current ? '\n' : '') + line
    if (!inQuotes) { rows.push(current); current = ''; inQuotes = false }
  }
  if (current) rows.push(current)
  return rows.map(row => {
    const cells = []
    let cell = ''
    let q = false
    for (let i = 0; i < row.length; i++) {
      if (row[i] === '"') { q = !q; continue }
      if (row[i] === ',' && !q) { cells.push(cell.trim()); cell = ''; continue }
      cell += row[i]
    }
    cells.push(cell.trim())
    return cells
  })
}

function parseSamecoLeads(rows) {
  const leads = []
  const seen = new Set()
  for (const row of rows) {
    if (row.length < 18) continue
    const id = row[0]
    const createdTime = row[1]
    const adName = row[3]
    const campaignName = row[7]
    const platform = row[11]
    const interesse = row[12]
    const faixaEnergia = row[13]
    const tipo = row[14]
    const nome = row[16]
    const telefone = row[17]
    const qualRaw = (row[19] || '').trim()
    const qualNorm = qualRaw.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    let qualificacao = ''
    if (qualNorm.includes('VENDEU')) qualificacao = 'VENDEU'
    else if (qualNorm.startsWith('NAO')) qualificacao = 'NÃO'
    else if (qualNorm.includes('ORCAMENTO')) qualificacao = 'SIM'
    else qualificacao = qualRaw
    if (!createdTime || !nome || nome === 'full_name' || id === 'ENTRADA DE LEADS - FORMULARIO') continue
    let dateObj
    try { dateObj = new Date(createdTime); if (isNaN(dateObj.getTime())) continue } catch { continue }
    const cleanPhone = (telefone || '').replace(/[^\d]/g, '')
    if (cleanPhone && seen.has(cleanPhone)) continue
    if (cleanPhone) seen.add(cleanPhone)
    let faixa = (faixaEnergia || '').toLowerCase().trim()
    if (faixa.includes('até') || faixa.includes('200') && !faixa.includes('400')) faixa = 'Até R$ 200'
    else if (faixa.includes('201') || (faixa.includes('400') && !faixa.includes('700'))) faixa = 'R$ 201 a R$ 400'
    else if (faixa.includes('401') || faixa.includes('700')) faixa = 'R$ 401 a R$ 700'
    else if (faixa.includes('acima') || faixa.includes('700')) faixa = 'Acima de R$ 700'
    else if (faixa) {
      const val = parseInt(faixa.replace(/[^\d]/g, ''))
      if (val <= 200) faixa = 'Até R$ 200'
      else if (val <= 400) faixa = 'R$ 201 a R$ 400'
      else if (val <= 700) faixa = 'R$ 401 a R$ 700'
      else faixa = 'Acima de R$ 700'
    } else faixa = 'Não informado'
    const dateStr = dateObj.toLocaleDateString('pt-BR')
    leads.push({
      date: dateStr, dateObj,
      interesse: interesse || '', nome,
      origem: platform === 'fb' ? 'Facebook' : platform === 'ig' ? 'Instagram' : platform || '',
      corretor: '', visita: '', estado: 'Novo',
      qualificacao: qualificacao || '',
      tipo: (tipo || '').toLowerCase().includes('empres') ? 'Empresa' : 'Residência',
      faixaEnergia: faixa,
      campaignName: campaignName || '', adName: adName || '',
    })
  }
  return leads
}

function parseBRDate(str) {
  if (!str) return null
  const parts = str.split('/')
  if (parts.length !== 3) return null
  const [d, m, y] = parts
  const year = parseInt(y)
  if (year < 2020) return null
  return new Date(year, parseInt(m) - 1, parseInt(d))
}

async function parseKellermannAllSheets(sheetId) {
  const corretores = ['Leads Diários (Bárbara)', 'Leads Diários (Guilherme)', 'Leads Diários (Juliana)']
  const allLeads = []
  const seen = new Set()
  for (const sheetName of corretores) {
    let rows
    try { rows = await fetchSheetCSV(sheetId, sheetName) } catch { continue }
    for (const row of rows) {
      if (row.length < 9) continue
      const num = row[0], status = row[1], imovel = row[3], dateStr = row[4]
      const nome = row[5], contato = row[6], origem = row[7], corretor = row[8]
      const qualificacao = row[10] || ''
      if (!dateStr || !nome || nome === 'Cliente' || num === 'Nº') continue
      const date = parseBRDate(dateStr)
      if (!date) continue
      const cleanContact = (contato || '').replace(/[\s\-\(\)]/g, '')
      if (cleanContact && seen.has(cleanContact)) continue
      if (cleanContact) seen.add(cleanContact)
      allLeads.push({
        date: dateStr, dateObj: date,
        interesse: imovel || '', nome,
        origem: origem || '', corretor: corretor || '',
        visita: '', estado: status || 'Novo',
        qualificacao: qualificacao.toUpperCase().trim(),
      })
    }
  }
  return allLeads
}

function parseLudusSales(rows) {
  const sales = []
  let lastDateObj = null
  for (const row of rows) {
    if (row.length < 2) continue
    const dateStr = (row[0] || '').trim()
    const nome = (row[1] || '').trim()
    const comercial = (row[3] || '').trim()
    const personal = (row[6] || '').trim()
    let valorStr = (row[7] || '').replace(/[^\d.,]/g, '')
    if (valorStr.includes('.') && valorStr.includes(',')) valorStr = valorStr.replace(/\./g, '').replace(',', '.')
    else if (valorStr.includes(',')) valorStr = valorStr.replace(',', '.')
    else if (valorStr.includes('.') && valorStr.split('.').pop().length === 3) valorStr = valorStr.replace(/\./g, '')
    const canal = (row[8] || '').trim().toLowerCase()
    if (!nome || nome === 'Nome' || dateStr === 'Data da entrada') continue
    let dateObj = null
    if (dateStr) {
      const parts = dateStr.split('/')
      if (parts.length >= 2) {
        const d = parseInt(parts[0]), m = parseInt(parts[1]) - 1
        const y = parts[2] ? parseInt(parts[2]) : new Date().getFullYear()
        const fullYear = y < 100 ? 2000 + y : y
        dateObj = new Date(fullYear, m, d)
      }
    }
    if (!dateObj || isNaN(dateObj.getTime())) dateObj = lastDateObj
    if (!dateObj) continue
    lastDateObj = dateObj
    const valor = parseFloat(valorStr) || 0
    let canalNorm = canal
    if (canal.includes('insta') || canal.includes('ig')) canalNorm = 'Instagram'
    else if (canal.includes('whats') || canal.includes('wpp') || canal.includes('zap')) canalNorm = 'WhatsApp'
    else if (canal.includes('presencial') || canal.includes('presenc')) canalNorm = 'Presencial'
    else if (canal.includes('face') || canal.includes('fb')) canalNorm = 'Facebook'
    else if (canal.includes('indica')) canalNorm = 'Indicação'
    else if (canal.includes('site') || canal.includes('web')) canalNorm = 'Site'
    else if (canal) canalNorm = canal.charAt(0).toUpperCase() + canal.slice(1)
    else canalNorm = 'Não informado'
    sales.push({ date: dateStr, dateObj, nome, comercial, personal, valor, canal: canalNorm })
  }
  return sales
}

router.get('/crm/:accountId', async (req, res) => {
  try {
    const accountName = resolveAccountName(req)
    const days = parseInt(req.query.days || '7')
    const config = getCRMConfig(accountName)
    if (!config) return res.json({ available: false })

    if (config.type === 'ludus') {
      const rows = await fetchSheetCSV(config.id, 'fechou')
      const allSales = parseLudusSales(rows)
      const now = new Date()
      const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - days); cutoff.setHours(0, 0, 0, 0)
      const sales = allSales.filter(s => s.dateObj >= cutoff)
      const prevCutoff = new Date(cutoff); prevCutoff.setDate(prevCutoff.getDate() - days)
      const prevSales = allSales.filter(s => s.dateObj >= prevCutoff && s.dateObj < cutoff)
      const totalVendas = sales.length
      const totalValor = sales.reduce((sum, s) => sum + s.valor, 0)
      const prevTotalVendas = prevSales.length
      const prevTotalValor = prevSales.reduce((sum, s) => sum + s.valor, 0)
      const canalStats = {}
      sales.forEach(s => {
        if (!canalStats[s.canal]) canalStats[s.canal] = { vendas: 0, valor: 0 }
        canalStats[s.canal].vendas++; canalStats[s.canal].valor += s.valor
      })
      const personalStats = {}
      sales.forEach(s => {
        let p = (s.personal || 'Não atribuído').trim()
        if (p && p !== 'Não atribuído') p = p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
        if (!personalStats[p]) personalStats[p] = { vendas: 0, valor: 0 }
        personalStats[p].vendas++; personalStats[p].valor += s.valor
      })
      const comercialStats = {}
      sales.forEach(s => {
        let c = (s.comercial || 'Não atribuído').trim()
        if (c && c !== 'Não atribuído') c = c.charAt(0).toUpperCase() + c.slice(1).toLowerCase()
        if (!comercialStats[c]) comercialStats[c] = { vendas: 0, valor: 0 }
        comercialStats[c].vendas++; comercialStats[c].valor += s.valor
      })
      const dailyCounts = {}
      sales.forEach(s => {
        const key = s.dateObj.toISOString().slice(0, 10)
        if (!dailyCounts[key]) dailyCounts[key] = { count: 0, valor: 0 }
        dailyCounts[key].count++; dailyCounts[key].valor += s.valor
      })
      const dailySales = Object.entries(dailyCounts).map(([date, d]) => ({ date, count: d.count, valor: d.valor })).sort((a, b) => a.date.localeCompare(b.date))
      const ticketMedio = totalVendas > 0 ? totalValor / totalVendas : 0
      const prevTicketMedio = prevTotalVendas > 0 ? prevTotalValor / prevTotalVendas : 0
      return res.json({
        available: true, crmType: 'ludus',
        totalVendas, totalValor, ticketMedio,
        previous: { totalVendas: prevTotalVendas, totalValor: prevTotalValor, ticketMedio: prevTicketMedio },
        canalStats, personalStats, comercialStats, dailySales,
      })
    }

    if (config.type === 'fernando') {
      const rows = await fetchSheetCSV(config.id, 'leads diarios outubro')
      const allLeads = []
      const seen = new Set()
      for (const row of rows) {
        if (row.length < 7) continue
        const status = (row[0] || '').trim()
        const nome = (row[4] || '').trim()
        const dateStr = (row[3] || '').trim()
        if (!nome || nome === 'NOME CLIENTE' || !dateStr) continue
        let dateObj
        const parts = dateStr.split('/')
        if (parts.length === 3) {
          const y = parseInt(parts[2]); if (y < 2020) continue
          dateObj = new Date(y, parseInt(parts[1]) - 1, parseInt(parts[0]))
        } else if (parts.length === 2) {
          dateObj = new Date(2026, parseInt(parts[1]) - 1, parseInt(parts[0]))
        } else continue
        if (isNaN(dateObj.getTime())) continue
        const phone = (row[5] || '').replace(/[^\d]/g, '')
        if (phone && seen.has(phone)) continue
        if (phone) seen.add(phone)
        const statusLower = status.toLowerCase()
        let qualificacao
        if (statusLower.includes('atendimento')) qualificacao = 'QUALIFICADO'
        else if (statusLower.includes('sem retorno') || statusLower.includes('locação') || statusLower.includes('locacao')) qualificacao = 'DESQUALIFICADO'
        else qualificacao = 'DESQUALIFICADO'
        const feedbacks = ((row[7] || '') + ' ' + (row[8] || '')).toLowerCase()
        const isLocacao = feedbacks.includes('locação') || feedbacks.includes('locacao') || feedbacks.includes('locar') || feedbacks.includes('alug')
        if (isLocacao) qualificacao = 'DESQUALIFICADO'
        let imovel = (row[2] || '').trim()
        const imovelLower = imovel.toLowerCase()
        if (imovelLower.includes('berghem')) imovel = 'Res. Berghem'
        else if (imovelLower.includes('monte bello') || imovelLower.includes('monte belo')) imovel = 'Ed. Monte Bello'
        else if (imovelLower.includes('urussanguinha') || imovelLower.includes('casa uru')) imovel = 'Casa Urussanguinha'
        const origem = (row[6] || '').trim()
        const origemNorm = origem.toLowerCase().includes('instagram') ? 'Instagram' : origem.toLowerCase().includes('facebook') ? 'Facebook' : origem || 'Outro'
        allLeads.push({
          dateObj, nome,
          status: statusLower.includes('atendimento') ? 'Em Atendimento' : statusLower.includes('sem retorno') ? 'Sem Retorno' : status,
          qualificacao, imovel, origem: origemNorm,
          publico: (row[1] || '').trim(),
          feedbackCliente: (row[7] || '').trim(),
          feedbackCorretor: (row[8] || '').trim(),
          isLocacao,
        })
      }
      const now = new Date()
      const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - days); cutoff.setHours(0, 0, 0, 0)
      const leads = allLeads.filter(l => l.dateObj >= cutoff)
      const prevCutoff = new Date(cutoff); prevCutoff.setDate(prevCutoff.getDate() - days)
      const prevLeads = allLeads.filter(l => l.dateObj >= prevCutoff && l.dateObj < cutoff)
      const total = leads.length
      const qualificados = leads.filter(l => l.qualificacao === 'QUALIFICADO').length
      const desqualificados = leads.filter(l => l.qualificacao === 'DESQUALIFICADO').length
      const emAtendimento = leads.filter(l => l.status === 'Em Atendimento').length
      const semRetorno = leads.filter(l => l.status === 'Sem Retorno').length
      const locacaoCount = leads.filter(l => l.isLocacao).length
      const prevTotal = prevLeads.length
      const prevQual = prevLeads.filter(l => l.qualificacao === 'QUALIFICADO').length
      const prevSemRet = prevLeads.filter(l => l.status === 'Sem Retorno').length
      const origemStats = {}
      leads.forEach(l => {
        if (!origemStats[l.origem]) origemStats[l.origem] = { total: 0, qualificado: 0, desqualificado: 0 }
        origemStats[l.origem].total++
        if (l.qualificacao === 'QUALIFICADO') origemStats[l.origem].qualificado++
        else origemStats[l.origem].desqualificado++
      })
      const imovelStats = {}
      leads.forEach(l => {
        const im = l.imovel || 'Outro'
        if (!imovelStats[im]) imovelStats[im] = { total: 0, qualificado: 0, desqualificado: 0 }
        imovelStats[im].total++
        if (l.qualificacao === 'QUALIFICADO') imovelStats[im].qualificado++
        else imovelStats[im].desqualificado++
      })
      const dailyCounts = {}
      leads.forEach(l => {
        const day = l.dateObj.toISOString().slice(0, 10)
        if (!dailyCounts[day]) dailyCounts[day] = { date: day, count: 0 }
        dailyCounts[day].count++
      })
      const dailyLeads = Object.values(dailyCounts).sort((a, b) => a.date.localeCompare(b.date))
      return res.json({
        available: true, crmType: 'fernando',
        total, qualificados, desqualificados, emAtendimento, semRetorno, locacaoCount,
        qualRate: total > 0 ? ((qualificados / total) * 100).toFixed(1) : '0',
        semRetornoRate: total > 0 ? ((semRetorno / total) * 100).toFixed(1) : '0',
        previous: { total: prevTotal, qualificados: prevQual, semRetorno: prevSemRet },
        origemStats, imovelStats, dailyLeads,
      })
    }

    if (config.type === 'bgimob') {
      const rows = await fetchSheetCSV(config.id, 'Leads Formulário')
      const allLeads = []
      const seen = new Set()
      for (const row of rows) {
        if (row.length < 19) continue
        const id = (row[0] || '').trim()
        if (!id.startsWith('l:')) continue
        const createdTime = row[1]
        let dateObj
        try { dateObj = new Date(createdTime); if (isNaN(dateObj.getTime())) continue } catch { continue }
        const phone = (row[15] || '').replace(/[^\d]/g, '')
        if (phone && seen.has(phone)) continue
        if (phone) seen.add(phone)
        const corretor = (row[18] || '').trim()
        const corretorNorm = corretor.toLowerCase().startsWith('dionatha') ? 'Dionathan' : corretor
        allLeads.push({
          dateObj,
          adName: (row[3] || '').trim(),
          adsetName: (row[5] || '').trim(),
          campaignName: (row[7] || '').trim(),
          platform: (row[11] || '').trim(),
          interesseTerreno: (row[12] || '').trim().toLowerCase(),
          conheceBG: (row[13] || '').trim().toLowerCase(),
          nome: (row[14] || '').trim(),
          corretor: corretorNorm,
          status: (row[19] || '').trim().toUpperCase(),
        })
      }
      const now = new Date()
      const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - days); cutoff.setHours(0, 0, 0, 0)
      const leads = allLeads.filter(l => l.dateObj >= cutoff)
      const prevCutoff = new Date(cutoff); prevCutoff.setDate(prevCutoff.getDate() - days)
      const prevLeads = allLeads.filter(l => l.dateObj >= prevCutoff && l.dateObj < cutoff)
      const total = leads.length
      const naoRespondeu = leads.filter(l => l.status === 'NÃO RESPONDEU').length
      const emAtendimento = leads.filter(l => l.status === 'EM ATENDIMENTO').length
      const visita = leads.filter(l => l.status === 'VISITA').length
      const proposta = leads.filter(l => l.status === 'PROPOSTA').length
      const comprou = leads.filter(l => l.status === 'COMPROU').length
      const semStatus = leads.filter(l => !l.status).length
      const qualificados = emAtendimento + visita + proposta + comprou
      const prevTotal = prevLeads.length
      const prevQualificados = prevLeads.filter(l => ['EM ATENDIMENTO', 'VISITA', 'PROPOSTA', 'COMPROU'].includes(l.status)).length
      const prevNaoResp = prevLeads.filter(l => l.status === 'NÃO RESPONDEU').length
      const corretorStats = {}
      leads.forEach(l => {
        const c = l.corretor || 'Sem corretor'
        if (!corretorStats[c]) corretorStats[c] = { total: 0, naoRespondeu: 0, emAtendimento: 0, visita: 0, proposta: 0, comprou: 0 }
        corretorStats[c].total++
        if (l.status === 'NÃO RESPONDEU') corretorStats[c].naoRespondeu++
        if (l.status === 'EM ATENDIMENTO') corretorStats[c].emAtendimento++
        if (l.status === 'VISITA') corretorStats[c].visita++
        if (l.status === 'PROPOSTA') corretorStats[c].proposta++
        if (l.status === 'COMPROU') corretorStats[c].comprou++
      })
      const adStats = {}
      leads.forEach(l => {
        const ad = l.adName || 'Sem anuncio'
        if (!adStats[ad]) adStats[ad] = { total: 0, qualificado: 0, naoResp: 0, visita: 0, proposta: 0, comprou: 0 }
        adStats[ad].total++
        if (['EM ATENDIMENTO', 'VISITA', 'PROPOSTA', 'COMPROU'].includes(l.status)) adStats[ad].qualificado++
        if (l.status === 'NÃO RESPONDEU') adStats[ad].naoResp++
        if (l.status === 'VISITA') adStats[ad].visita++
        if (l.status === 'PROPOSTA') adStats[ad].proposta++
        if (l.status === 'COMPROU') adStats[ad].comprou++
      })
      const platformStats = {}
      leads.forEach(l => {
        const p = l.platform === 'fb' ? 'Facebook' : l.platform === 'ig' ? 'Instagram' : l.platform || 'Outro'
        if (!platformStats[p]) platformStats[p] = { total: 0, qualificado: 0 }
        platformStats[p].total++
        if (['EM ATENDIMENTO', 'VISITA', 'PROPOSTA', 'COMPROU'].includes(l.status)) platformStats[p].qualificado++
      })
      const conheceBGStats = { sim: 0, nao: 0 }
      leads.forEach(l => {
        if (l.conheceBG === 'sim') conheceBGStats.sim++
        else if (l.conheceBG === 'não' || l.conheceBG === 'nao') conheceBGStats.nao++
      })
      const dailyCounts = {}
      leads.forEach(l => {
        const day = l.dateObj.toISOString().slice(0, 10)
        if (!dailyCounts[day]) dailyCounts[day] = { date: day, count: 0 }
        dailyCounts[day].count++
      })
      const dailyLeads = Object.values(dailyCounts).sort((a, b) => a.date.localeCompare(b.date))
      return res.json({
        available: true, crmType: 'bgimob', total,
        funnel: { naoRespondeu, emAtendimento, visita, proposta, comprou, semStatus },
        qualificados,
        qualRate: total > 0 ? ((qualificados / total) * 100).toFixed(1) : '0',
        naoRespRate: total > 0 ? ((naoRespondeu / total) * 100).toFixed(1) : '0',
        previous: { total: prevTotal, qualificados: prevQualificados, naoRespondeu: prevNaoResp },
        corretorStats, adStats, platformStats, conheceBGStats, dailyLeads,
      })
    }

    const sheetName = config.type === 'kellermann' ? 'ENTRADA DE LEADS' : 'LEADS'
    const rows = await fetchSheetCSV(config.id, sheetName)
    const now = new Date()
    const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - days); cutoff.setHours(0, 0, 0, 0)
    let allLeads
    if (config.type === 'sameco') {
      allLeads = parseSamecoLeads(rows)
    } else if (config.type === 'kellermann') {
      allLeads = await parseKellermannAllSheets(config.id)
    } else {
      allLeads = []
      const SKIP_NAMES = ['Nome', 'DEZEMBRO', 'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO']
      const VALID_ORIGENS = ['site - invistaimoveissm.com.br', 'facebook', 'instagram', 'whatsapp']
      const CORRETOR_DESQUAL = ['capao - claudia', 'capao da canoa', 'sem resposta', 'sem retorno', 'so informacao']
      const ESTADO_QUAL = ['em atendimento', 'em qualificacao', 'encaminhado ao setor', 'positiva', 'realmete transf']
      const ESTADO_DESQUAL = ['negatva', 'pausa temporariamente', 'sem evolucao', 'sem resposta']
      const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      for (const row of rows) {
        if (row.length < 8) continue
        const dateStr = row[0], name = row[3]
        if (!dateStr || !name || SKIP_NAMES.includes(name) || dateStr === 'Data') continue
        const date = parseBRDate(dateStr)
        if (!date) continue
        const origem = (row[6] || '').trim()
        if (!VALID_ORIGENS.includes(origem.toLowerCase())) continue
        const corretor = (row[7] || '').trim()
        const estado = (row[11] || '').trim()
        const corretorNorm = stripAccents(corretor)
        const estadoNorm = stripAccents(estado)
        const corInDesq = !corretor || CORRETOR_DESQUAL.some(t => corretorNorm.includes(t))
        const estInQual = ESTADO_QUAL.some(t => estadoNorm.includes(t))
        const estInDesq = ESTADO_DESQUAL.some(t => estadoNorm.includes(t))
        let qualificacao = 'MEIO TERMO'
        if (!corInDesq && estInQual) qualificacao = 'SIM'
        else if (corInDesq && estInDesq) qualificacao = 'NÃO'
        allLeads.push({
          date: dateStr, dateObj: date,
          interesse: row[2], nome: name, origem, corretor,
          visita: row[8] || '', estado, qualificacao,
        })
      }
    }
    const leads = allLeads.filter(l => l.dateObj >= cutoff)
    const total = leads.length
    function computeStats(set) {
      const emQualificacao = set.filter(l => l.estado.includes('Qualifica')).length
      const emAtendimento = set.filter(l => l.estado.includes('atendimento')).length
      const semResposta = set.filter(l => l.estado.includes('Sem resposta')).length
      const negativa = set.filter(l => l.estado.includes('Negat')).length
      const withVisit = set.filter(l => l.visita.trim().length > 0).length
      const visitScheduled = set.filter(l => l.visita.toLowerCase().includes('agendad')).length
      const visited = set.filter(l => l.visita.toLowerCase().includes('visitou')).length
      return { total: set.length, emQualificacao, emAtendimento, semResposta, negativa, withVisit, visitScheduled, visited }
    }
    const stats = computeStats(leads)
    const sourceCounts = {}
    leads.forEach(l => { sourceCounts[l.origem || 'Sem origem'] = (sourceCounts[l.origem || 'Sem origem'] || 0) + 1 })
    const interestCounts = {}
    leads.forEach(l => { const k = l.interesse || 'Outro'; interestCounts[k] = (interestCounts[k] || 0) + 1 })
    const agentCounts = {}
    leads.forEach(l => { const k = l.corretor || 'Sem corretor'; agentCounts[k] = (agentCounts[k] || 0) + 1 })
    const sourceBreakdown = {}
    for (const l of leads) {
      const src = l.origem || 'Sem origem'
      if (!sourceBreakdown[src]) sourceBreakdown[src] = []
      sourceBreakdown[src].push(l)
    }
    const perSource = Object.entries(sourceBreakdown).filter(([k]) => k !== 'Sem origem' && k !== '').map(([source, set]) => {
      const s = computeStats(set)
      const venda = set.filter(l => l.interesse === 'Venda').length
      const locacao = set.filter(l => l.interesse === 'Locação').length
      return {
        source: source.replace('Site - invistaimoveissm.com.br', 'Site'),
        total: s.total, emAtendimento: s.emAtendimento, semResposta: s.semResposta,
        visited: s.visited + s.visitScheduled, venda, locacao,
        qualRate: s.total > 0 ? ((s.emAtendimento / s.total) * 100).toFixed(1) : '0',
        visitRate: s.total > 0 ? (((s.visited + s.visitScheduled) / s.total) * 100).toFixed(1) : '0',
      }
    }).sort((a, b) => b.total - a.total)
    const dailyCounts = {}
    leads.forEach(l => { dailyCounts[l.date] = (dailyCounts[l.date] || 0) + 1 })
    const dailyLeads = Object.entries(dailyCounts).map(([date, count]) => ({ date, count })).sort((a, b) => {
      const da = parseBRDate(a.date), db = parseBRDate(b.date)
      return (da?.getTime() || 0) - (db?.getTime() || 0)
    })
    const prevCutoff = new Date(cutoff); prevCutoff.setDate(prevCutoff.getDate() - days)
    const prevLeads = allLeads.filter(l => l.dateObj >= prevCutoff && l.dateObj < cutoff)
    const prevStats = computeStats(prevLeads)
    const semCorretor = leads.filter(l => !l.corretor || l.corretor.trim() === '' || l.corretor === 'Sem Retorno' || l.corretor === 'Sem resposta').length
    const adsLeads = leads.filter(l => {
      const o = (l.origem || '').toLowerCase()
      return o.includes('facebook') || o.includes('instagram') || o.includes('meta')
    }).length
    const funnelRates = {
      leadToQualified: total > 0 ? ((stats.emQualificacao / total) * 100).toFixed(1) : '0',
      qualifiedToAtendimento: stats.emQualificacao > 0 ? ((stats.emAtendimento / stats.emQualificacao) * 100).toFixed(1) : '0',
      atendimentoToVisit: stats.emAtendimento > 0 ? (((stats.visitScheduled + stats.visited) / stats.emAtendimento) * 100).toFixed(1) : '0',
    }
    const tipoCounts = {}
    const faixaCounts = {}
    leads.forEach(l => {
      if (l.tipo) tipoCounts[l.tipo] = (tipoCounts[l.tipo] || 0) + 1
      if (l.faixaEnergia) faixaCounts[l.faixaEnergia] = (faixaCounts[l.faixaEnergia] || 0) + 1
    })
    const semRetorno = leads.filter(l => l.estado.toLowerCase().includes('sem retorno')).length
    let qualSim, qualNao, qualMeio, qualVendido, qualEmAtendimento
    if (config.type === 'sameco') {
      qualSim = leads.filter(l => l.qualificacao === 'SIM').length
      qualNao = leads.filter(l => l.qualificacao === 'NÃO' || l.qualificacao === 'NAO').length
      qualEmAtendimento = leads.filter(l => l.qualificacao === 'EM ATENDIMENTO').length
      qualVendido = leads.filter(l => l.qualificacao === 'VENDEU').length
      qualMeio = leads.filter(l => !['SIM', 'NÃO', 'VENDEU'].includes(l.qualificacao)).length
    } else {
      qualSim = leads.filter(l => l.qualificacao === 'SIM').length
      qualNao = leads.filter(l => l.qualificacao === 'NÃO').length
      qualMeio = leads.filter(l => l.qualificacao === 'MEIO TERMO').length
      qualVendido = 0; qualEmAtendimento = 0
    }
    const qualifiedTotal = qualSim + qualMeio
    const generalQualRate = total > 0 ? ((qualSim / total) * 100).toFixed(1) : '0'
    const agentQual = {}
    leads.forEach(l => {
      const agent = l.corretor || 'Sem corretor'
      if (!agentQual[agent]) agentQual[agent] = { total: 0, sim: 0, nao: 0, meio: 0, semRetorno: 0 }
      agentQual[agent].total++
      if (config.type === 'sameco') {
        if (l.qualificacao === 'SIM') agentQual[agent].sim++
        else if (l.qualificacao === 'NÃO' || l.qualificacao === 'NAO') agentQual[agent].nao++
        else if (l.qualificacao === 'EM ATENDIMENTO') agentQual[agent].meio++
      } else {
        if (l.qualificacao === 'SIM') agentQual[agent].sim++
        else if (l.qualificacao === 'NÃO') agentQual[agent].nao++
        else if (l.qualificacao === 'MEIO TERMO') agentQual[agent].meio++
      }
      if (l.estado.toLowerCase().includes('sem retorno')) agentQual[agent].semRetorno++
    })
    const sourceQual = {}
    leads.forEach(l => {
      const src = l.origem || 'Sem origem'
      if (!sourceQual[src]) sourceQual[src] = { total: 0, sim: 0, nao: 0, meio: 0, semRetorno: 0, vendido: 0 }
      sourceQual[src].total++
      if (config.type === 'sameco') {
        if (l.qualificacao === 'SIM') sourceQual[src].sim++
        else if (l.qualificacao === 'NÃO' || l.qualificacao === 'NAO') sourceQual[src].nao++
        else if (l.qualificacao === 'EM ATENDIMENTO') sourceQual[src].meio++
        else if (l.qualificacao === 'VENDEU') sourceQual[src].vendido++
      } else {
        if (l.qualificacao === 'SIM') sourceQual[src].sim++
        else if (l.qualificacao === 'NÃO') sourceQual[src].nao++
        else if (l.qualificacao === 'MEIO TERMO') sourceQual[src].meio++
      }
      if (l.estado.toLowerCase().includes('sem retorno')) sourceQual[src].semRetorno++
    })
    res.json({
      available: true, crmType: config.type, total,
      funnel: {
        emQualificacao: stats.emQualificacao, emAtendimento: stats.emAtendimento,
        semResposta: stats.semResposta, negativa: stats.negativa,
        visitScheduled: stats.visitScheduled, visited: stats.visited,
      },
      funnelRates,
      previous: {
        total: prevLeads.length,
        emAtendimento: prevStats.emAtendimento,
        semResposta: prevStats.semResposta,
        visited: prevStats.visited + prevStats.visitScheduled,
      },
      sourceCounts, interestCounts, agentCounts, perSource, dailyLeads,
      adsLeads, semCorretor, semRetorno,
      qualified: qualifiedTotal, qualSim, qualNao, qualMeio,
      qualVendido: qualVendido || 0, qualEmAtendimento: qualEmAtendimento || 0,
      agentQual, sourceQual, generalQualRate,
      tipoCounts, faixaCounts,
      visitRate: total > 0 ? (((stats.withVisit) / total) * 100).toFixed(1) : '0',
      qualificationRate: total > 0 ? ((stats.emAtendimento / total) * 100).toFixed(1) : '0',
      noResponseRate: total > 0 ? ((stats.semResposta / total) * 100).toFixed(1) : '0',
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/crm/:accountId/forms', async (req, res) => {
  try {
    const accountName = resolveAccountName(req)
    const config = getCRMConfig(accountName)
    if (!config) return res.json({ available: false })
    const sheetId = config.id
    const [formLeads, formFeiraoLeads] = await Promise.all([
      fetchSheetCSV(sheetId, 'Leads Formulário').catch(() => []),
      fetchSheetCSV(sheetId, 'Leads Formulário Feirão').catch(() => []),
    ])
    const parseFormRows = (rows) => {
      if (rows.length < 2) return []
      const headers = rows[0]
      return rows.slice(1).filter(r => r.length > 5 && r[0]).map(r => ({
        id: r[0], date: r[1], adName: r[3], campaignName: r[7], platform: r[11],
        name: r[headers.length - 3] || r[14],
        phone: r[headers.length - 2] || r[15],
        status: r[headers.length - 1] || r[16],
      }))
    }
    res.json({ available: true, formLeads: parseFormRows(formLeads), formFeiraoLeads: parseFormRows(formFeiraoLeads) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// =====================================================================
// GOOGLE ADS ROUTES
// =====================================================================
// Lazy getter — process.env so disponivel apos dotenv.config() rodar
//
// Importante: redirectUri usa HUB_GADS_REDIRECT_URI (proprio do Hub), NAO o
// GADS_REDIRECT_URI compartilhado (que aponta pro /core). Assim os dois
// sistemas podem fazer OAuth independente sem conflito.
const getGADS = () => ({
  devToken: getSetting('GOOGLE_ADS_DEVELOPER_TOKEN'),
  clientId: getSetting('GOOGLE_ADS_CLIENT_ID'),
  clientSecret: getSetting('GOOGLE_ADS_CLIENT_SECRET'),
  refreshToken: getSetting('GOOGLE_ADS_REFRESH_TOKEN'),
  loginCustomerId: (getSetting('GOOGLE_ADS_LOGIN_CUSTOMER_ID') || '').replace(/-/g, ''),
  redirectUri: process.env.HUB_GADS_REDIRECT_URI || `http://localhost:3003/api/performance/google-ads/callback`,
})

let gadsTokenCache = { token: null, expiresAt: 0 }

async function getGadsAccessToken() {
  if (gadsTokenCache.token && Date.now() < gadsTokenCache.expiresAt) return gadsTokenCache.token
  if (!getGADS().refreshToken) return null
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: getGADS().refreshToken,
      client_id: getGADS().clientId,
      client_secret: getGADS().clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  const data = await r.json()
  if (data.error) throw new Error(`Google OAuth error: ${data.error_description || data.error}`)
  gadsTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 }
  return gadsTokenCache.token
}

async function gaqlQuery(customerId, query) {
  const token = await getGadsAccessToken()
  const r = await fetch(`${GADS_API}/customers/${customerId}/googleAds:searchStream`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'developer-token': getGADS().devToken,
      'login-customer-id': getGADS().loginCustomerId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  if (!r.ok) {
    const err = await r.json()
    throw new Error(JSON.stringify(err.error?.message || err))
  }
  const batches = await r.json()
  return batches.flatMap(batch => batch.results || [])
}

// OAuth setup — publicas (sem auth). Callback do Google nao carrega JWT.
publicRouter.get('/google-ads/auth', (req, res) => {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', getGADS().clientId)
  url.searchParams.set('redirect_uri', getGADS().redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/analytics.readonly')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  res.redirect(url.toString())
})

publicRouter.get('/google-ads/callback', async (req, res) => {
  try {
    const { code } = req.query
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: getGADS().clientId, client_secret: getGADS().clientSecret,
        redirect_uri: getGADS().redirectUri, grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenRes.json()
    if (tokens.error) return res.status(400).json(tokens)
    res.send(`
      <h2>Google Ads OAuth - Sucesso!</h2>
      <p>Adicione esta linha no <b>.env</b> do Hub:</p>
      <pre style="background:#111;color:#0f0;padding:20px;border-radius:8px;font-size:16px;">GOOGLE_ADS_REFRESH_TOKEN=${tokens.refresh_token}</pre>
      <p>Depois reinicie o servidor (pm2 restart dros-hub).</p>
    `)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/google-ads/accounts', async (req, res) => {
  try {
    const token = await getGadsAccessToken()
    if (!token) return res.json({ accounts: [], error: 'No refresh token. Visit /api/performance/google-ads/auth first.' })
    const results = await gaqlQuery(getGADS().loginCustomerId, `
      SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code,
             customer_client.manager, customer_client.status
      FROM customer_client
      WHERE customer_client.manager = false AND customer_client.status = 'ENABLED'
    `)
    let accounts = results.map(r => ({
      id: String(r.customerClient.id),
      name: r.customerClient.descriptiveName || '',
      currency: r.customerClient.currencyCode || 'BRL',
      status: r.customerClient.status,
    }))
    // Filtragem:
    //   - admin (scope=null): todas as contas do MCC
    //   - cliente com gadsId: so o customer com aquele ID
    //   - cliente sem gadsId: nenhuma
    const scope = getClientScope(req.user)
    if (scope !== null) {
      accounts = scope.gadsId ? accounts.filter(a => a.id === scope.gadsId) : []
    }
    res.json({ accounts })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/google-ads/:customerId/campaigns', async (req, res) => {
  try {
    const { customerId } = req.params
    const { days = '30', since, until } = req.query
    const ranges = getDateRanges(parseInt(days), since, until)
    function parseCampaigns(results) {
      return results.map(r => ({
        id: r.campaign.id, name: r.campaign.name, status: r.campaign.status,
        type: r.campaign.advertisingChannelType,
        impressions: parseInt(r.metrics.impressions || 0),
        clicks: parseInt(r.metrics.clicks || 0),
        ctr: parseFloat(r.metrics.ctr || 0) * 100,
        cpc: parseInt(r.metrics.averageCpc || 0) / 1000000,
        spend: parseInt(r.metrics.costMicros || 0) / 1000000,
        conversions: parseFloat(r.metrics.conversions || 0),
        revenue: parseFloat(r.metrics.conversionsValue || 0),
        cpa: parseInt(r.metrics.costPerConversion || 0) / 1000000,
        convRate: parseFloat(r.metrics.conversionsFromInteractionsRate || 0) * 100,
        impressionShare: parseFloat(r.metrics.searchImpressionShare || 0) * 100,
        topImprShare: parseFloat(r.metrics.searchTopImpressionShare || 0) * 100,
        absTopImprShare: parseFloat(r.metrics.searchAbsoluteTopImpressionShare || 0) * 100,
      }))
    }
    function calcTotals(campaigns) {
      const t = campaigns.reduce((t, c) => ({
        spend: t.spend + c.spend, impressions: t.impressions + c.impressions,
        clicks: t.clicks + c.clicks, conversions: t.conversions + c.conversions,
        revenue: t.revenue + c.revenue,
      }), { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 })
      t.ctr = t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0
      t.cpc = t.clicks > 0 ? t.spend / t.clicks : 0
      t.cpa = t.conversions > 0 ? t.spend / t.conversions : 0
      t.roas = t.spend > 0 ? t.revenue / t.spend : 0
      t.convRate = t.clicks > 0 ? (t.conversions / t.clicks) * 100 : 0
      return t
    }
    const campaignQuery = `
      SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
        metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
        metrics.cost_micros, metrics.conversions, metrics.conversions_value,
        metrics.cost_per_conversion, metrics.conversions_from_interactions_rate,
        metrics.search_impression_share, metrics.search_top_impression_share,
        metrics.search_absolute_top_impression_share
      FROM campaign
      WHERE segments.date BETWEEN '%SINCE%' AND '%UNTIL%'
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
    `
    const [currentResults, prevResults] = await Promise.all([
      gaqlQuery(customerId, campaignQuery.replace('%SINCE%', ranges.current.since).replace('%UNTIL%', ranges.current.until)).catch(() => []),
      gaqlQuery(customerId, campaignQuery.replace('%SINCE%', ranges.previous.since).replace('%UNTIL%', ranges.previous.until)).catch(() => []),
    ])
    const campaigns = parseCampaigns(currentResults)
    const totals = calcTotals(campaigns)
    const prevTotals = calcTotals(parseCampaigns(prevResults))
    const qsResults = await gaqlQuery(customerId, `
      SELECT ad_group_criterion.quality_info.quality_score
      FROM keyword_view
      WHERE ad_group_criterion.quality_info.quality_score > 0
      LIMIT 500
    `).catch(() => [])
    const qsScores = qsResults.map(r => r.adGroupCriterion?.qualityInfo?.qualityScore).filter(Boolean)
    totals.avgQualityScore = qsScores.length > 0 ? qsScores.reduce((a, b) => a + b, 0) / qsScores.length : null
    res.json({ campaigns, totals, prevTotals, ranges })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/google-ads/:customerId/daily', async (req, res) => {
  try {
    const { customerId } = req.params
    const { days = '30', since, until } = req.query
    const ranges = getDateRanges(parseInt(days), since, until)
    const dailyQuery = `
      SELECT segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '%SINCE%' AND '%UNTIL%'
        AND campaign.status != 'REMOVED'
      ORDER BY segments.date ASC
    `
    function aggregateDaily(results) {
      const byDate = {}
      results.forEach(r => {
        const d = r.segments.date
        if (!byDate[d]) byDate[d] = { date: d, spend: 0, clicks: 0, impressions: 0, conversions: 0 }
        byDate[d].spend += parseInt(r.metrics.costMicros || 0) / 1000000
        byDate[d].clicks += parseInt(r.metrics.clicks || 0)
        byDate[d].impressions += parseInt(r.metrics.impressions || 0)
        byDate[d].conversions += parseFloat(r.metrics.conversions || 0)
      })
      return Object.values(byDate)
    }
    const [curResults, prevResults] = await Promise.all([
      gaqlQuery(customerId, dailyQuery.replace('%SINCE%', ranges.current.since).replace('%UNTIL%', ranges.current.until)).catch(() => []),
      gaqlQuery(customerId, dailyQuery.replace('%SINCE%', ranges.previous.since).replace('%UNTIL%', ranges.previous.until)).catch(() => []),
    ])
    res.json({ daily: aggregateDaily(curResults), prevDaily: aggregateDaily(prevResults), ranges })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/google-ads/:customerId/keywords', async (req, res) => {
  try {
    const { customerId } = req.params
    const { days = '30', since, until } = req.query
    const ranges = getDateRanges(parseInt(days), since, until)
    const results = await gaqlQuery(customerId, `
      SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
        ad_group_criterion.quality_info.quality_score,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.average_cpc, metrics.ctr
      FROM keyword_view
      WHERE segments.date BETWEEN '${ranges.current.since}' AND '${ranges.current.until}'
      ORDER BY metrics.cost_micros DESC
      LIMIT 50
    `)
    const keywords = results.map(r => ({
      keyword: r.adGroupCriterion?.keyword?.text || '',
      matchType: r.adGroupCriterion?.keyword?.matchType || '',
      qualityScore: r.adGroupCriterion?.qualityInfo?.qualityScore || null,
      impressions: parseInt(r.metrics.impressions || 0),
      clicks: parseInt(r.metrics.clicks || 0),
      ctr: parseFloat(r.metrics.ctr || 0) * 100,
      cpc: parseInt(r.metrics.averageCpc || 0) / 1000000,
      spend: parseInt(r.metrics.costMicros || 0) / 1000000,
      conversions: parseFloat(r.metrics.conversions || 0),
    }))
    res.json({ keywords })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/google-ads/:customerId/search-terms', async (req, res) => {
  try {
    const { customerId } = req.params
    const { days = '30', since, until } = req.query
    const ranges = getDateRanges(parseInt(days), since, until)
    const results = await gaqlQuery(customerId, `
      SELECT search_term_view.search_term, campaign.name,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.ctr, metrics.average_cpc
      FROM search_term_view
      WHERE segments.date BETWEEN '${ranges.current.since}' AND '${ranges.current.until}'
      ORDER BY metrics.cost_micros DESC
      LIMIT 30
    `)
    const searchTerms = results.map(r => ({
      term: r.searchTermView?.searchTerm || '',
      campaign: r.campaign?.name || '',
      impressions: parseInt(r.metrics.impressions || 0),
      clicks: parseInt(r.metrics.clicks || 0),
      ctr: parseFloat(r.metrics.ctr || 0) * 100,
      cpc: parseInt(r.metrics.averageCpc || 0) / 1000000,
      spend: parseInt(r.metrics.costMicros || 0) / 1000000,
      conversions: parseFloat(r.metrics.conversions || 0),
    }))
    res.json({ searchTerms })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/google-ads/:customerId/devices', async (req, res) => {
  try {
    const { customerId } = req.params
    const { days = '30', since, until } = req.query
    const ranges = getDateRanges(parseInt(days), since, until)
    const results = await gaqlQuery(customerId, `
      SELECT segments.device, metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value, metrics.ctr,
        metrics.average_cpc, metrics.conversions_from_interactions_rate
      FROM campaign
      WHERE segments.date BETWEEN '${ranges.current.since}' AND '${ranges.current.until}'
        AND campaign.status != 'REMOVED'
    `)
    const byDevice = {}
    results.forEach(r => {
      const dev = r.segments.device || 'OTHER'
      if (!byDevice[dev]) byDevice[dev] = { device: dev, impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0 }
      byDevice[dev].impressions += parseInt(r.metrics.impressions || 0)
      byDevice[dev].clicks += parseInt(r.metrics.clicks || 0)
      byDevice[dev].spend += parseInt(r.metrics.costMicros || 0) / 1000000
      byDevice[dev].conversions += parseFloat(r.metrics.conversions || 0)
      byDevice[dev].revenue += parseFloat(r.metrics.conversionsValue || 0)
    })
    const devices = Object.values(byDevice).map(d => ({
      ...d,
      ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
      cpc: d.clicks > 0 ? d.spend / d.clicks : 0,
      convRate: d.clicks > 0 ? (d.conversions / d.clicks) * 100 : 0,
      cpa: d.conversions > 0 ? d.spend / d.conversions : 0,
    })).sort((a, b) => b.spend - a.spend)
    res.json({ devices })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/google-ads/:customerId/hourly', async (req, res) => {
  try {
    const { customerId } = req.params
    const { days = '30', since, until } = req.query
    const ranges = getDateRanges(parseInt(days), since, until)
    const results = await gaqlQuery(customerId, `
      SELECT segments.hour, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM campaign
      WHERE segments.date BETWEEN '${ranges.current.since}' AND '${ranges.current.until}'
        AND campaign.status != 'REMOVED'
    `)
    const byHour = {}
    for (let h = 0; h < 24; h++) byHour[h] = { hour: h, impressions: 0, clicks: 0, spend: 0, conversions: 0 }
    results.forEach(r => {
      const h = parseInt(r.segments.hour)
      if (byHour[h] !== undefined) {
        byHour[h].impressions += parseInt(r.metrics.impressions || 0)
        byHour[h].clicks += parseInt(r.metrics.clicks || 0)
        byHour[h].spend += parseInt(r.metrics.costMicros || 0) / 1000000
        byHour[h].conversions += parseFloat(r.metrics.conversions || 0)
      }
    })
    const hourly = Object.values(byHour).map(h => ({
      ...h,
      ctr: h.impressions > 0 ? (h.clicks / h.impressions) * 100 : 0,
      cpc: h.clicks > 0 ? h.spend / h.clicks : 0,
    }))
    res.json({ hourly })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/google-ads/:customerId/conversions', async (req, res) => {
  try {
    const { customerId } = req.params
    const { days = '30', since, until } = req.query
    const ranges = getDateRanges(parseInt(days), since, until)
    const results = await gaqlQuery(customerId, `
      SELECT segments.conversion_action_name, segments.conversion_action_category,
        metrics.conversions, metrics.conversions_value, metrics.cost_per_conversion
      FROM campaign
      WHERE segments.date BETWEEN '${ranges.current.since}' AND '${ranges.current.until}'
        AND campaign.status != 'REMOVED'
        AND metrics.conversions > 0
    `)
    const byAction = {}
    results.forEach(r => {
      const name = r.segments.conversionActionName || 'Desconhecido'
      const category = r.segments.conversionActionCategory || ''
      if (!byAction[name]) byAction[name] = { name, category, conversions: 0, value: 0, cost: 0 }
      byAction[name].conversions += parseFloat(r.metrics.conversions || 0)
      byAction[name].value += parseFloat(r.metrics.conversionsValue || 0)
      byAction[name].cost += parseFloat(r.metrics.costPerConversion || 0)
    })
    const actions = Object.values(byAction).map(a => ({ ...a, conversions: Math.round(a.conversions) })).sort((a, b) => b.conversions - a.conversions)
    res.json({ actions })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// =====================================================================
// GA4 ROUTES
// =====================================================================
const GA4_PROPERTIES = {
  'josi': [{ id: '519645048', name: 'Josi Terapeuta' }],
  'josiane': [{ id: '519645048', name: 'Josi Terapeuta' }],
  'quimiprol': [{ id: '250518836', name: 'Quimiprol (.ind.br)' }, { id: '371238748', name: 'Quimiprol (.com.br)' }],
  'renove': [{ id: '453421508', name: 'Renove Imoveis' }],
  'door grill': [{ id: '353288580', name: 'Door Grill LP' }, { id: '346421460', name: 'Door Grill Nuvemshop' }, { id: '299944361', name: 'DoorGrill Projetos' }],
  'doorgrill': [{ id: '353288580', name: 'Door Grill LP' }, { id: '346421460', name: 'Door Grill Nuvemshop' }, { id: '299944361', name: 'DoorGrill Projetos' }],
  'gui auto': [{ id: '521274503', name: 'Gui AutoCar' }],
  'autocar': [{ id: '521274503', name: 'Gui AutoCar' }],
  'ask': [{ id: '347935844', name: 'ASK Equipamentos' }],
}

function getGA4Properties(accountName) {
  const lower = (accountName || '').toLowerCase()
  const cleaned = lower.replace(/^(ca\s*-?\s*|[\d]+\s*-\s*)/i, '').trim()
  const words = cleaned.split(/[\s\-]+/).filter(w => w.length >= 3)
  for (const [pattern, props] of Object.entries(GA4_PROPERTIES)) {
    if (words.some(w => pattern.includes(w)) || lower.includes(pattern)) return props
  }
  return null
}

async function ga4Report(propertyId, body, accessToken) {
  const r = await fetch(`${GA4_API}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(`GA4 error ${r.status}: ${err.error?.message || JSON.stringify(err)}`)
  }
  return r.json()
}

router.get('/analytics/properties', async (req, res) => {
  // Se cliente tem property_id vinculado, retorna so essa (com nome buscado via Admin API)
  const scope = getClientScope(req.user)
  if (scope?.ga4PropertyId) {
    let name = `Property ${scope.ga4PropertyId}`
    try {
      const token = await getGadsAccessToken()
      if (token) {
        const r = await fetch(`https://analyticsadmin.googleapis.com/v1beta/properties/${scope.ga4PropertyId}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        })
        if (r.ok) {
          const data = await r.json()
          name = data.displayName || name
        }
      }
    } catch {}
    return res.json({ available: true, properties: [{ id: scope.ga4PropertyId, name }] })
  }
  // Fallback: lookup pelo nome textual (GA4_PROPERTIES hardcoded)
  const name = resolveAccountName(req)
  const props = getGA4Properties(name)
  if (!props) return res.json({ available: false, properties: [] })
  res.json({ available: true, properties: props })
})

// Lista TODAS as GA4 properties acessiveis pelo OAuth — usado no dropdown do
// cadastro do cliente (admin). Cliente nunca chama isso.
router.get('/analytics/admin-properties', async (req, res) => {
  try {
    const token = await getGadsAccessToken()
    if (!token) return res.json({ accounts: [], error: 'Sem refresh token Google configurado.' })
    // accountSummaries traz todas as contas GA4 + suas properties em uma chamada
    const r = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      console.error('[Performance/GA4 admin]', err)
      return res.status(400).json({ error: err.error?.message || 'GA4 Admin API error' })
    }
    const data = await r.json()
    // Achata: cada property vira um item com nome da conta + propriedade
    const properties = []
    for (const account of (data.accountSummaries || [])) {
      for (const prop of (account.propertySummaries || [])) {
        // prop.property = 'properties/123456789' — extrai so o ID
        const id = (prop.property || '').replace(/^properties\//, '')
        if (!id) continue
        properties.push({
          id,
          name: `${prop.displayName || id} (${account.displayName || 'conta'})`,
        })
      }
    }
    properties.sort((a, b) => a.name.localeCompare(b.name))
    res.json({ accounts: properties })
  } catch (err) {
    console.error('[Performance/GA4 admin]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/analytics/:propertyId/report', async (req, res) => {
  try {
    const { propertyId } = req.params
    const { days = '7', since, until } = req.query
    const d = parseInt(days)
    const token = await getGadsAccessToken()
    if (!token) return res.status(500).json({ error: 'No Google token' })

    let startDate, endDate, prevStartDate, prevEndDate
    if (since && until) {
      startDate = since
      endDate = until
      const diffDays = Math.ceil((new Date(until) - new Date(since)) / 86400000) + 1
      const prevEnd = new Date(since); prevEnd.setDate(prevEnd.getDate() - 1)
      const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - diffDays + 1)
      prevStartDate = fmtDate(prevStart)
      prevEndDate = fmtDate(prevEnd)
    } else {
      endDate = 'yesterday'
      startDate = `${d}daysAgo`
      prevEndDate = `${d + 1}daysAgo`
      prevStartDate = `${d * 2}daysAgo`
    }

    const [kpiData, dailyData, sourceData, pageData, deviceData, sourceMediumData, landingData, newRetData, eventsData, dowData, cityData] = await Promise.all([
      ga4Report(propertyId, {
        dateRanges: [{ startDate, endDate }, { startDate: prevStartDate, endDate: prevEndDate }],
        metrics: [
          { name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' },
          { name: 'screenPageViews' }, { name: 'averageSessionDuration' },
          { name: 'bounceRate' }, { name: 'engagedSessions' },
          { name: 'conversions' }, { name: 'eventCount' },
        ],
      }, token),
      ga4Report(propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }, { name: 'conversions' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }, token),
      ga4Report(propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'conversions' }, { name: 'engagedSessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: '10',
      }, token),
      ga4Report(propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'sessions' }, { name: 'averageSessionDuration' }, { name: 'bounceRate' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: '15',
      }, token),
      ga4Report(propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'conversions' }, { name: 'bounceRate' }, { name: 'averageSessionDuration' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      }, token),
      ga4Report(propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'sessionSourceMedium' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' }, { name: 'engagementRate' }, { name: 'conversions' }, { name: 'bounceRate' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: '15',
      }, token).catch(() => ({ rows: [] })),
      ga4Report(propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPage' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagementRate' }, { name: 'bounceRate' }, { name: 'conversions' }, { name: 'averageSessionDuration' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: '15',
      }, token).catch(() => ({ rows: [] })),
      ga4Report(propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'newVsReturning' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagementRate' }, { name: 'bounceRate' }, { name: 'averageSessionDuration' }, { name: 'conversions' }, { name: 'screenPageViews' }],
      }, token).catch(() => ({ rows: [] })),
      ga4Report(propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: '20',
      }, token).catch(() => ({ rows: [] })),
      ga4Report(propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'dayOfWeekName' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'conversions' }, { name: 'engagementRate' }],
      }, token).catch(() => ({ rows: [] })),
      ga4Report(propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'city' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'conversions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: '15',
      }, token).catch(() => ({ rows: [] })),
    ])

    function parseMetricRow(row) {
      const vals = row?.metricValues || []
      return {
        sessions: parseInt(vals[0]?.value || 0),
        users: parseInt(vals[1]?.value || 0),
        newUsers: parseInt(vals[2]?.value || 0),
        pageviews: parseInt(vals[3]?.value || 0),
        avgDuration: parseFloat(vals[4]?.value || 0),
        bounceRate: parseFloat(vals[5]?.value || 0) * 100,
        engagedSessions: parseInt(vals[6]?.value || 0),
        conversions: parseInt(vals[7]?.value || 0),
        events: parseInt(vals[8]?.value || 0),
      }
    }
    const current = parseMetricRow(kpiData.rows?.[0])
    const previous = parseMetricRow(kpiData.rows?.[1])
    current.engagementRate = current.sessions > 0 ? (current.engagedSessions / current.sessions) * 100 : 0
    previous.engagementRate = previous.sessions > 0 ? (previous.engagedSessions / previous.sessions) * 100 : 0
    current.pagesPerSession = current.sessions > 0 ? current.pageviews / current.sessions : 0
    previous.pagesPerSession = previous.sessions > 0 ? previous.pageviews / previous.sessions : 0

    const daily = (dailyData.rows || []).map(r => ({
      date: r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value || 0),
      users: parseInt(r.metricValues[1].value || 0),
      pageviews: parseInt(r.metricValues[2].value || 0),
      conversions: parseInt(r.metricValues[3].value || 0),
    }))
    const sources = (sourceData.rows || []).map(r => ({
      channel: r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value || 0),
      users: parseInt(r.metricValues[1].value || 0),
      conversions: parseInt(r.metricValues[2].value || 0),
      engaged: parseInt(r.metricValues[3].value || 0),
    }))
    const pages = (pageData.rows || []).map(r => ({
      path: r.dimensionValues[0].value,
      pageviews: parseInt(r.metricValues[0].value || 0),
      sessions: parseInt(r.metricValues[1].value || 0),
      avgDuration: parseFloat(r.metricValues[2].value || 0),
      bounceRate: parseFloat(r.metricValues[3].value || 0) * 100,
    }))
    const devices = (deviceData.rows || []).map(r => ({
      device: r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value || 0),
      users: parseInt(r.metricValues[1].value || 0),
      conversions: parseInt(r.metricValues[2].value || 0),
      bounceRate: parseFloat(r.metricValues[3].value || 0) * 100,
      avgDuration: parseFloat(r.metricValues[4].value || 0),
    }))
    const sourceMedium = (sourceMediumData.rows || []).map(r => ({
      sourceMedium: r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value || 0),
      users: parseInt(r.metricValues[1].value || 0),
      newUsers: parseInt(r.metricValues[2].value || 0),
      engagementRate: parseFloat(r.metricValues[3].value || 0) * 100,
      conversions: parseInt(r.metricValues[4].value || 0),
      bounceRate: parseFloat(r.metricValues[5].value || 0) * 100,
    }))
    const landingPages = (landingData.rows || []).map(r => ({
      page: r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value || 0),
      users: parseInt(r.metricValues[1].value || 0),
      engagementRate: parseFloat(r.metricValues[2].value || 0) * 100,
      bounceRate: parseFloat(r.metricValues[3].value || 0) * 100,
      conversions: parseInt(r.metricValues[4].value || 0),
      avgDuration: parseFloat(r.metricValues[5].value || 0),
    }))
    const newVsReturning = (newRetData.rows || []).map(r => ({
      type: r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value || 0),
      users: parseInt(r.metricValues[1].value || 0),
      engagementRate: parseFloat(r.metricValues[2].value || 0) * 100,
      bounceRate: parseFloat(r.metricValues[3].value || 0) * 100,
      avgDuration: parseFloat(r.metricValues[4].value || 0),
      conversions: parseInt(r.metricValues[5].value || 0),
      pageviews: parseInt(r.metricValues[6].value || 0),
    }))
    const events = (eventsData.rows || []).map(r => ({
      name: r.dimensionValues[0].value,
      count: parseInt(r.metricValues[0].value || 0),
      users: parseInt(r.metricValues[1].value || 0),
    })).filter(e => !['session_start', 'first_visit', 'user_engagement'].includes(e.name))
    const DAY_ORDER = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }
    const dayOfWeek = (dowData.rows || []).map(r => ({
      day: r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value || 0),
      users: parseInt(r.metricValues[1].value || 0),
      conversions: parseInt(r.metricValues[2].value || 0),
      engagementRate: parseFloat(r.metricValues[3].value || 0) * 100,
    })).sort((a, b) => (DAY_ORDER[a.day] ?? 7) - (DAY_ORDER[b.day] ?? 7))
    const cities = (cityData.rows || []).map(r => ({
      city: r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value || 0),
      users: parseInt(r.metricValues[1].value || 0),
      conversions: parseInt(r.metricValues[2].value || 0),
    })).filter(c => c.city && c.city !== '(not set)')

    res.json({ current, previous, daily, sources, pages, devices, sourceMedium, landingPages, newVsReturning, events, dayOfWeek, cities })
  } catch (err) {
    console.error('[Performance/GA4]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// =====================================================================
// KIWIFY ROUTES
// =====================================================================
const KIWIFY_API = 'https://public-api.kiwify.com'
let kiwifyTokenCache = { token: null, expiresAt: 0 }

async function getKiwifyToken() {
  if (kiwifyTokenCache.token && Date.now() < kiwifyTokenCache.expiresAt) return kiwifyTokenCache.token
  if (!getKiwifyClientId() || !getKiwifyClientSecret()) return null
  const r = await fetch(`${KIWIFY_API}/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: getKiwifyClientId(), client_secret: getKiwifyClientSecret() }),
  })
  const data = await r.json()
  if (!data.access_token) throw new Error('Kiwify OAuth error: ' + JSON.stringify(data))
  kiwifyTokenCache = { token: data.access_token, expiresAt: Date.now() + 90 * 60 * 60 * 1000 }
  return kiwifyTokenCache.token
}

async function kiwifyFetch(path, params = {}) {
  const token = await getKiwifyToken()
  if (!token) throw new Error('Kiwify not configured')
  const url = new URL(`${KIWIFY_API}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const r = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${token}`, 'x-kiwify-account-id': getKiwifyAccountId() },
  })
  if (!r.ok) {
    const err = await r.text()
    throw new Error(`Kiwify API error ${r.status}: ${err}`)
  }
  return r.json()
}

async function fetchAllKiwifySales(startDate, endDate) {
  const sales = []
  let page = 1
  const pageSize = 100
  let hasMore = true
  while (hasMore) {
    const data = await kiwifyFetch('/v1/sales', {
      start_date: startDate, end_date: endDate,
      page_number: String(page), page_size: String(pageSize),
    })
    const items = data.data || data.sales || data || []
    if (Array.isArray(items)) {
      sales.push(...items)
      hasMore = items.length === pageSize
    } else {
      const list = items.data || []
      sales.push(...list)
      hasMore = list.length === pageSize
    }
    page++
    if (page > 50) break
  }
  return sales
}

router.get('/kiwify/sales', async (req, res) => {
  try {
    if (!getKiwifyClientId()) return res.json({ available: false })
    const { days = '30', since, until } = req.query
    const ranges = getDateRanges(parseInt(days), since, until)
    const [currentSales, previousSales, balanceData] = await Promise.all([
      fetchAllKiwifySales(ranges.current.since, ranges.current.until).catch(() => []),
      fetchAllKiwifySales(ranges.previous.since, ranges.previous.until).catch(() => []),
      kiwifyFetch('/v1/balance').catch(() => null),
    ])
    function processSales(sales) {
      const approved = sales.filter(s => (s.status || '').toLowerCase() === 'paid')
      const refunded = sales.filter(s => (s.status || '').toLowerCase() === 'refunded')
      const pending = sales.filter(s => (s.status || '').toLowerCase() === 'waiting_payment')
      const refused = sales.filter(s => (s.status || '').toLowerCase() === 'refused')
      const toReais = (v) => (typeof v === 'number' ? v : parseFloat(v || 0)) / 100
      const netRevenue = approved.reduce((sum, s) => sum + toReais(s.net_amount), 0)
      const byMethod = {}
      approved.forEach(s => {
        const method = (s.payment_method || 'unknown').toLowerCase()
        if (!byMethod[method]) byMethod[method] = { count: 0, revenue: 0 }
        byMethod[method].count++; byMethod[method].revenue += toReais(s.net_amount)
      })
      const byDay = {}
      approved.forEach(s => {
        const day = (s.created_at || '').split('T')[0]
        if (!day) return
        if (!byDay[day]) byDay[day] = { date: day, count: 0, revenue: 0 }
        byDay[day].count++; byDay[day].revenue += toReais(s.net_amount)
      })
      const byProduct = {}
      approved.forEach(s => {
        const name = s.product?.name || 'Produto'
        if (!byProduct[name]) byProduct[name] = { count: 0, revenue: 0 }
        byProduct[name].count++; byProduct[name].revenue += toReais(s.net_amount)
      })
      return {
        totalSales: sales.length, approvedCount: approved.length,
        refundedCount: refunded.length, pendingCount: pending.length,
        refusedCount: refused.length,
        totalRevenue: netRevenue, netRevenue,
        ticketMedio: approved.length > 0 ? netRevenue / approved.length : 0,
        approvalRate: sales.length > 0 ? ((approved.length / sales.length) * 100) : 0,
        refundRate: (approved.length + refunded.length) > 0 ? ((refunded.length / (approved.length + refunded.length)) * 100) : 0,
        byMethod,
        dailySales: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
        byProduct,
      }
    }
    const current = processSales(currentSales)
    const previous = processSales(previousSales)
    res.json({
      available: true, current, previous, ranges,
      balance: balanceData ? {
        available: (balanceData.available || 0) / 100,
        pending: (balanceData.pending || 0) / 100,
      } : null,
    })
  } catch (err) {
    console.error('[Performance/Kiwify]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/kiwify/products', async (req, res) => {
  try {
    if (!getKiwifyClientId()) return res.json({ available: false, products: [] })
    const data = await kiwifyFetch('/v1/products', { page_size: '50', page_number: '1' })
    res.json({ available: true, products: data.data || data || [] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// =====================================================================
// OVERVIEW (Aggregated from all sources)
// =====================================================================
// =====================================================================
// Cache em memoria do overview — TTL 5min
// Compartilhado entre /overview/:accountId e /all-clients-overview.
// =====================================================================
const overviewCache = new Map()
const OVERVIEW_TTL_MS = 5 * 60 * 1000

function overviewCacheKey(accountId, accountName, days, since, until) {
  return `${accountId}|${(accountName || '').toLowerCase()}|${days}|${since || ''}|${until || ''}`
}

async function buildOverviewCached(opts) {
  const k = overviewCacheKey(opts.accountId, opts.accountName, opts.days, opts.since, opts.until)
  const cached = overviewCache.get(k)
  if (cached && Date.now() - cached.ts < OVERVIEW_TTL_MS) return cached.data
  const data = await buildOverview(opts)
  overviewCache.set(k, { ts: Date.now(), data })
  // Limpa caches antigos pra nao vazar memoria
  if (overviewCache.size > 200) {
    const cutoff = Date.now() - OVERVIEW_TTL_MS
    for (const [key, val] of overviewCache.entries()) {
      if (val.ts < cutoff) overviewCache.delete(key)
    }
  }
  return data
}

// Funcao pura que agrega Meta + GAds + GA4 + IG + Kiwify + CRM pra uma conta.
// Retorna o JSON do overview (sources, totals, alerts, metaDaily).
// Reusada por /overview/:accountId (single client) e /all-clients-overview (loop).
async function buildOverview({ accountId, accountName, days, since, until }) {
  const ranges = getDateRanges(days, since, until)
  const promises = {}

  promises.meta = (async () => {
      try {
        // NOTA: 'video_3_sec_watched_actions' foi REMOVIDO da Meta API v21 — pedia esse field e o request inteiro falhava com erro #100. Hook Rate agora vem de actions[action_type=video_view].
        const fields = 'spend,impressions,clicks,cpc,ctr,cpm,reach,frequency,actions,cost_per_action_type,action_values'
        const [current, previous, campaigns] = await Promise.all([
          metaFetch(`/${accountId}/insights`, { fields, time_range: JSON.stringify(ranges.current), limit: '500' }).catch(err => { console.log(`[Performance/Meta] FAIL current account=${accountId}:`, err.message); return { data: [] } }),
          metaFetch(`/${accountId}/insights`, { fields, time_range: JSON.stringify(ranges.previous), limit: '500' }).catch(err => { console.log(`[Performance/Meta] FAIL previous account=${accountId}:`, err.message); return { data: [] } }),
          metaFetch(`/${accountId}/insights`, { fields: 'campaign_name,actions', time_range: JSON.stringify(ranges.current), level: 'campaign', limit: '500' }).catch(() => ({ data: [] })),
        ])
        console.log(`[Performance/Meta] RESULT account=${accountId} currentRows=${(current.data || []).length} previousRows=${(previous.data || []).length}`)
        let campaignLeads = 0, campaignMessaging = 0
        for (const camp of (campaigns.data || [])) {
          const getAct = (type) => { const a = camp.actions?.find(x => x.action_type === type); return a ? parseFloat(a.value) : 0 }
          const lead = getAct('lead') || getAct('onsite_conversion.lead_grouped')
          const msg = getAct('onsite_conversion.messaging_conversation_started_7d')
          if (lead > 0) campaignLeads += lead
          if (msg > 0) campaignMessaging += msg
        }
        if (campaignLeads === 0 && campaignMessaging === 0) {
          const getAct = (actions, type) => { const a = actions?.find(x => x.action_type === type); return a ? parseFloat(a.value) : 0 }
          const acct = current.data?.[0]
          if (acct) {
            campaignLeads = getAct(acct.actions, 'lead') || getAct(acct.actions, 'onsite_conversion.lead_grouped')
            campaignMessaging = getAct(acct.actions, 'onsite_conversion.messaging_conversation_started_7d')
          }
        }
        return { available: true, current: current.data?.[0] || null, previous: previous.data?.[0] || null, campaignLeads, campaignMessaging }
      } catch { return { available: false } }
    })()

    promises.metaDaily = (async () => {
      try {
        const data = await metaFetch(`/${accountId}/insights`, {
          fields: 'spend,clicks,actions',
          time_range: JSON.stringify(ranges.current),
          time_increment: '1', limit: '100',
        }).catch(() => ({ data: [] }))
        return data.data || []
      } catch { return [] }
    })()

    promises.gads = (async () => {
      try {
        const token = await getGadsAccessToken()
        if (!token) return { available: false }
        const accounts = await gaqlQuery(getGADS().loginCustomerId, `
          SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status
          FROM customer_client WHERE customer_client.manager = false AND customer_client.status = 'ENABLED'
        `)
        const lower = accountName.toLowerCase()
        const cleaned = lower.replace(/^(ca\s*-?\s*|[\d]+\s*-\s*)/i, '').trim()
        const GENERIC_WORDS = ['imobiliária', 'imobiliaria', 'imoveis', 'imóveis', 'construtora', 'conta', 'nova', 'venda', 'vendas', 'teste', 'mkt', 'marketing']
        const words = cleaned.split(/[\s\-]+/).filter(w => w.length >= 3 && !GENERIC_WORDS.includes(w))
        const match = accounts.find(r => {
          const name = (r.customerClient.descriptiveName || '').toLowerCase()
          return words.some(w => name.includes(w))
        })
        if (!match) return { available: false }
        const cid = String(match.customerClient.id)
        const results = await gaqlQuery(cid, `
          SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
          FROM campaign WHERE segments.date BETWEEN '${ranges.current.since}' AND '${ranges.current.until}' AND campaign.status != 'REMOVED'
        `)
        const prevResults = await gaqlQuery(cid, `
          SELECT metrics.cost_micros, metrics.clicks, metrics.conversions, metrics.conversions_value
          FROM campaign WHERE segments.date BETWEEN '${ranges.previous.since}' AND '${ranges.previous.until}' AND campaign.status != 'REMOVED'
        `).catch(() => [])
        function sumGads(rows) {
          return rows.reduce((t, r) => ({
            spend: t.spend + parseInt(r.metrics.costMicros || 0) / 1000000,
            clicks: t.clicks + parseInt(r.metrics.clicks || 0),
            impressions: t.impressions + parseInt(r.metrics.impressions || 0),
            conversions: t.conversions + parseFloat(r.metrics.conversions || 0),
            revenue: t.revenue + parseFloat(r.metrics.conversionsValue || 0),
          }), { spend: 0, clicks: 0, impressions: 0, conversions: 0, revenue: 0 })
        }
        return { available: true, current: sumGads(results), previous: sumGads(prevResults) }
      } catch { return { available: false } }
    })()

    promises.ga4 = (async () => {
      try {
        const props = getGA4Properties(accountName)
        if (!props || props.length === 0) return { available: false }
        const token = await getGadsAccessToken()
        if (!token) return { available: false }
        const propId = props[0].id
        const d = days
        const data = await ga4Report(propId, {
          dateRanges: [{ startDate: `${d}daysAgo`, endDate: 'yesterday' }, { startDate: `${d * 2}daysAgo`, endDate: `${d + 1}daysAgo` }],
          metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }, { name: 'bounceRate' }, { name: 'conversions' }, { name: 'engagementRate' }],
        }, token)
        function parseGA(row) {
          const v = row?.metricValues || []
          return { sessions: parseInt(v[0]?.value || 0), users: parseInt(v[1]?.value || 0), pageviews: parseInt(v[2]?.value || 0), bounceRate: parseFloat(v[3]?.value || 0) * 100, conversions: parseInt(v[4]?.value || 0), engagementRate: parseFloat(v[5]?.value || 0) * 100 }
        }
        const dailyData = await ga4Report(propId, {
          dateRanges: [{ startDate: `${d}daysAgo`, endDate: 'yesterday' }],
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ dimension: { dimensionName: 'date' } }],
        }, token).catch(() => ({ rows: [] }))
        const daily = (dailyData.rows || []).map(r => ({ date: r.dimensionValues[0].value, sessions: parseInt(r.metricValues[0].value || 0) }))
        return { available: true, current: parseGA(data.rows?.[0]), previous: parseGA(data.rows?.[1]), daily }
      } catch { return { available: false } }
    })()

    promises.crm = (async () => {
      try {
        const config = getCRMConfig(accountName)
        if (!config) return { available: false }
        const sheetName = config.type === 'kellermann' ? 'ENTRADA DE LEADS' : 'LEADS'
        const rows = await fetchSheetCSV(config.id, sheetName)
        const crmStart = new Date(ranges.current.since + 'T00:00:00')
        const crmEnd = new Date(ranges.current.until + 'T23:59:59')
        let crmLeads = []
        if (config.type === 'invista' || (!config.type || config.type === 'invista')) {
          const SKIP = ['Nome','DEZEMBRO','JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO']
          const VALID_ORIGENS = ['site - invistaimoveissm.com.br', 'facebook', 'instagram', 'whatsapp']
          const CORRETOR_DESQUAL = ['capao - claudia', 'capao da canoa', 'sem resposta', 'sem retorno', 'so informacao']
          const ESTADO_QUAL = ['em atendimento', 'em qualificacao', 'encaminhado ao setor', 'positiva', 'realmete transf']
          const ESTADO_DESQUAL = ['negatva', 'pausa temporariamente', 'sem evolucao', 'sem resposta']
          const stripAcc = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
          for (const row of rows) {
            if (row.length < 8) continue
            const ds = row[0], nm = row[3]
            if (!ds || !nm || SKIP.includes(nm) || ds === 'Data') continue
            const dt = parseBRDate(ds)
            if (!dt || dt < crmStart || dt > crmEnd) continue
            const orig = (row[6] || '').trim()
            if (!VALID_ORIGENS.includes(orig.toLowerCase())) continue
            const cor = (row[7] || '').trim()
            const est = (row[11] || '').trim()
            const corNorm = stripAcc(cor)
            const estNorm = stripAcc(est)
            const corInDesq = !cor || CORRETOR_DESQUAL.some(t => corNorm.includes(t))
            const estInQual = ESTADO_QUAL.some(t => estNorm.includes(t))
            const estInDesq = ESTADO_DESQUAL.some(t => estNorm.includes(t))
            let q = 'MEIO TERMO'
            if (!corInDesq && estInQual) q = 'SIM'
            else if (corInDesq && estInDesq) q = 'NÃO'
            crmLeads.push({ qualificacao: q })
          }
        } else if (config.type === 'sameco') {
          for (const row of rows) {
            if (row.length < 18) continue
            const id = row[0], createdTime = row[1], nome = row[16]
            if (!createdTime || !nome || nome === 'full_name' || id === 'ENTRADA DE LEADS - FORMULARIO') continue
            const dt = new Date(createdTime)
            if (isNaN(dt.getTime()) || dt < crmStart || dt > crmEnd) continue
            const qualRaw = (row[19] || '').trim()
            const qualNorm = qualRaw.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
            let q = 'MEIO TERMO'
            if (qualNorm.includes('VENDEU')) q = 'VENDEU'
            else if (qualNorm.startsWith('NAO')) q = 'NÃO'
            else if (qualNorm.includes('ORCAMENTO')) q = 'SIM'
            crmLeads.push({ qualificacao: q })
          }
        }
        const qualSim = crmLeads.filter(l => l.qualificacao === 'SIM').length
        const qualNao = crmLeads.filter(l => l.qualificacao === 'NÃO').length
        const qualMeio = crmLeads.filter(l => l.qualificacao === 'MEIO TERMO').length
        return { available: true, crmType: config.type, qualSim, qualNao, qualMeio, crmTotal: crmLeads.length }
      } catch { return { available: false } }
    })()

    promises.instagram = (async () => {
      try {
        let allPages = []
        let url = `${META_BASE}/me/accounts?fields=id,name,instagram_business_account{id,name,username,followers_count}&limit=100&access_token=${getMetaToken()}`
        while (url) {
          const resp = await fetch(url)
          const data = await resp.json()
          if (data.error) break
          allPages = allPages.concat(data.data || [])
          url = data.paging?.next || null
        }
        const lower = accountName.toLowerCase()
        const cleaned = lower.replace(/^(ca\s*-?\s*|[\d]+\s*-\s*)/i, '').trim()
        const words = cleaned.split(/[\s\-]+/).filter(w => w.length >= 3)
        const match = allPages.find(p => {
          if (!p.instagram_business_account) return false
          const pageLower = (p.name || '').toLowerCase()
          const userLower = (p.instagram_business_account.username || '').toLowerCase()
          return words.some(w => pageLower.includes(w) || userLower.includes(w))
        })
        if (!match) return { available: false }
        const igId = match.instagram_business_account.id
        const followers = match.instagram_business_account.followers_count || 0
        const toUnix = (dateStr) => Math.floor(new Date(dateStr + 'T00:00:00').getTime() / 1000)
        const sinceU = String(toUnix(ranges.current.since))
        const untilU = String(toUnix(ranges.current.until) + 86400)
        const insights = await metaFetch(`/${igId}/insights`, {
          metric: 'reach,total_interactions', metric_type: 'total_value',
          period: 'day', since: sinceU, until: untilU,
        }).catch(() => ({ data: [] }))
        let reach = 0, interactions = 0
        ;(insights.data || []).forEach(m => {
          const val = m.total_value?.value || 0
          if (m.name === 'reach') reach = val
          if (m.name === 'total_interactions') interactions = val
        })
        return { available: true, followers, reach, interactions, username: match.instagram_business_account.username }
      } catch { return { available: false } }
    })()

    promises.kiwify = (async () => {
      try {
        if (!getKiwifyClientId()) return { available: false }
        const isJosi = accountName.toLowerCase().includes('josi') || accountName.toLowerCase().includes('josiane')
        if (!isJosi) return { available: false }
        const [curSales, prevSales] = await Promise.all([
          fetchAllKiwifySales(ranges.current.since, ranges.current.until).catch(() => []),
          fetchAllKiwifySales(ranges.previous.since, ranges.previous.until).catch(() => []),
        ])
        const toReais = (v) => (typeof v === 'number' ? v : parseFloat(v || 0)) / 100
        const approved = curSales.filter(s => s.status?.toLowerCase() === 'paid')
        const prevApproved = prevSales.filter(s => s.status?.toLowerCase() === 'paid')
        const revenue = approved.reduce((s, sale) => s + toReais(sale.net_amount), 0)
        const prevRevenue = prevApproved.reduce((s, sale) => s + toReais(sale.net_amount), 0)
        return { available: true, sales: approved.length, prevSales: prevApproved.length, revenue, prevRevenue }
      } catch { return { available: false } }
    })()

    const results = {}
    for (const [key, promise] of Object.entries(promises)) {
      results[key] = await promise
    }

    const overview = { sources: {} }

    if (results.meta?.available && results.meta.current) {
      const mc = results.meta.current
      const mp = results.meta.previous
      // Debug: loga as chaves que o Meta API retornou pra esse account
      console.log(`[Performance/Meta] account=${accountId} fields presentes:`, Object.keys(mc || {}).join(','))
      const getAct = (actions, type) => { const a = actions?.find(x => x.action_type === type); return a ? parseFloat(a.value) : 0 }
      const metaSpend = parseFloat(mc.spend || 0)
      const prevMetaSpend = mp ? parseFloat(mp.spend || 0) : 0
      const metaImpressions = parseInt(mc.impressions || 0)
      const prevMetaImpressions = mp ? parseInt(mp.impressions || 0) : 0
      const metaClicks = parseInt(mc.clicks || 0)
      const prevMetaClicks = mp ? parseInt(mp.clicks || 0) : 0
      const metaReach = parseInt(mc.reach || 0)
      const prevMetaReach = mp ? parseInt(mp.reach || 0) : 0
      const metaLeads = results.meta.campaignLeads
      const metaMessaging = results.meta.campaignMessaging
      const metaPurchases = getAct(mc.actions, 'purchase')
      const metaLinkClicks = getAct(mc.actions, 'link_click')
      const prevMetaLinkClicks = mp ? getAct(mp.actions, 'link_click') : 0
      const prevLeads = mp ? (getAct(mp.actions, 'lead') || getAct(mp.actions, 'onsite_conversion.lead_grouped')) : 0
      const prevMessaging = mp ? getAct(mp.actions, 'onsite_conversion.messaging_conversation_started_7d') : 0
      // Video 3s views (pra hook rate) — agora vem do array actions
      const video3s = getAct(mc.actions, 'video_view')
      const prevVideo3s = mp ? getAct(mp.actions, 'video_view') : 0
      // Metricas: prefere field direto da Meta API quando existe (cpm, ctr, frequency),
      // calcula localmente apenas quando o Meta nao retorna (ctrLink, hookRate).
      const cpm = parseFloat(mc.cpm || 0) || (metaImpressions > 0 ? (metaSpend / metaImpressions) * 1000 : 0)
      const prevCpm = mp ? (parseFloat(mp.cpm || 0) || (prevMetaImpressions > 0 ? (prevMetaSpend / prevMetaImpressions) * 1000 : 0)) : 0
      const ctr = parseFloat(mc.ctr || 0) || (metaImpressions > 0 ? (metaClicks / metaImpressions) * 100 : 0)
      const prevCtr = mp ? (parseFloat(mp.ctr || 0) || (prevMetaImpressions > 0 ? (prevMetaClicks / prevMetaImpressions) * 100 : 0)) : 0
      const ctrLink = metaImpressions > 0 ? (metaLinkClicks / metaImpressions) * 100 : 0
      const prevCtrLink = prevMetaImpressions > 0 ? (prevMetaLinkClicks / prevMetaImpressions) * 100 : 0
      const hookRate = metaImpressions > 0 && video3s > 0 ? (video3s / metaImpressions) * 100 : 0
      const prevHookRate = prevMetaImpressions > 0 && prevVideo3s > 0 ? (prevVideo3s / prevMetaImpressions) * 100 : 0
      const frequency = parseFloat(mc.frequency || 0)
      const prevFrequency = mp ? parseFloat(mp.frequency || 0) : 0
      overview.sources.meta = {
        spend: metaSpend, prevSpend: prevMetaSpend,
        impressions: metaImpressions, prevImpressions: prevMetaImpressions,
        reach: metaReach, prevReach: prevMetaReach,
        clicks: metaClicks, prevClicks: prevMetaClicks,
        leads: metaLeads, prevLeads,
        messaging: metaMessaging, prevMessaging,
        purchases: metaPurchases, linkClicks: metaLinkClicks, prevLinkClicks: prevMetaLinkClicks,
        // Metricas calculadas com deltas
        cpm, prevCpm,
        ctr, prevCtr,
        ctrLink, prevCtrLink,
        hookRate, prevHookRate,
        frequency, prevFrequency,
      }
    }

    if (results.metaDaily?.length > 0) {
      overview.metaDaily = results.metaDaily.map(d => {
        const getAct = (actions, type) => { const a = actions?.find(x => x.action_type === type); return a ? parseFloat(a.value) : 0 }
        return {
          date: d.date_start,
          spend: parseFloat(d.spend || 0),
          leads: (getAct(d.actions, 'lead') || getAct(d.actions, 'onsite_conversion.lead_grouped')) + getAct(d.actions, 'onsite_conversion.messaging_conversation_started_7d'),
        }
      })
    }

    if (results.gads?.available) {
      overview.sources.gads = {
        spend: results.gads.current.spend, prevSpend: results.gads.previous.spend,
        clicks: results.gads.current.clicks,
        impressions: results.gads.current.impressions,
        conversions: results.gads.current.conversions, prevConversions: results.gads.previous.conversions,
        revenue: results.gads.current.revenue,
      }
    }
    if (results.ga4?.available) {
      overview.sources.ga4 = {
        sessions: results.ga4.current.sessions, prevSessions: results.ga4.previous?.sessions || 0,
        users: results.ga4.current.users, prevUsers: results.ga4.previous?.users || 0,
        pageviews: results.ga4.current.pageviews,
        bounceRate: results.ga4.current.bounceRate,
        engagementRate: results.ga4.current.engagementRate,
        conversions: results.ga4.current.conversions,
        daily: results.ga4.daily || [],
      }
    }
    if (results.instagram?.available) {
      overview.sources.instagram = {
        followers: results.instagram.followers,
        reach: results.instagram.reach,
        interactions: results.instagram.interactions,
        username: results.instagram.username,
      }
    }
    if (results.kiwify?.available) {
      overview.sources.kiwify = {
        sales: results.kiwify.sales, prevSales: results.kiwify.prevSales,
        revenue: results.kiwify.revenue, prevRevenue: results.kiwify.prevRevenue,
      }
    }
    if (results.crm?.available) {
      overview.sources.crm = {
        available: true, crmType: results.crm.crmType,
        qualSim: results.crm.qualSim || 0,
        qualNao: results.crm.qualNao || 0,
        qualMeio: results.crm.qualMeio || 0,
        crmTotal: results.crm.crmTotal || 0,
      }
    }

    const totalSpend = (overview.sources.meta?.spend || 0) + (overview.sources.gads?.spend || 0)
    const prevTotalSpend = (overview.sources.meta?.prevSpend || 0) + (overview.sources.gads?.prevSpend || 0)
    const metaConversions = Math.round((overview.sources.meta?.leads || 0) + (overview.sources.meta?.messaging || 0))
    const prevMetaConversions = Math.round((overview.sources.meta?.prevLeads || 0) + (overview.sources.meta?.prevMessaging || 0))
    const gadsConversions = Math.round(overview.sources.gads?.conversions || 0)
    const prevGadsConversions = Math.round(overview.sources.gads?.prevConversions || 0)
    const totalLeads = metaConversions + gadsConversions
    const prevTotalLeads = prevMetaConversions + prevGadsConversions
    const totalRevenue = (overview.sources.kiwify?.revenue || 0) + (overview.sources.gads?.revenue || 0)
    const prevTotalRevenue = (overview.sources.kiwify?.prevRevenue || 0)

    overview.totals = {
      spend: totalSpend, prevSpend: prevTotalSpend,
      leads: totalLeads, prevLeads: prevTotalLeads,
      metaConversions, prevMetaConversions, gadsConversions, prevGadsConversions,
      sessions: overview.sources.ga4?.sessions || 0, prevSessions: overview.sources.ga4?.prevSessions || 0,
      revenue: totalRevenue, prevRevenue: prevTotalRevenue,
      cpl: totalLeads > 0 ? totalSpend / totalLeads : 0,
      prevCpl: prevTotalLeads > 0 ? prevTotalSpend / prevTotalLeads : 0,
      roas: totalSpend > 0 && totalRevenue > 0 ? totalRevenue / totalSpend : 0,
    }
    overview.alerts = []
    if (overview.sources.ga4?.bounceRate > 70) overview.alerts.push({ type: 'warning', text: `Taxa de rejeicao do site alta: ${overview.sources.ga4.bounceRate.toFixed(1)}%` })

    return overview
}

// Handler /overview/:accountId — casca que usa buildOverviewCached
router.get('/overview/:accountId', async (req, res) => {
  try {
    const accountName = resolveAccountName(req)
    const days = parseInt(req.query.days || '7')
    const { since, until } = req.query
    const overview = await buildOverviewCached({ accountId: req.params.accountId, accountName, days, since, until })
    res.json(overview)
  } catch (err) {
    console.error('[Performance/Overview]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Agregado de TODOS os clientes vinculados — admin only (dono/gerente)
// Itera clients ativos com pelo menos 1 vinculo, chama buildOverviewCached em paralelo,
// retorna array com { client, overview, error }. Falha de um nao derruba os outros.
router.get('/all-clients-overview', async (req, res) => {
  if (!req.user || !['dono', 'gerente'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  try {
    const days = parseInt(req.query.days || '7')
    // Limpa o cache antes de processar (forca recalculo fresh enquanto debugamos
    // metricas Meta que estavam vindo zeradas). Reativar cache quando estabilizar.
    overviewCache.clear()
    const clients = db.prepare(`
      SELECT id, name, logo_url,
             core_client_name, core_meta_account_id, core_gads_customer_id,
             core_ig_page_id, core_ga4_property_id
      FROM clients
      WHERE is_active = 1
        AND (core_meta_account_id IS NOT NULL
          OR core_gads_customer_id IS NOT NULL
          OR core_ga4_property_id IS NOT NULL
          OR core_ig_page_id IS NOT NULL
          OR core_client_name IS NOT NULL)
      ORDER BY name
    `).all()

    const items = await Promise.all(clients.map(async (c) => {
      const clientInfo = {
        id: c.id, name: c.name, logo_url: c.logo_url,
        hasMeta: !!c.core_meta_account_id,
        hasGads: !!c.core_gads_customer_id,
        hasGA4: !!c.core_ga4_property_id,
        hasIG: !!c.core_ig_page_id,
      }
      const accountId = c.core_meta_account_id || ''
      const accountName = (c.core_client_name || c.name || '').trim()
      try {
        const overview = await buildOverviewCached({ accountId, accountName, days })
        return { client: clientInfo, overview, error: null }
      } catch (err) {
        console.error(`[all-clients-overview] cliente ${c.id} (${c.name}):`, err.message)
        return { client: clientInfo, overview: null, error: err.message || 'erro desconhecido' }
      }
    }))

    res.json({ days, clients: items })
  } catch (err) {
    console.error('[all-clients-overview]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
export { publicRouter }
