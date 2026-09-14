import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'

export const BANCOS = [
  // Tradicionais
  'Banco do Brasil',
  'Bradesco',
  'Caixa Econômica',
  'Itaú',
  'Santander',
  'Banrisul',
  'Banese',
  'Banestes',
  'Banco do Nordeste',
  'Banco da Amazônia',
  // Digitais / Fintechs
  'Nubank',
  'Inter',
  'C6 Bank',
  'Neon',
  'Will Bank',
  'Next',
  'Iti',
  'BS2',
  'Cora',
  'Stone',
  'Conta Simples',
  // Cooperativas
  'Sicoob',
  'Sicredi',
  'Unicred',
  'Cresol',
  // Investimentos
  'BTG Pactual',
  'XP Investimentos',
  'Rico',
  'Genial Investimentos',
  'Modal',
  // Médios
  'Safra',
  'Banco Pan',
  'Banco Original',
  'Banco BMG',
  'Banco Mercantil',
  'Daycoval',
  'ABC Brasil',
  'BV (Votorantim)',
  'Banco Bari',
  'Sofisa',
  'Tribanco',
  // Pagamentos / Carteiras
  'Asaas',
  'PicPay',
  'Pagseguro',
  'PagBank',
  'Mercado Pago',
  'Ame Digital',
  '99Pay',
  'Recargapay',
  'PJBank',
  // Outros
  'Dinheiro / Caixa',
]

export default function BankSelect({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

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
    ? BANCOS.filter(b => b.toLowerCase().includes(filterText))
    : BANCOS

  const handleSelect = (b: string) => {
    onChange(b)
    setQuery('')
    setOpen(false)
  }

  const handleInputChange = (v: string) => {
    setQuery(v)
    onChange(v)
    if (!open) setOpen(true)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          className="input"
          value={open ? query : value}
          onChange={e => handleInputChange(e.target.value)}
          onFocus={() => { setQuery(value); setOpen(true) }}
          placeholder={placeholder || 'Selecionar ou digitar banco'}
          autoComplete="off"
          style={{ paddingRight: 32, width: '100%' }}
        />
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
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
            borderRadius: 8, maxHeight: 240, overflowY: 'auto', zIndex: 100,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
        >
          {filtered.length === 0 && filterText && (
            <div
              onClick={() => handleSelect(query.trim())}
              style={{ padding: '10px 14px', fontSize: 13, color: '#FFB300', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            >
              Usar "<strong>{query.trim()}</strong>"
            </div>
          )}
          {filtered.map(b => {
            const isSelected = b === value
            return (
              <div
                key={b}
                onClick={() => handleSelect(b)}
                style={{
                  padding: '10px 14px', fontSize: 13, color: '#F2F0F7', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: isSelected ? 'rgba(255,179,0,0.08)' : 'transparent',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                <span>{b}</span>
                {isSelected && <Check size={14} style={{ color: '#FFB300' }} />}
              </div>
            )
          })}
          {filtered.length === 0 && !filterText && (
            <div style={{ padding: '12px 14px', fontSize: 12, color: '#6B6580', textAlign: 'center' }}>Nenhum resultado</div>
          )}
        </div>
      )}
    </div>
  )
}
