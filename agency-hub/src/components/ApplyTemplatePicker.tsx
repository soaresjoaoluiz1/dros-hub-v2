// Picker: abre e permite escolher um modelo (task_template com is_recurring=0 OU 1)
// pra aplicar como tarefa mae. Mostra checklist de subtarefas pro user desmarcar as que nao quer.
// Ao confirmar, chama /task-templates/:id/run-now com payload { include_subtask_ids: [...] }.
import { useEffect, useState } from 'react'
import { apiFetch, type TaskTemplate } from '../lib/api'
import { X, Layers, Check, Repeat, ListChecks } from 'lucide-react'
import { useToast } from './Toast'

interface Props {
  open: boolean
  clientId?: number | null      // filtra modelos por cliente (se null, mostra todos)
  onClose: () => void
  onApplied: (taskId: number) => void
}

interface TemplateWithSubs extends TaskTemplate {
  subtasks?: Array<{ id: number; subtask_position: number; title: string; description?: string | null }>
}

export default function ApplyTemplatePicker({ open, clientId, onClose, onApplied }: Props) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedTpl, setSelectedTpl] = useState<TemplateWithSubs | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [includedSubIds, setIncludedSubIds] = useState<Set<number>>(new Set())
  const [applying, setApplying] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    if (!open) return
    setLoading(true)
    const qs = new URLSearchParams({ only_active: '1' })
    if (clientId) qs.set('client_id', String(clientId))
    apiFetch<{ templates: TaskTemplate[] }>(`/api/task-templates?${qs}`)
      .then(d => setTemplates(d.templates))
      .catch((e: any) => toast(e?.message || 'Erro ao listar templates', 'error'))
      .finally(() => setLoading(false))
  }, [open, clientId])

  useEffect(() => {
    if (!open) { setSelectedTpl(null); setIncludedSubIds(new Set()) }
  }, [open])

  const openDetail = async (tpl: TaskTemplate) => {
    setLoadingDetail(true)
    try {
      const d = await apiFetch<{ template: TemplateWithSubs }>(`/api/task-templates/${tpl.id}`)
      setSelectedTpl(d.template)
      // Por padrao inclui TODAS as subtarefas
      setIncludedSubIds(new Set((d.template.subtasks || []).map((s: any) => s.id)))
    } catch (e: any) { toast(e?.message || 'Erro ao carregar template', 'error') }
    setLoadingDetail(false)
  }

  const toggleSub = (id: number) => {
    setIncludedSubIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const handleApply = async () => {
    if (!selectedTpl) return
    setApplying(true)
    try {
      const body: any = {}
      if ((selectedTpl.subtasks || []).length > 0) {
        body.include_subtask_ids = [...includedSubIds]
      }
      const r = await apiFetch<{ task_id: number; subtasks_created: number }>(`/api/task-templates/${selectedTpl.id}/run-now`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      toast(`Tarefa criada (${r.subtasks_created} subs)`)
      onApplied(r.task_id)
      onClose()
    } catch (e: any) { toast(e?.message || 'Erro ao aplicar', 'error') }
    setApplying(false)
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 640, maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ListChecks size={18} style={{ color: '#FFB300' }} />
          {selectedTpl ? `Aplicar: ${selectedTpl.name}` : 'Usar modelo de tarefa'}
        </h2>
        {!selectedTpl && (
          <p style={{ fontSize: 12, color: '#9B96B0', marginTop: -6, marginBottom: 14, lineHeight: 1.5 }}>
            Escolhe um modelo pra criar a tarefa mae ja com as subtarefas prontas. Voce vai poder desmarcar as subs que nao precisar antes de confirmar.
          </p>
        )}

        {!selectedTpl ? (
          loading ? (
            <div className="loading-container" style={{ minHeight: 120 }}><div className="spinner" /></div>
          ) : templates.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#9B96B0', fontSize: 13 }}>
              Nenhum modelo disponivel{clientId ? ' pra este cliente' : ''}.<br />
              <small style={{ fontSize: 11, color: '#6B6580' }}>Crie modelos em Recorrencias → Novo Template.</small>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {templates.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openDetail(t)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px',
                    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', color: '#F0EDF5',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,179,0,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,179,0,0.25)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{t.name}</span>
                    {(t as any).is_recurring === 0 ? (
                      <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(126,231,135,0.15)', color: '#7ee787', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', border: '1px solid rgba(126,231,135,0.3)' }}>Modelo</span>
                    ) : (
                      <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(155,89,182,0.15)', color: '#c39bda', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', border: '1px solid rgba(155,89,182,0.3)' }}><Repeat size={8} style={{ verticalAlign: -1 }} /> Recorrente</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#9B96B0', flexWrap: 'wrap' }}>
                    <span>{t.client_name}</span>
                    <span>"{t.title}"</span>
                    {t.task_type === 'mae' && <span style={{ color: '#FFB300' }}><Layers size={10} /> {(t as any).subtasks_count || 0} subs</span>}
                  </div>
                </button>
              ))}
            </div>
          )
        ) : (
          loadingDetail ? (
            <div className="loading-container" style={{ minHeight: 120 }}><div className="spinner" /></div>
          ) : (
            <>
              <div style={{ padding: 12, background: 'rgba(255,179,0,0.05)', border: '1px solid rgba(255,179,0,0.15)', borderRadius: 8, marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: '#9B96B0', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>Vai criar</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#F0EDF5', marginBottom: 4 }}>{selectedTpl.title}</div>
                <div style={{ fontSize: 12, color: '#9B96B0' }}>Cliente: {selectedTpl.client_name}</div>
              </div>

              {(selectedTpl.subtasks || []).length > 0 && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB300', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Subtarefas a criar ({includedSubIds.size}/{(selectedTpl.subtasks || []).length})
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button type="button" onClick={() => setIncludedSubIds(new Set((selectedTpl.subtasks || []).map((s: any) => s.id)))} className="btn btn-secondary btn-sm" style={{ fontSize: 10, padding: '3px 8px' }}>Todas</button>
                      <button type="button" onClick={() => setIncludedSubIds(new Set())} className="btn btn-secondary btn-sm" style={{ fontSize: 10, padding: '3px 8px' }}>Nenhuma</button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                    {(selectedTpl.subtasks || []).map((sub: any) => {
                      const included = includedSubIds.has(sub.id)
                      return (
                        <label key={sub.id} style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
                          background: included ? 'rgba(52,199,89,0.06)' : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${included ? 'rgba(52,199,89,0.25)' : 'rgba(255,255,255,0.06)'}`,
                          borderRadius: 6, cursor: 'pointer',
                        }}>
                          <input type="checkbox" checked={included} onChange={() => toggleSub(sub.id)} style={{ marginTop: 3, accentColor: '#34C759' }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: included ? '#F0EDF5' : '#9B96B0', fontWeight: 600 }}>
                              {sub.subtask_position}. {sub.title}
                            </div>
                            {sub.description && <div style={{ fontSize: 11, color: '#6B6580', marginTop: 2 }}>{sub.description}</div>}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </>
              )}

              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setSelectedTpl(null)} disabled={applying}>← Voltar</button>
                <button className="btn btn-primary" onClick={handleApply} disabled={applying}>
                  <Check size={14} /> {applying ? 'Criando...' : `Criar ${includedSubIds.size > 0 ? `com ${includedSubIds.size} subs` : 'sem subs'}`}
                </button>
              </div>
            </>
          )
        )}

        {!selectedTpl && (
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={onClose}>Fechar</button>
          </div>
        )}
      </div>
    </div>
  )
}
