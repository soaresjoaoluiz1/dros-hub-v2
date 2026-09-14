// =====================================================================
// Tarefas recorrentes — admin (dono/gerente)
// Lista de templates. Criar/editar usa TaskTemplateModal (componente compartilhado).
// =====================================================================
import { useState, useEffect } from 'react'
import {
  fetchTaskTemplates, deleteTaskTemplate, runTaskTemplate,
  type TaskTemplate,
} from '../lib/api'
import { Repeat, Plus, Play, Pencil, Trash2, Pause, CheckCircle2 } from 'lucide-react'
import { useToast } from '../components/Toast'
import TaskTemplateModal from '../components/TaskTemplateModal'

const WEEKDAYS = [
  { v: 1, label: 'Segunda-feira' }, { v: 2, label: 'Terca-feira' }, { v: 3, label: 'Quarta-feira' },
  { v: 4, label: 'Quinta-feira' }, { v: 5, label: 'Sexta-feira' }, { v: 6, label: 'Sabado' }, { v: 7, label: 'Domingo' },
]

function formatFrequency(t: TaskTemplate) {
  const modeSuffix = t.mode === 'on_complete' ? ' · ao concluir' : t.mode === 'auto' ? ' · sempre' : ''
  if (t.recurrence_type === 'weekly') {
    const day = WEEKDAYS.find(w => w.v === t.recurrence_day)?.label || `Dia ${t.recurrence_day}`
    return `Semanal · ${day} ${String(t.recurrence_hour).padStart(2, '0')}:00${modeSuffix}`
  }
  return `Mensal · Dia ${t.recurrence_day} ${String(t.recurrence_hour).padStart(2, '0')}:00${modeSuffix}`
}

function formatDateBR(s: string | null) {
  if (!s) return '—'
  const d = new Date(s + '-03:00')
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function TaskTemplates() {
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const { toast } = useToast()

  const load = () => {
    setLoading(true)
    fetchTaskTemplates().then(setTemplates).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const openNew = () => { setEditId(null); setModalOpen(true) }
  const openEdit = (id: number) => { setEditId(id); setModalOpen(true) }
  const close = () => { setModalOpen(false); setEditId(null) }

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Pausar/arquivar o template "${name}"? Ele para de gerar tarefas. Pode ser reativado depois.`)) return
    try { await deleteTaskTemplate(id); load(); toast('Template arquivado') }
    catch (e: any) { toast(e?.message || 'Erro', 'error') }
  }

  const handleRunNow = async (id: number, name: string) => {
    if (!confirm(`Criar uma tarefa agora a partir de "${name}"?`)) return
    try {
      const r = await runTaskTemplate(id)
      toast(`Tarefa criada (id ${r.task_id}, ${r.subtasks_created} subtarefas)`)
      load()
    } catch (e: any) { toast(e?.message || 'Erro ao executar', 'error') }
  }

  return (
    <div>
      <div className="page-header">
        <h1><Repeat size={20} style={{ marginRight: 8, verticalAlign: -3 }} /> Tarefas Recorrentes</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
          Templates que criam tarefas automaticamente em intervalos definidos
        </p>
        <div className="page-header-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={openNew}><Plus size={14} /> Nova Recorrencia</button>
        </div>
      </div>

      {loading ? (
        <div className="loading-container" style={{ minHeight: 200 }}><div className="spinner" /></div>
      ) : templates.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          Nenhum template criado. Clica em "Nova Recorrencia" pra comecar.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="campaign-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Nome / Cliente</th>
                <th>Tipo</th>
                <th>Frequencia</th>
                <th>Proxima execucao</th>
                <th>Ultima execucao</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {templates.map(t => (
                <tr key={t.id} style={{ opacity: t.is_active ? 1 : 0.55 }}>
                  <td className="name">
                    <div style={{ fontWeight: 700 }}>{t.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {t.client_name} · "{t.title}"
                    </div>
                  </td>
                  <td>
                    {t.task_type === 'mae' ? (
                      <span className="stage-badge" style={{ background: 'rgba(255,179,0,0.15)', color: 'var(--accent)', borderColor: 'rgba(255,179,0,0.3)' }}>
                        Mae ({t.subtasks_count || 0} subs)
                      </span>
                    ) : (
                      <span className="stage-badge" style={{ background: 'rgba(155,89,182,0.15)', color: '#c39bda', borderColor: 'rgba(155,89,182,0.3)' }}>
                        Normal
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>{formatFrequency(t)}</td>
                  <td style={{ fontSize: 12 }}>{formatDateBR(t.next_run_at)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDateBR(t.last_run_at)}</td>
                  <td>
                    {t.is_active ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--positive)' }}>
                        <CheckCircle2 size={12} /> Ativa
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                        <Pause size={12} /> Arquivada
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleRunNow(t.id, t.name)} title="Executar agora" style={{ padding: '4px 8px' }}><Play size={12} /></button>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(t.id)} title="Editar" style={{ padding: '4px 8px' }}><Pencil size={12} /></button>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleDelete(t.id, t.name)} title="Arquivar" style={{ padding: '4px 8px' }}><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TaskTemplateModal open={modalOpen} editId={editId} onClose={close} onSaved={load} />
    </div>
  )
}
