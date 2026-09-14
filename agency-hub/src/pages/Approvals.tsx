import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useSSE } from '../context/SSEContext'
import { fetchInternalApprovals, fetchClientApprovals, approveTask, rejectTask, requestChanges, fetchPendingRequests, approveTaskRequest, rejectTaskRequest, apiFetch, type Task } from '../lib/api'
import { CheckCircle, XCircle, ExternalLink, Building2, User, Clock, Eye, MessageSquare, RotateCcw } from 'lucide-react'
import { useToast } from '../components/Toast'

export default function Approvals() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isDono = user?.role === 'dono' || user?.role === 'gerente'
  const isCliente = user?.role === 'cliente'
  const [internalTasks, setInternalTasks] = useState<Task[]>([])
  const [clientTasks, setClientTasks] = useState<Task[]>([])
  const [requestTasks, setRequestTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [rejectId, setRejectId] = useState<number | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [changesId, setChangesId] = useState<number | null>(null)
  const [changesText, setChangesText] = useState('')
  const [activeTab, setActiveTab] = useState<'internal' | 'client' | 'requests'>(isDono ? 'internal' : 'client')
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)

  const tasks = activeTab === 'internal' ? internalTasks : activeTab === 'client' ? clientTasks : requestTasks

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (isDono) {
        const [internal, client, requests] = await Promise.all([
          fetchInternalApprovals(),
          apiFetch<{ tasks: Task[] }>('/api/approvals/client').then(d => d.tasks),
          fetchPendingRequests(),
        ])
        setInternalTasks(internal); setClientTasks(client); setRequestTasks(requests)
      } else if (isCliente) {
        setClientTasks(await fetchClientApprovals())
      }
    } catch {}
    setLoading(false)
  }, [isDono, isCliente])

  useEffect(() => { load() }, [load])
  useSSE('task:stage_changed', useCallback(() => load(), [load]))

  const handleApprove = async (id: number) => {
    setSaving(true)
    try {
      if (activeTab === 'requests') await approveTaskRequest(id)
      else await approveTask(id)
      load()
      toast(activeTab === 'requests' ? 'Solicitacao aprovada!' : 'Tarefa aprovada!')
    } catch (err: any) { toast(err.message || 'Erro ao aprovar', 'error') }
    finally { setSaving(false) }
  }
  const handleReject = async () => {
    if (!rejectId || !rejectReason) return
    setSaving(true)
    try {
      if (activeTab === 'requests') await rejectTaskRequest(rejectId, rejectReason)
      else await rejectTask(rejectId, rejectReason)
      setRejectId(null); setRejectReason(''); load()
      toast('Tarefa rejeitada')
    } catch (err: any) { toast(err.message || 'Erro ao rejeitar', 'error') }
    finally { setSaving(false) }
  }
  const handleRequestChanges = async () => {
    if (!changesId || !changesText.trim()) return
    setSaving(true)
    try {
      await requestChanges(changesId, changesText)
      setChangesId(null); setChangesText(''); load()
      toast('Alteracao solicitada! A equipe sera notificada.')
    } catch (err: any) { toast(err.message || 'Erro ao solicitar alteracao', 'error') }
    finally { setSaving(false) }
  }

  if (loading) return <div className="loading-container"><div className="spinner" /></div>

  return (
    <div>
      <div className="page-header">
        <h1><CheckCircle size={22} style={{ marginRight: 8 }} /> Aprovacoes</h1>
        {isDono && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button className={`btn btn-sm ${activeTab === 'internal' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('internal')}>
              Interna ({internalTasks.length})
            </button>
            <button className={`btn btn-sm ${activeTab === 'client' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('client')}>
              Cliente ({clientTasks.length})
            </button>
            <button className={`btn btn-sm ${activeTab === 'requests' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('requests')}>
              <MessageSquare size={12} /> Solicitacoes ({requestTasks.length})
            </button>
          </div>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="empty-state"><div className="icon">✅</div><h3>Nenhuma aprovacao pendente</h3><p>Todas as tarefas estao em dia.</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tasks.map(t => (
            <div key={t.id} className="card" style={{ borderLeft: `3px solid ${t.stage_color || '#FFB300'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => navigate(`/tasks/${t.id}`)}>
                  <div style={{ fontSize: 17, fontWeight: 700, fontFamily: 'var(--font-heading)', marginBottom: 6 }}>{t.title}</div>
                  {t.description && !isCliente && <div style={{ fontSize: 13, color: '#A8A3B8', marginBottom: 8, lineHeight: 1.5, maxHeight: 60, overflow: 'hidden' }}>{t.description}</div>}
                  <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#A8A3B8', flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Building2 size={12} />{t.client_name}</span>
                    {!isCliente && t.department_name && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: t.department_color }} />{t.department_name}</span>}
                    {!isCliente && t.assigned_name && <span><User size={12} /> {t.assigned_name}</span>}
                    {!isCliente && t.due_date && <span style={{ color: new Date(t.due_date) < new Date() ? '#FF6B6B' : undefined }}><Clock size={12} /> {t.due_date.slice(0, 10)}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => { if (confirm('Confirma a aprovacao desta tarefa?')) handleApprove(t.id) }} disabled={saving}><CheckCircle size={14} /> Aprovar</button>
                  {isCliente && activeTab !== 'requests' && <button className="btn btn-sm" style={{ background: '#FFB300', color: '#1a1625', border: 'none' }} onClick={() => setChangesId(t.id)}><RotateCcw size={14} /> Solicitar Alteracao</button>}
                  <button className="btn btn-danger btn-sm" onClick={() => setRejectId(t.id)}><XCircle size={14} /> Rejeitar</button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
                {t.drive_link && (
                  <a href={t.drive_link} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" onClick={e => e.stopPropagation()}>
                    <ExternalLink size={12} /> Abrir no Drive
                  </a>
                )}
                {isCliente ? (
                  <button onClick={() => navigate(`/tasks/${t.id}`)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 18px', background: 'linear-gradient(135deg, #FFB300, #FFAA83)', color: '#1a1625', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(255,179,0,0.2)', textTransform: 'uppercase', letterSpacing: '0.03em', fontFamily: 'inherit' }}>
                    <Eye size={14} /> Ver Detalhes da Tarefa
                  </button>
                ) : (
                  <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/tasks/${t.id}`)}>
                    <Eye size={12} /> Ver Detalhes
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {rejectId && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setRejectId(null))() }}><div className="modal" onClick={e => e.stopPropagation()}>
          <h2>Rejeitar Tarefa</h2>
          <div className="form-group"><label>Motivo *</label><textarea className="input" rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="O que precisa ser alterado..." /></div>
          <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setRejectId(null)}>Cancelar</button><button className="btn btn-danger" onClick={handleReject} disabled={saving || !rejectReason.trim()}>{saving ? 'Rejeitando...' : 'Rejeitar'}</button></div>
        </div></div>
      )}

      {changesId && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setChangesId(null))() }}><div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
          <h2><RotateCcw size={18} style={{ marginRight: 8, verticalAlign: 'middle', color: '#FFB300' }} />Solicitar Alteracao</h2>
          <p style={{ fontSize: 12, color: '#9B96B0', marginTop: -6, marginBottom: 16 }}>Descreva de forma <strong>clara e objetiva</strong> o que precisa ser alterado. A tarefa voltara pra revisao da equipe com suas instrucoes.</p>
          <div className="form-group">
            <label>O que deseja alterar? *</label>
            <textarea className="input" rows={6} value={changesText} onChange={e => setChangesText(e.target.value)}
              placeholder="Seja especifico. Indique o arquivo e o que deseja de forma objetiva e detalhada. Ex: No video 2, trocar a musica de fundo. No post 3, corrigir o nome do produto..."
            />
          </div>
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={() => setChangesId(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={handleRequestChanges} disabled={saving || !changesText.trim()}>{saving ? 'Enviando...' : 'Enviar Solicitacao'}</button>
          </div>
        </div></div>
      )}
    </div>
  )
}
