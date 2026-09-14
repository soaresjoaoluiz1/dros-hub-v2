// Dropdown multi-select de responsaveis — padrao visual das outras "listas pra baixo"
// (usa mesmo estilo do <select className="select">, expande pra painel com search + checkboxes)
import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check, Users, X } from 'lucide-react'

interface UserLike { id: number; name: string; role?: string; is_active?: number }

interface Props {
  users: UserLike[]
  selected: string[]                          // array de ids como string (formato ja usado no state existente)
  onChange: (next: string[]) => void
  placeholder?: string
  maxHeight?: number                          // altura do painel dropdown (default 280)
  disabled?: boolean
}

export default function AssigneesMultiSelect({ users, selected, onChange, placeholder = 'Selecionar responsaveis', maxHeight = 280, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const active = users.filter(u => u.role !== 'cliente' && u.is_active !== 0)
  const filtered = q.trim() ? active.filter(u => u.name.toLowerCase().includes(q.toLowerCase())) : active
  const selectedUsers = active.filter(u => selected.includes(String(u.id)))

  const toggle = (id: number) => {
    const s = String(id)
    if (selected.includes(s)) onChange(selected.filter(x => x !== s))
    else onChange([...selected, s])
  }
  const clearAll = () => onChange([])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="select"
        disabled={disabled}
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', textAlign: 'left', cursor: disabled ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between',
          minHeight: 36, opacity: disabled ? 0.6 : 1,
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selectedUsers.length === 0 ? '#6B6580' : '#F0EDF5', fontSize: 12 }}>
          {selectedUsers.length === 0 ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Users size={12} /> {placeholder}</span>
          ) : selectedUsers.length === 1 ? (
            selectedUsers[0].name
          ) : (
            `${selectedUsers.length} responsaveis: ${selectedUsers.map(u => u.name.split(' ')[0]).join(', ')}`
          )}
        </span>
        <ChevronDown size={14} style={{ color: '#6B6580', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
          background: 'var(--bg-card, #1a1225)', border: '1px solid rgba(255,179,0,0.25)', borderRadius: 8,
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}>
          <div style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              className="input"
              autoFocus
              placeholder="Buscar..."
              value={q}
              onChange={e => setQ(e.target.value)}
              style={{ flex: 1, fontSize: 12, padding: '6px 10px' }}
            />
            {selected.length > 0 && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={clearAll} title="Limpar selecao" style={{ padding: '5px 8px', fontSize: 10 }}>
                <X size={11} /> {selected.length}
              </button>
            )}
          </div>
          <div style={{ maxHeight, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: '#6B6580' }}>Ninguem encontrado</div>
            ) : (
              filtered.map(u => {
                const sel = selected.includes(String(u.id))
                return (
                  <button
                    type="button"
                    key={u.id}
                    onClick={() => toggle(u.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                      padding: '9px 12px', background: sel ? 'rgba(52,199,89,0.08)' : 'transparent',
                      border: 'none', borderBottom: '1px solid rgba(255,255,255,0.03)',
                      color: sel ? '#F0EDF5' : '#A8A3B8', fontSize: 13, cursor: 'pointer',
                      textAlign: 'left', fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = sel ? 'rgba(52,199,89,0.14)' : 'rgba(255,255,255,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = sel ? 'rgba(52,199,89,0.08)' : 'transparent'}
                  >
                    <span style={{
                      width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                      border: `2px solid ${sel ? '#34C759' : 'rgba(255,255,255,0.15)'}`,
                      background: sel ? '#34C759' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {sel && <Check size={10} strokeWidth={3} color="#0A0118" />}
                    </span>
                    {u.name}
                    {u.role && u.role !== 'funcionario' && (
                      <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6B6580', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{u.role}</span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
