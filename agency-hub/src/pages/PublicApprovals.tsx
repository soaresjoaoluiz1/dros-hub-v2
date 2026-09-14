import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle, XCircle, RotateCcw, ExternalLink, Calendar, Target } from 'lucide-react'
import { isDriveUrl, toDriveEmbedUrl } from '../lib/drive'
import { getApprovalFiles } from '../lib/api'

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

interface PublicTask {
  id: number
  title: string
  description: string | null
  approval_link: string | null
  approval_files?: string | null
  approval_text: string | null
  publish_date: string | null
  publish_objective: string | null
  task_type?: string | null
  parent_task_id?: number | null
  subtask_kind?: string | null
  stage_name: string
  stage_color: string
  category_name?: string | null
  category_color?: string | null
  comments: Array<{ content: string; user_name: string | null; created_at: string }>
}

interface PublicData {
  client: { id: number; name: string; logo_url: string | null }
  tasks: PublicTask[]
}

export default function PublicApprovals() {
  const { token } = useParams()
  const [data, setData] = useState<PublicData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionTask, setActionTask] = useState<PublicTask | null>(null)
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'request-changes' | null>(null)
  const [approverName, setApproverName] = useState(() => localStorage.getItem('approver_name') || '')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`${BASE}/api/public/approvals/${token}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error || 'Link invalido')
        setData(null)
      } else {
        setData(await res.json())
      }
    } catch (e: any) { setError('Erro ao carregar') }
    setLoading(false)
  }

  useEffect(() => { load() }, [token])

  const openAction = (task: PublicTask, type: 'approve' | 'reject' | 'request-changes') => {
    setActionTask(task); setActionType(type); setComment('')
  }
  const closeAction = () => { setActionTask(null); setActionType(null); setComment('') }

  const submitAction = async () => {
    if (!actionTask || !actionType || !approverName.trim()) return
    if ((actionType === 'reject' || actionType === 'request-changes') && !comment.trim()) {
      alert('Descreva o motivo')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`${BASE}/api/public/approvals/${token}/${actionTask.id}/${actionType}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approver_name: approverName.trim(), comment: comment.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Erro')
      } else {
        localStorage.setItem('approver_name', approverName.trim())
        setSuccessMsg(actionType === 'approve' ? 'Aprovado!' : actionType === 'reject' ? 'Rejeitado' : 'Alteracao solicitada!')
        closeAction()
        setTimeout(() => setSuccessMsg(''), 3000)
        load()
      }
    } catch (e: any) { alert('Erro: ' + e.message) }
    setSubmitting(false)
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0E0820', color: '#fff' }}>
      <div className="spinner" />
    </div>
  )

  if (error || !data) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0E0820', color: '#fff', padding: 20 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Link inválido ou revogado</h1>
      <p style={{ color: '#9B96B0', textAlign: 'center', maxWidth: 420 }}>Esse link de aprovação não está mais ativo. Entre em contato com a agência para receber um novo.</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#0E0820', color: '#fff', padding: '20px 16px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img src="https://drosagencia.com.br/wp-content/uploads/2025/12/DROS-LOGO-1-1024x1024.png" alt="Dros" style={{ height: 56, marginBottom: 12 }} />
          <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Olá, {data.client.name}!</h1>
          <p style={{ color: '#9B96B0', fontSize: 14 }}>{data.tasks.length === 0 ? 'Nenhuma aprovação pendente no momento.' : `Você tem ${data.tasks.length} ${data.tasks.length === 1 ? 'tarefa' : 'tarefas'} aguardando sua aprovação.`}</p>
        </div>

        {successMsg && (
          <div style={{ padding: '12px 16px', background: 'rgba(52,199,89,0.15)', border: '1px solid #34C759', borderRadius: 8, marginBottom: 16, textAlign: 'center', color: '#34C759', fontWeight: 600 }}>
            ✓ {successMsg}
          </div>
        )}

        {/* Approver name input — global, persiste no localStorage */}
        <div style={{ padding: '12px 14px', background: 'rgba(255,179,0,0.06)', border: '1px solid rgba(255,179,0,0.2)', borderRadius: 10, marginBottom: 20 }}>
          <label style={{ fontSize: 11, color: '#FFB300', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Seu nome (registrado em cada aprovação)</label>
          <input
            value={approverName}
            onChange={e => setApproverName(e.target.value)}
            placeholder="Ex: João Silva"
            style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#fff', fontSize: 14, fontFamily: 'inherit' }}
          />
        </div>

        {/* Tasks list */}
        {data.tasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, background: 'rgba(255,255,255,0.02)', borderRadius: 10, color: '#9B96B0' }}>
            Tudo em dia! Nada pra aprovar agora.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {data.tasks.map(t => (
              <div key={t.id} style={{ background: '#1a1428', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 18, borderLeft: '3px solid #FFB300' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#F2F0F7', margin: 0 }}>{t.title}</h3>
                  {t.category_name && <span style={{ padding: '3px 10px', background: `${t.category_color}20`, color: t.category_color, borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{t.category_name}</span>}
                </div>

                {(() => {
                  const files = getApprovalFiles(t)
                  if (files.length === 0) return null
                  const isCarrossel = files.length > 1
                  return (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#9B96B0', marginBottom: 6 }}>
                        {isCarrossel ? `Carrossel — ${files.length} arquivos` : 'Arquivo a ser postado'}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {files.map((url, idx) => isDriveUrl(url) ? (
                          <div key={idx}>
                            {isCarrossel && <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB300', marginBottom: 6, letterSpacing: 0.5 }}>SLIDE {idx + 1} / {files.length}</div>}
                            <div style={{ width: '100%', maxWidth: 800, aspectRatio: '16/9', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', background: '#000' }}>
                              <iframe
                                src={toDriveEmbedUrl(url) || ''}
                                title={`Arquivo ${idx + 1} — ${t.title}`}
                                allow="autoplay; fullscreen; encrypted-media"
                                allowFullScreen
                                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                              />
                            </div>
                            <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 11, color: '#9B96B0', textDecoration: 'none' }}>
                              <ExternalLink size={11} /> Abrir em nova aba
                            </a>
                          </div>
                        ) : (
                          <a key={idx} href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: 'linear-gradient(135deg, #5DADE2, #3498DB)', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 700, textDecoration: 'none', alignSelf: 'flex-start' }}>
                            <ExternalLink size={14} /> {isCarrossel ? `Ver Slide ${idx + 1}` : 'Ver Arquivo'}
                          </a>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                {t.approval_text && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#9B96B0', marginBottom: 6 }}>Legenda do post</div>
                    <div style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, fontSize: 13, lineHeight: 1.6, color: '#F2F0F7', whiteSpace: 'pre-wrap' }}>
                      {t.approval_text}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#9B96B0', marginBottom: 12, flexWrap: 'wrap' }}>
                  {t.publish_date && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Calendar size={12} />Publicação: {t.publish_date}</span>}
                  {t.publish_objective && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Target size={12} />{t.publish_objective}</span>}
                </div>

                {t.comments && t.comments.length > 0 && (
                  <div style={{ marginBottom: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: 10, color: '#6B6580', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 6 }}>Comentários</div>
                    {t.comments.slice(-3).map((c, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#A8A3B8', marginBottom: 4, paddingLeft: 8, borderLeft: '2px solid rgba(255,255,255,0.06)' }}>
                        {c.user_name && <strong style={{ color: '#F2F0F7' }}>{c.user_name}: </strong>}{c.content}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button onClick={() => openAction(t, 'approve')} disabled={!approverName.trim()} style={{ flex: 1, minWidth: 110, padding: '12px 16px', background: '#34C759', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: approverName.trim() ? 'pointer' : 'not-allowed', opacity: approverName.trim() ? 1 : 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <CheckCircle size={16} /> Aprovar
                  </button>
                  <button onClick={() => openAction(t, 'request-changes')} disabled={!approverName.trim()} style={{ flex: 1, minWidth: 110, padding: '12px 16px', background: '#FFB300', color: '#1a1428', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: approverName.trim() ? 'pointer' : 'not-allowed', opacity: approverName.trim() ? 1 : 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <RotateCcw size={16} /> Solicitar Alteração
                  </button>
                  <button onClick={() => openAction(t, 'reject')} disabled={!approverName.trim()} style={{ flex: 1, minWidth: 110, padding: '12px 16px', background: 'rgba(255,107,107,0.15)', color: '#FF6B6B', border: '1px solid #FF6B6B', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: approverName.trim() ? 'pointer' : 'not-allowed', opacity: approverName.trim() ? 1 : 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <XCircle size={16} /> Rejeitar
                  </button>
                </div>
                {!approverName.trim() && (
                  <p style={{ fontSize: 11, color: '#FFAA83', marginTop: 6, textAlign: 'center' }}>Preencha seu nome acima pra liberar os botões</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 30, padding: 20, fontSize: 11, color: '#6B6580' }}>
          Suas aprovações são registradas com seu nome, IP e data. Em caso de dúvidas, fale com a agência.
        </div>
      </div>

      {/* Action modal */}
      {actionTask && actionType && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 100 }} onClick={closeAction}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#1a1428', borderRadius: 12, padding: 22, maxWidth: 500, width: '100%' }}>
            <h2 style={{ fontSize: 18, marginBottom: 6 }}>
              {actionType === 'approve' ? '✓ Aprovar tarefa' : actionType === 'reject' ? '✕ Rejeitar tarefa' : '🔄 Solicitar alteração'}
            </h2>
            <p style={{ fontSize: 13, color: '#9B96B0', marginBottom: 14 }}>"{actionTask.title}"</p>
            <p style={{ fontSize: 12, color: '#A8A3B8', marginBottom: 14 }}>
              Confirmando como: <strong style={{ color: '#FFB300' }}>{approverName}</strong>
            </p>
            {(actionType === 'reject' || actionType === 'request-changes') && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: '#9B96B0', display: 'block', marginBottom: 6 }}>{actionType === 'reject' ? 'Motivo da rejeição *' : 'O que precisa ser alterado *'}</label>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  rows={4}
                  placeholder={actionType === 'reject' ? 'Por que está rejeitando?' : 'Seja específico e detalhado'}
                  style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#fff', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
                />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={closeAction} disabled={submitting} style={{ padding: '10px 18px', background: 'rgba(255,255,255,0.06)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
              <button onClick={submitAction} disabled={submitting || ((actionType === 'reject' || actionType === 'request-changes') && !comment.trim())} style={{ padding: '10px 18px', background: actionType === 'approve' ? '#34C759' : actionType === 'reject' ? '#FF6B6B' : '#FFB300', color: actionType === 'request-changes' ? '#1a1428' : '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {submitting ? 'Enviando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
