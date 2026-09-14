// =====================================================================
// Modal de criar/editar template de tarefa recorrente.
// Usado em /tarefas-recorrentes (admin) E como botao "+ Recorrencia" no Pipeline/Tarefas.
// =====================================================================
import { useState, useEffect } from 'react'
import {
  fetchTaskTemplate, createTaskTemplate, updateTaskTemplate,
  fetchClients, fetchDepartments, fetchUsers, fetchCategories,
  type TaskTemplateSubtask, type Client, type Department, type User as UserT, type TaskCategory,
} from '../lib/api'
import { Plus, X } from 'lucide-react'
import { useToast } from './Toast'
import AssigneesMultiSelect from './AssigneesMultiSelect'

const WEEKDAYS = [
  { v: 1, label: 'Segunda-feira' }, { v: 2, label: 'Terca-feira' }, { v: 3, label: 'Quarta-feira' },
  { v: 4, label: 'Quinta-feira' }, { v: 5, label: 'Sexta-feira' }, { v: 6, label: 'Sabado' }, { v: 7, label: 'Domingo' },
]
const HOURS = Array.from({ length: 24 }, (_, h) => h)

interface FormState {
  id?: number
  name: string
  task_type: 'normal' | 'mae'
  client_id: string
  category_id: string
  department_id: string
  title: string
  description: string
  priority: string
  drive_link: string
  drive_link_raw: string
  approval_link: string
  approval_text: string
  publish_date: string
  publish_objective: string
  due_date_offset_days: number
  recurrence_type: 'weekly' | 'monthly'
  recurrence_day: number
  recurrence_hour: number
  mode: 'auto' | 'on_complete'
  sequential_subtasks: boolean
  assigned_to: string[]
  subtasks: TaskTemplateSubtask[]
  is_active: boolean
  is_recurring: boolean   // false = biblioteca de modelo (nao roda automatico)
}

const BLANK_FORM: FormState = {
  name: '', task_type: 'normal', client_id: '', category_id: '', department_id: '',
  title: '', description: '', priority: 'normal',
  drive_link: '', drive_link_raw: '', approval_link: '', approval_text: '',
  publish_date: '', publish_objective: '',
  due_date_offset_days: 7,
  recurrence_type: 'monthly', recurrence_day: 1, recurrence_hour: 6,
  mode: 'on_complete',
  sequential_subtasks: false,
  assigned_to: [], subtasks: [], is_active: true, is_recurring: true,
}

interface Props {
  open: boolean
  editId?: number | null
  onClose: () => void
  onSaved: () => void
}

