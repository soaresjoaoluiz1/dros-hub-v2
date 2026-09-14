import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check, Loader } from 'lucide-react'
import { apiFetch } from '../lib/api'

interface CoreAccount { id: string; name: string }

// Source mappings — qual endpoint chamar e como extrair ID/nome
type Source = 'meta' | 'ig' | 'gads' | 'ga4'
const SOURCE_CONFIG: Record<Source, { endpoint: string; mapItem: (a: any) => CoreAccount; placeholder: string }> = {
  meta: {
    endpoint: '/api/performance/meta/accounts',
    mapItem: (a) => ({ id: a.id, name: a.name }),
    placeholder: 'Selecione a conta Meta Ads...',
  },
  ig: {
    endpoint: '/api/performance/instagram/accounts',
    // /instagram/accounts retorna {pageId, pageName, id (IG id), name, username, ...}
    // Guardamos pageId (FB Page ID) porque e o que /me/accounts retorna no filtro.
    mapItem: (a) => ({ id: a.pageId, name: `${a.pageName} (@${a.username || a.name})` }),
    placeholder: 'Selecione a pagina/IG vinculada...',
  },
  gads: {
    endpoint: '/api/performance/google-ads/accounts',
    mapItem: (a) => ({ id: a.id, name: a.name || `Conta ${a.id}` }),
    placeholder: 'Selecione a conta Google Ads...',
  },
  ga4: {
    endpoint: '/api/performance/analytics/admin-properties',
    mapItem: (a) => ({ id: a.id, name: a.name || `Property ${a.id}` }),
    placeholder: 'Selecione a property GA4...',
  },
}

interface Props {
  // Modo "name" (compat com uso antigo): onChange recebe o nome. value e o nome guardado.
  // Modo "id": onChange recebe o ID. value e o ID guardado. Mostra o nome na input quando fechada.
  mode?: 'name' | 'id'
  source?: Source
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

export default function CoreAccountSelect({ value, onChange, placeholder, source = 'meta', mode = 'name' }: Props) {
  const cfg = SOURCE_CONFIG[source]
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [accounts, setAccounts] = useState<CoreAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const loadAccounts = () => {
    if (loaded || loading) return
    setLoading(true); setError(null)
    apiFetch(cfg.endpoint)
      .then((d: any) => { setAccounts((d.accounts || []).map(cfg.mapItem)); setLoaded(true) })
      .catch((e: any) => setError(e?.message || 'Falha ao carregar'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const filterText = query.trim().toLowerCase()
  const filtered = filterText
    ? accounts.filter(a => a.name.toLowerCase().includes(filterText) || a.id.toLowerCase().includes(filterText))
    : accounts

  const handleSelect = (a: CoreAccount) => {
    onChange(mode === 'id' ? a.id : a.name)
    setQuery('')
    setOpen(false)
  }

  // Pra exibir nome quando mode='id' e value e o ID
  const displayValue = (() => {
    if (mode !== 'id') return value
    const match = accounts.find(a => a.id === value)
    return match ? match.name : value
  })()

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          className="input"
          value={open ? query : displayValue}
          onChange={e => {
            setQuery(e.target.value)
            // Em mode 'id', so atualiza onChange ao selecionar item do dropdown (texto livre nao vira ID)
            if (mode === 'name') onChange(e.target.value)
            if (!open) { setOpen(true); loadAccounts() }
          }}
          onFocus={() => { setQuery(mode === 'id' ? displayValue : value); setOpen(true); loadAccounts() }}
          placeholder={placeholder || cfg.placeholder}
          autoComplete="off"
          style={{ paddingRight: 32, width: '100%' }}
        />
        <button
          type="button"
          onClick={() => { setOpen(o => { if (!o) loadAccounts(); return !o }) }}
          aria-label="Abrir lista"
          style={{ position: 'absolute', right: 8, top: '50%', transform: `translateY(-50%) ${open ? 'rotate(180deg)' : ''}`, background: 'none', border: 'none', color: '#9B96B0', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', transition: 'transform 0.15s' }}
        >
          <ChevronDown size={16} />
        </button>
      </div>
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: '#1a1428', border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 8, maxHeight: 280, overflowY: 'auto', zIndex: 100,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
        >
          {loading && (
            <div style={{ padding: '14px 14px', fontSize: 12, color: '#9B96B0', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Loader size={14} className="spinning" /> Carregando contas...
            </div>
          )}
          {error && !loading && (
            <div style={{ padding: '12px 14px', fontSize: 12, color: '#FF6B6B' }}>{error}</div>
          )}
          {!loading && !error && filtered.length === 0 && filterText && mode === 'name' && (
            <div
              onClick={() => handleSelect({ id: '__custom__', name: query.trim() })}
              style={{ padding: '10px 14px', fontSize: 13, color: '#FFB300', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            >
              Usar "<strong>{query.trim()}</strong>" (busca por substring)
            </div>
          )}
          {!loading && !error && filtered.length === 0 && !filterText && (
            <div style={{ padding: '14px', fontSize: 12, color: '#6B6580', textAlign: 'center' }}>Nenhuma conta encontrada</div>
          )}
          {!loading && !error && filtered.map(a => {
            const isSelected = mode === 'id' ? a.id === value : a.name === value
            return (
              <div
                key={a.id}
                onClick={() => handleSelect(a)}
                style={{
                  padding: '10px 14px', fontSize: 13, color: '#F2F0F7', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: isSelected ? 'rgba(255,179,0,0.08)' : 'transparent',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                <span>{a.name}</span>
                {isSelected && <Check size={14} style={{ color: '#FFB300' }} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
