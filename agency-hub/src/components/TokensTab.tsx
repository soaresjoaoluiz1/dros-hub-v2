// =====================================================================
// Configuracoes -> aba Tokens
// Lista tokens conhecidos (Meta, Google, Kiwify) agrupados.
// Secrets mostrados mascarados (****1234) com toggle Eye/EyeOff.
// Cada token tem instrucoes em acordeao "Como obter".
// =====================================================================
import { useEffect, useState } from 'react'
import { fetchSettings, updateSetting, type AppSetting } from '../lib/api'
import { Eye, EyeOff, Check, X, ChevronDown, ChevronRight, Loader2, Info } from 'lucide-react'
import { useToast } from './Toast'

export default function TokensTab() {
  const [settings, setSettings] = useState<AppSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [expandedHelp, setExpandedHelp] = useState<Set<string>>(new Set())
  const { toast } = useToast()

  const load = () => {
    setLoading(true)
    fetchSettings().then(setSettings).catch(e => toast(e.message, 'error')).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const startEdit = (key: string) => setEdits(p => ({ ...p, [key]: '' }))
  const cancelEdit = (key: string) => setEdits(p => { const n = { ...p }; delete n[key]; return n })
  const toggleReveal = (key: string) => setRevealed(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })
  const toggleHelp = (key: string) => setExpandedHelp(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })

  const save = async (key: string) => {
    const value = edits[key] ?? ''
    setSaving(p => new Set(p).add(key))
    try {
      await updateSetting(key, value)
      toast('Token salvo', 'success')
      setEdits(p => { const n = { ...p }; delete n[key]; return n })
      load()
    } catch (e: any) {
      toast(e?.message || 'Erro ao salvar', 'error')
    } finally {
      setSaving(p => { const n = new Set(p); n.delete(key); return n })
    }
  }

  // Agrupa por group
  const groups: Record<string, AppSetting[]> = {}
  settings.forEach(s => {
    if (!groups[s.group]) groups[s.group] = []
    groups[s.group].push(s)
  })

  if (loading) return <div className="loading-container" style={{ minHeight: 200 }}><div className="spinner" /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ padding: '14px 16px', background: 'rgba(255,179,0,0.04)', border: '1px solid rgba(255,179,0,0.15)', borderRadius: 10, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Info size={18} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Tokens cadastrados aqui sao usados pelo Painel de Performance. Vazios = fallback pro <code>.env</code> da VPS (transicao sem quebra). Apenas dono ve esta secao.
        </div>
      </div>

      {Object.entries(groups).map(([groupName, items]) => (
        <div key={groupName} className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: 15, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {groupName}
          </h3>

          {items.map(s => {
            const editing = edits[s.key] !== undefined
            const isRevealed = revealed.has(s.key)
            const isHelpOpen = expandedHelp.has(s.key)
            const isSaving = saving.has(s.key)
            const displayValue = editing ? (edits[s.key] || '') : (isRevealed && s.has_value && !s.is_secret ? s.value : s.value)
            const inputType = s.is_secret && !isRevealed && !editing ? 'password' : 'text'

            return (
              <div key={s.key} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, gap: 12 }}>
                  <label style={{ fontWeight: 600, fontSize: 13 }}>{s.label}</label>
                  <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                    {s.has_value && <span style={{ color: 'var(--positive)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Check size={11} /> Configurado</span>}
                    {!s.has_value && s.from_env_fallback && <span style={{ color: '#FFB300' }}>Fallback .env</span>}
                    {!s.has_value && !s.from_env_fallback && <span style={{ color: '#FF6B6B' }}>Nao configurado</span>}
                  </div>
                </div>

                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 8px 0', lineHeight: 1.4 }}>{s.description}</p>

                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      className="input"
                      type={inputType}
                      placeholder={editing ? 'Cole o novo valor aqui...' : (s.has_value ? (s.is_secret ? s.value : '(valor atual)') : 'Vazio - usando fallback ou nao configurado')}
                      value={editing ? (edits[s.key] || '') : ''}
                      disabled={!editing}
                      onChange={e => setEdits(p => ({ ...p, [s.key]: e.target.value }))}
                      style={{ paddingRight: s.is_secret ? 36 : 12 }}
                    />
                    {s.is_secret && editing && (
                      <button type="button" onClick={() => toggleReveal(s.key)} title={isRevealed ? 'Esconder' : 'Mostrar'} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
                        {isRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    )}
                  </div>

                  {!editing && <button className="btn btn-secondary btn-sm" onClick={() => startEdit(s.key)}>{s.has_value ? 'Trocar' : 'Cadastrar'}</button>}
                  {editing && (
                    <>
                      <button className="btn btn-primary btn-sm" onClick={() => save(s.key)} disabled={isSaving}>
                        {isSaving ? <Loader2 size={12} className="spin" /> : <Check size={12} />} Salvar
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => cancelEdit(s.key)}><X size={12} /></button>
                    </>
                  )}
                </div>

                <button type="button" onClick={() => toggleHelp(s.key)} style={{ marginTop: 8, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: 'inherit', padding: 0 }}>
                  {isHelpOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Como obter
                </button>
                {isHelpOpen && (
                  <ol style={{ margin: '6px 0 0 24px', padding: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    {s.howto.map((step, i) => <li key={i} style={{ marginBottom: 3 }}>{step}</li>)}
                  </ol>
                )}

                {s.updated_at && (
                  <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                    Atualizado em {new Date(s.updated_at + '-03:00').toLocaleString('pt-BR')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}

      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 }}>
        Apos salvar, a mudanca e usada imediatamente nas proximas requisicoes do Painel.
        Nao precisa reiniciar o servidor.
      </div>
    </div>
  )
}