export default function TaskTemplateModal({ open, editId, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [clients, setClients] = useState<Client[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [allUsers, setAllUsers] = useState<UserT[]>([])
  const [categories, setCategories] = useState<TaskCategory[]>([])
  const { toast } = useToast()

  useEffect(() => {
    if (!open) return
    fetchClients().then(setClients).catch(() => {})
    fetchDepartments().then(setDepartments).catch(() => {})
    fetchUsers().then(u => setAllUsers(u as any)).catch(() => {})
    fetchCategories().then(setCategories).catch(() => {})
  }, [open])

  useEffect(() => {
    if (!open) return
    if (editId) {
      fetchTaskTemplate(editId).then(t => {
        let approvalFiles: string[] = []
        try { approvalFiles = t.approval_files ? JSON.parse(t.approval_files) : [] } catch {}
        setForm({
          id: t.id,
          name: t.name,
          task_type: t.task_type,
          client_id: String(t.client_id || ''),
          category_id: t.category_id ? String(t.category_id) : '',
          department_id: t.department_id ? String(t.department_id) : '',
          title: t.title,
          description: t.description || '',
          priority: t.priority || 'normal',
          drive_link: t.drive_link || '',
          drive_link_raw: t.drive_link_raw || '',
          approval_link: approvalFiles[0] || t.approval_link || '',
          approval_text: t.approval_text || '',
          publish_date: t.publish_date || '',
          publish_objective: t.publish_objective || '',
          due_date_offset_days: t.due_date_offset_days || 7,
          recurrence_type: t.recurrence_type,
          recurrence_day: t.recurrence_day,
          recurrence_hour: t.recurrence_hour,
          mode: (t.mode === 'auto' || t.mode === 'on_complete') ? t.mode : 'auto',
          sequential_subtasks: !!(t as any).sequential_subtasks,
          assigned_to: (t.assigned_to || []).map(String),
          subtasks: (t.subtasks || []).map(s => ({ ...s, assigned_to: s.assigned_to || [] })),
          is_active: !!t.is_active,
          is_recurring: (t as any).is_recurring == null ? true : !!(t as any).is_recurring,
        })
      }).catch((e: any) => toast(e?.message || 'Erro ao carregar', 'error'))
    } else {
      setForm(BLANK_FORM)
    }
  }, [open, editId])

  const handleSave = async () => {
    if (!form.name || !form.client_id || !form.title) {
      toast('Nome, cliente e titulo obrigatorios', 'error')
      return
    }
    setSaving(true)
    try {
      const payload: any = {
        name: form.name,
        task_type: form.task_type,
        client_id: +form.client_id,
        category_id: form.category_id ? +form.category_id : null,
        department_id: form.department_id ? +form.department_id : null,
        title: form.title,
        description: form.description || null,
        priority: form.priority,
        drive_link: form.drive_link || null,
        drive_link_raw: form.drive_link_raw || null,
        approval_link: form.approval_link || null,
        approval_files: form.approval_link ? [form.approval_link] : [],
        approval_text: form.approval_text || null,
        publish_date: form.publish_date || null,
        publish_objective: form.publish_objective || null,
        due_date_offset_days: +form.due_date_offset_days,
        is_recurring: form.is_recurring ? 1 : 0,
        recurrence_type: form.recurrence_type,
        recurrence_day: +form.recurrence_day,
        recurrence_hour: +form.recurrence_hour,
        mode: form.mode,
        sequential_subtasks: form.sequential_subtasks ? 1 : 0,
        assigned_to: form.assigned_to.map(Number),
        subtasks: form.subtasks.map((s, i) => ({
          subtask_position: i + 1,
          title: s.title,
          description: s.description || null,
          priority: s.priority || 'normal',
          category_id: s.category_id || null,
          department_id: s.department_id || null,
          due_date_offset_days: s.due_date_offset_days != null ? +s.due_date_offset_days : null,
          drive_link: s.drive_link || null,
          drive_link_raw: s.drive_link_raw || null,
          approval_link: s.approval_link || null,
          approval_files: s.approval_link ? [s.approval_link] : [],
          approval_text: s.approval_text || null,
          publish_date: s.publish_date || null,
          publish_objective: s.publish_objective || null,
          assigned_to: (s.assigned_to || []).map(Number),
        })),
        is_active: form.is_active,
      }
      if (form.id) await updateTaskTemplate(form.id, payload)
      else await createTaskTemplate(payload)
      toast(form.id ? 'Template atualizado' : 'Recorrencia criada')
      onSaved()
      onClose()
    } catch (e: any) { toast(e?.message || 'Erro ao salvar', 'error') }
    finally { setSaving(false) }
  }

  const addSubtaskRow = () => {
    setForm(p => ({ ...p, subtasks: [...p.subtasks, { title: '', priority: 'normal', due_date_offset_days: p.due_date_offset_days, assigned_to: [] }] }))
  }
  const updateSubtask = (idx: number, patch: Partial<TaskTemplateSubtask>) => {
    setForm(p => ({ ...p, subtasks: p.subtasks.map((s, i) => i === idx ? { ...s, ...patch } : s) }))
  }
  const removeSubtask = (idx: number) => {
    setForm(p => ({ ...p, subtasks: p.subtasks.filter((_, i) => i !== idx) }))
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 720, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <h2>{form.id ? 'Editar Template' : 'Novo Template'}</h2>

        {/* Toggle: recorrente (roda automatico) vs biblioteca (aplicacao manual) */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, padding: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
          <button type="button" onClick={() => setForm(p => ({ ...p, is_recurring: true }))}
            style={{ flex: 1, padding: '10px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: form.is_recurring ? 'rgba(255,179,0,0.14)' : 'transparent', color: form.is_recurring ? '#FFB300' : '#9B96B0', fontFamily: 'inherit', fontSize: 13, fontWeight: 700 }}>
            Recorrente (roda automatico)
          </button>
          <button type="button" onClick={() => setForm(p => ({ ...p, is_recurring: false }))}
            style={{ flex: 1, padding: '10px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: !form.is_recurring ? 'rgba(126,231,135,0.14)' : 'transparent', color: !form.is_recurring ? '#7ee787' : '#9B96B0', fontFamily: 'inherit', fontSize: 13, fontWeight: 700 }}>
            Modelo (aplicar manual)
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#9B96B0', marginBottom: 14, lineHeight: 1.5 }}>
          {form.is_recurring
            ? 'Roda automatico na frequencia configurada abaixo. Cada execucao cria uma tarefa nova.'
            : 'Fica salvo como modelo. Nunca cria tarefa sozinho. Voce aplica manualmente quando precisar (botao "Usar modelo" ao criar tarefa mae).'}
        </div>

        <div style={{ padding: '14px 16px', background: 'rgba(255,179,0,0.04)', border: '1px solid rgba(255,179,0,0.15)', borderRadius: 10, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>{form.is_recurring ? 'Agendamento' : 'Modelo'}</div>
          <div className="form-group"><label>Nome do template (interno) *</label><input className="input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Edicao de Video / Linha Editorial / Subir Anuncio" /></div>
          <div className="form-row">
            <div className="form-group">
              <label>Tipo de tarefa</label>
              <select className="select" value={form.task_type} onChange={e => setForm(p => ({ ...p, task_type: e.target.value as any }))}>
                <option value="normal">Tarefa normal</option>
                <option value="mae">Tarefa Mae (com subtarefas)</option>
              </select>
            </div>
            <div className="form-group">
              <label>Prazo da tarefa</label>
              <input className="input" type="number" min={0} value={form.due_date_offset_days} onChange={e => setForm(p => ({ ...p, due_date_offset_days: +e.target.value || 0 }))} />
              <small style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>+N dias apos criacao</small>
            </div>
          </div>
          {form.is_recurring && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label>Frequencia</label>
                  <select className="select" value={form.recurrence_type} onChange={e => setForm(p => ({ ...p, recurrence_type: e.target.value as any }))}>
                    <option value="monthly">Mensal</option>
                    <option value="weekly">Semanal</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>{form.recurrence_type === 'weekly' ? 'Dia da semana' : 'Dia do mes'}</label>
                  {form.recurrence_type === 'weekly' ? (
                    <select className="select" value={form.recurrence_day} onChange={e => setForm(p => ({ ...p, recurrence_day: +e.target.value }))}>
                      {WEEKDAYS.map(w => <option key={w.v} value={w.v}>{w.label}</option>)}
                    </select>
                  ) : (
                    <select className="select" value={form.recurrence_day} onChange={e => setForm(p => ({ ...p, recurrence_day: +e.target.value }))}>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>Dia {d}</option>)}
                    </select>
                  )}
                </div>
                <div className="form-group">
                  <label>Hora</label>
                  <select className="select" value={form.recurrence_hour} onChange={e => setForm(p => ({ ...p, recurrence_hour: +e.target.value }))}>
                    {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                </div>
              </div>
              {form.recurrence_type === 'monthly' && form.recurrence_day === 31 && (
                <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 6 }}>Em meses com menos de 31 dias, vai usar o ultimo dia disponivel (28/29/30).</div>
              )}
              <div className="form-group" style={{ marginTop: 12, padding: 10, background: 'rgba(155,89,182,0.05)', border: '1px solid rgba(155,89,182,0.2)', borderRadius: 6 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Comportamento da recorrencia</label>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 8 }}>
                  <input type="radio" name="tpl-mode" value="on_complete" checked={form.mode === 'on_complete'} onChange={() => setForm(p => ({ ...p, mode: 'on_complete' }))} style={{ marginTop: 3 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>So gera a proxima quando eu concluir a atual</div>
                    <small style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block', marginTop: 2 }}>Nao acumula tarefas se voce nao concluir no prazo. Ao criar, ja entra 1 tarefa na sua lista.</small>
                  </div>
                </label>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                  <input type="radio" name="tpl-mode" value="auto" checked={form.mode === 'auto'} onChange={() => setForm(p => ({ ...p, mode: 'auto' }))} style={{ marginTop: 3 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>Sempre criar na data marcada</div>
                    <small style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block', marginTop: 2 }}>Cron cria uma nova tarefa toda vez que bate a data, mesmo se ha tarefas anteriores em aberto. Pode acumular.</small>
                  </div>
                </label>
              </div>
            </>
          )}
        </div>

        <div className="form-row">
          <div className="form-group"><label>Titulo da tarefa *</label><input className="input" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
          <div className="form-group"><label>Cliente *</label><select className="select" value={form.client_id} onChange={e => setForm(p => ({ ...p, client_id: e.target.value }))}><option value="">Selecione</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        </div>
        <div className="form-group"><label>Descricao</label><textarea className="input" rows={2} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
        <div className="form-row">
          <div className="form-group"><label>Categoria</label><select className="select" value={form.category_id} onChange={e => setForm(p => ({ ...p, category_id: e.target.value }))}><option value="">Nenhuma</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="form-group"><label>Departamento</label><select className="select" value={form.department_id} onChange={e => setForm(p => ({ ...p, department_id: e.target.value }))}><option value="">Nenhum</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <div className="form-group"><label>Prioridade</label><select className="select" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></div>
        </div>
        <div className="form-group">
          <label>Responsaveis</label>
          <AssigneesMultiSelect users={allUsers} selected={form.assigned_to} onChange={arr => setForm(p => ({ ...p, assigned_to: arr }))} />
        </div>
        <div className="form-row">
          <div className="form-group"><label>Link Drive Bruto</label><input className="input" value={form.drive_link_raw} onChange={e => setForm(p => ({ ...p, drive_link_raw: e.target.value }))} /></div>
          <div className="form-group"><label>Link Drive Pronto</label><input className="input" value={form.drive_link} onChange={e => setForm(p => ({ ...p, drive_link: e.target.value }))} /></div>
        </div>

        {form.task_type === 'mae' && (
          <div style={{ padding: '14px 16px', background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)', borderRadius: 10, marginTop: 12 }}>
            <div style={{ marginBottom: 12, padding: 10, background: 'rgba(255,179,0,0.06)', border: '1px solid rgba(255,179,0,0.25)', borderRadius: 6 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 0 }}>
                <input type="checkbox" checked={form.sequential_subtasks} onChange={e => setForm(p => ({ ...p, sequential_subtasks: e.target.checked }))} style={{ marginTop: 3 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Concluir subtarefas em ordem</div>
                  <small style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block', marginTop: 2 }}>Cada execucao dessa recorrencia bloqueia conclusao fora de ordem. Sub 2 so pode fechar depois da 1, e assim por diante.</small>
                </div>
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Subtarefas ({form.subtasks.length})</div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addSubtaskRow}><Plus size={11} /> Adicionar subtarefa</button>
            </div>
            {form.subtasks.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>Sem subtarefas. Cada execucao criara uma mae vazia.</div>
            )}
            {form.subtasks.map((sub, idx) => (
              <div key={idx} style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 8, marginBottom: 8, border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>SUB {idx + 1}</span>
                  <button type="button" onClick={() => removeSubtask(idx)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }} title="Remover"><X size={12} /></button>
                </div>
                <div className="form-row">
                  <div className="form-group"><label>Titulo *</label><input className="input" value={sub.title} onChange={e => updateSubtask(idx, { title: e.target.value })} /></div>
                  <div className="form-group"><label>Prazo (+N dias)</label><input className="input" type="number" min={0} value={sub.due_date_offset_days ?? ''} onChange={e => updateSubtask(idx, { due_date_offset_days: e.target.value === '' ? null : +e.target.value })} /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label>Departamento</label><select className="select" value={sub.department_id || ''} onChange={e => updateSubtask(idx, { department_id: e.target.value ? +e.target.value : null })}><option value="">Nenhum</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
                  <div className="form-group"><label>Prioridade</label><select className="select" value={sub.priority || 'normal'} onChange={e => updateSubtask(idx, { priority: e.target.value })}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></div>
                </div>
                <div className="form-group">
                  <label>Responsaveis</label>
                  <AssigneesMultiSelect
                    users={allUsers}
                    selected={(sub.assigned_to || []).map(String)}
                    onChange={arr => updateSubtask(idx, { assigned_to: arr.map(Number) })}
                  />
                </div>
                <div className="form-group"><label>Descricao</label><textarea className="input" rows={2} value={sub.description || ''} onChange={e => updateSubtask(idx, { description: e.target.value })} /></div>
              </div>
            ))}
          </div>
        )}

        {form.id && (
          <div className="form-group" style={{ marginTop: 12 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} />
              Template ativo (gera tarefas no horario agendado)
            </label>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : (form.id ? 'Salvar' : 'Criar template')}</button>
        </div>
      </div>
    </div>
  )
}
