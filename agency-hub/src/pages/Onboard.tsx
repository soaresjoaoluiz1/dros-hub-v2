import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

const STEPS = [
  { id: 'empresa', badge: 'ETAPA 1', title: 'Sobre voce e sua empresa', desc: 'Conta um pouco sobre o que voces fazem.', fields: [
    { id: 'seu_nome', label: 'Seu nome', type: 'text', ph: 'Quem vai ser nosso contato principal?' },
    { id: 'whatsapp', label: 'Seu WhatsApp', type: 'text', ph: '(XX) XXXXX-XXXX' },
    { id: 'email', label: 'Seu e-mail', type: 'text', ph: 'email@empresa.com' },
    { id: 'cidade', label: 'Onde fica sua empresa?', hint: 'Cidade e estado', type: 'text', ph: 'Ex: Florianopolis/SC' },
    { id: 'o_que_vende', label: 'O que voces vendem?', hint: 'Pode listar os produtos ou servicos principais.', type: 'textarea', ph: 'Ex: Fabricamos moveis planejados sob medida...' },
    { id: 'tempo_mercado', label: 'Ha quanto tempo a empresa existe?', type: 'text', ph: 'Ex: 12 anos' },
  ]},
  { id: 'clientes', badge: 'ETAPA 2', title: 'Seus clientes', desc: 'Me conta quem compra de voces.', fields: [
    { id: 'quem_compra', label: 'Quem compra de voces?', type: 'pills', options: ['Empresas (B2B)', 'Pessoas fisicas', 'Os dois'] },
    { id: 'descreva_cliente', label: 'Descreve o seu cliente tipico', type: 'textarea', ph: 'Ex: Geralmente sao donos de restaurantes da regiao...' },
    { id: 'por_que_compram', label: 'Por que os clientes compram de voces?', type: 'textarea', ph: 'Ex: A gente entrega mais rapido...' },
    { id: 'por_que_nao_compram', label: 'E por que alguns NAO compram?', type: 'textarea', ph: 'Ex: Dizem que esta caro...' },
  ]},
  { id: 'vendas', badge: 'ETAPA 3', title: 'Como voces vendem hoje', desc: 'Como funciona a venda no dia a dia.', fields: [
    { id: 'como_chega', label: 'Como os clientes chegam ate voces?', type: 'pills_multi', options: ['Indicacao', 'WhatsApp', 'Instagram', 'Google', 'Loja fisica', 'Telefone', 'E-mail', 'Marketplace', 'Outro'] },
    { id: 'quem_atende', label: 'Quem atende quando um cliente entra em contato?', type: 'text', ph: 'Ex: Eu mesmo, a Carla da recepcao...' },
    { id: 'como_registra', label: 'Onde voces registram os contatos e as vendas?', type: 'pills', options: ['CRM (sistema)', 'Planilha', 'Caderno', 'Nao registramos'] },
    { id: 'demora_responder', label: 'Quanto tempo demora pra responder?', type: 'pills', options: ['Na hora', 'Ate 1 hora', 'Algumas horas', '1 dia ou mais'] },
    { id: 'faz_followup', label: 'Quando alguem nao fecha, voces voltam a entrar em contato?', type: 'pills', options: ['Sim, sempre', 'As vezes', 'Raramente', 'Nunca'] },
  ]},
  { id: 'numeros', badge: 'ETAPA 4', title: 'Seus numeros', desc: 'Uma estimativa ja ajuda muito. 100% confidencial.', fields: [
    { id: 'faturamento_mes', label: 'Quanto a empresa fatura por mes?', type: 'text', ph: 'Ex: R$ 80.000' },
    { id: 'ticket_medio', label: 'Valor medio de cada venda?', type: 'text', ph: 'Ex: R$ 350' },
    { id: 'vendas_mes', label: 'Quantas vendas por mes?', type: 'text', ph: 'Ex: umas 60 vendas' },
    { id: 'melhor_mes', label: 'Melhor mes do ano? Por que?', type: 'text', ph: 'Ex: Dezembro, Natal' },
    { id: 'quanto_investir', label: 'Quanto pensam em investir em anuncios por mes?', type: 'text', ph: 'Ex: R$ 1.500' },
  ]},
  { id: 'internet', badge: 'ETAPA 5', title: 'Voces na internet', desc: 'Onde voces estao presentes hoje na internet.', fields: [
    { id: 'tem_instagram', label: 'Tem Instagram? Qual o @?', type: 'text', ph: '@empresa (ou "nao temos")' },
    { id: 'tem_site', label: 'Tem site? Cole o link', type: 'text', ph: 'www.empresa.com.br (ou "nao temos")' },
    { id: 'tem_google', label: 'Aparece no Google?', type: 'pills', options: ['Sim', 'Nao', 'Nao sei'] },
    { id: 'ja_anunciou', label: 'Ja pagou para anunciar no Google ou Instagram?', type: 'pills', options: ['Sim', 'Nao'] },
    { id: 'como_foi_anuncio', label: 'Se ja anunciou, como foi?', type: 'textarea', ph: 'Ex: Fiz uns anuncios no Instagram por 2 meses...' },
    { id: 'ja_teve_agencia', label: 'Ja trabalhou com agencia de marketing?', type: 'pills', options: ['Sim', 'Nao'] },
    { id: 'exp_agencia', label: 'Se sim, o que funcionou e o que nao?', type: 'textarea', ph: 'Ex: Faziam as postagens mas nao vi resultado...' },
  ]},
  { id: 'concorrentes', badge: 'ETAPA 6', title: 'Seus concorrentes', desc: 'Quem sao os principais.', fields: [
    { id: 'concorrentes_lista', label: 'Liste 3 a 5 concorrentes', type: 'textarea', ph: '1. Empresa X - @instagram\n2. Empresa Y - www.site.com' },
    { id: 'conc_melhor', label: 'O que eles fazem de bom?', type: 'textarea', ph: 'Ex: Tem um site muito bonito...' },
    { id: 'conc_fraco', label: 'Onde voces sao melhores que eles?', type: 'textarea', ph: 'Ex: Nosso produto dura mais...' },
    { id: 'preco_vs_conc', label: 'Seu preco comparado aos concorrentes:', type: 'pills', options: ['Mais caros', 'Parecidos', 'Mais baratos'] },
  ]},
  { id: 'acessos', badge: 'ETAPA 7', title: 'Acessos que vamos precisar', desc: 'Marque o que voce ja tem e consegue compartilhar.', fields: [
    { id: 'acessos_check', label: '', type: 'access_check' },
    { id: 'obs_acessos', label: 'Alguma observacao sobre os acessos?', type: 'textarea', ph: 'Ex: perdi a senha do Facebook...' },
  ]},
  { id: 'expectativas', badge: 'ETAPA 8', title: 'O que voces esperam', desc: 'Ultima etapa!', fields: [
    { id: 'maior_problema', label: 'Se pudesse resolver UM problema agora, qual seria?', type: 'textarea', ph: 'Ex: As vendas cairam nos ultimos meses...' },
    { id: 'objetivo', label: 'O que seria "sucesso" daqui a 6 meses?', type: 'textarea', ph: 'Ex: Ter 30 clientes novos por mes...' },
    { id: 'mais_alguma_coisa', label: 'Quer contar mais alguma coisa?', type: 'textarea', ph: 'Fique a vontade...' },
  ]},
]

const ACCESS_WITH_LOGIN = ['Instagram', 'Facebook', 'Google Analytics', 'Gmail da empresa', 'Google Ads', 'WhatsApp Business', 'Dominio do site']
const ACCESS_NO_LOGIN = ['Fotos dos produtos', 'Tabela de precos', 'Lista de clientes', 'Logo em alta qualidade', 'Catalogo de produtos']
const ACCESS_ITEMS = [...ACCESS_WITH_LOGIN, ...ACCESS_NO_LOGIN]

export default function Onboard() {
  const { token } = useParams<{ token: string }>()
  const [clientName, setClientName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filled, setFilled] = useState(false)
  const [current, setCurrent] = useState(0)
  const [data, setData] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch(`${BASE}/api/onboard/${token}`)
      .then(r => r.ok ? r.json() : Promise.reject('Link invalido'))
      .then(d => { setClientName(d.client.name); setFilled(d.filled) })
      .catch(() => setError('Link invalido ou expirado'))
      .finally(() => setLoading(false))
  }, [token])

  const set = (key: string, val: string) => setData(prev => ({ ...prev, [key]: val }))

  const submit = async () => {
    setSubmitting(true)
    try {
      const res = await fetch(`${BASE}/api/onboard/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { ...data, nome_empresa: clientName } })
      })
      if (!res.ok) throw new Error()
      setSubmitted(true)
    } catch { alert('Erro ao enviar. Tente novamente.') }
    finally { setSubmitting(false) }
  }

  if (loading) return <div style={styles.page}><div style={styles.card}><p style={{ color: '#9B96B0' }}>Carregando...</p></div></div>
  if (error) return <div style={styles.page}><div style={styles.card}><h2 style={{ color: '#EA4335' }}>Link invalido</h2><p style={{ color: '#9B96B0', marginTop: 8 }}>Este formulario nao existe ou ja expirou.</p></div></div>
  if (filled && !submitted && current === 0 && Object.keys(data).length === 0) return (
    <div style={styles.page}><div style={styles.card}>
      <div style={styles.checkCircle}>&#10003;</div>
      <h2>Formulario ja respondido</h2>
      <p style={{ color: '#9B96B0', marginTop: 8, marginBottom: 20 }}>Obrigado, {clientName}! Suas respostas ja foram recebidas.</p>
      <button onClick={() => setFilled(false)} style={{ ...styles.btn, background: '#F5A623', color: '#06040C', fontWeight: 700 }}>Responder novamente</button>
    </div></div>
  )
  if (submitted) return <div style={styles.page}><div style={styles.card}><div style={styles.checkCircle}>&#10003;</div><h2>Formulario enviado!</h2><p style={{ color: '#9B96B0', marginTop: 8 }}>Obrigado, {clientName}! Nossa equipe vai analisar e entrar em contato.</p></div></div>

  const step = STEPS[current]
  const pct = Math.round((current / STEPS.length) * 100)
  const isLast = current === STEPS.length - 1

  return (
    <div style={styles.page}>
      <div style={styles.wrapper}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="https://drosagencia.com.br/wp-content/uploads/2025/12/DROS-LOGO-1-1024x1024.png" alt="Dros" style={{ height: 48, marginBottom: 12 }} />
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Formulario de Entrada</h1>
          <p style={{ fontSize: 14, color: '#9B96B0' }}>{clientName}</p>
        </div>

        {/* Progress */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ height: 6, background: '#1A162C', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: '#F5A623', borderRadius: 3, transition: 'width 0.4s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#6E6887', fontFamily: 'monospace' }}>
            <span>Etapa {current + 1} de {STEPS.length}</span>
            <span>{pct}%</span>
          </div>
        </div>

        {/* Step */}
        <div style={{ background: '#131020', borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)', padding: '28px 24px' }}>
          <div style={{ display: 'inline-block', background: 'rgba(245,166,35,0.1)', color: '#F5A623', padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 12, fontFamily: 'monospace' }}>{step.badge}</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{step.title}</h2>
          <p style={{ fontSize: 14, color: '#9B96B0', marginBottom: 24 }}>{step.desc}</p>

          {step.fields.map(f => (
            <div key={f.id} style={{ marginBottom: 20 }}>
              {f.label && <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{f.label}</label>}
              {'hint' in f && f.hint && <span style={{ display: 'block', fontSize: 12, color: '#6E6887', marginBottom: 8 }}>{f.hint}</span>}

              {f.type === 'text' && (
                <input style={styles.input} placeholder={f.ph} value={data[f.id] || ''} onChange={e => set(f.id, e.target.value)} />
              )}
              {f.type === 'textarea' && (
                <textarea style={{ ...styles.input, minHeight: 90, resize: 'vertical' as const }} placeholder={f.ph} value={data[f.id] || ''} onChange={e => set(f.id, e.target.value)} />
              )}
              {f.type === 'pills' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {f.options!.map(o => (
                    <button key={o} onClick={() => set(f.id, o)} style={{ ...styles.pill, ...(data[f.id] === o ? styles.pillOn : {}) }}>{o}</button>
                  ))}
                </div>
              )}
              {f.type === 'pills_multi' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {f.options!.map(o => {
                    const selected = (data[f.id] || '').split(', ').filter(Boolean)
                    const isOn = selected.includes(o)
                    return (
                      <button key={o} onClick={() => {
                        const next = isOn ? selected.filter(x => x !== o) : [...selected, o]
                        set(f.id, next.join(', '))
                      }} style={{ ...styles.pill, ...(isOn ? styles.pillOn : {}) }}>{o}</button>
                    )
                  })}
                </div>
              )}
              {f.type === 'access_check' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ACCESS_ITEMS.map(a => {
                    const key = `acesso_${a}`
                    const isOn = data[key] === 'Sim'
                    const needsLogin = ACCESS_WITH_LOGIN.includes(a)
                    return (
                      <div key={a}>
                        <button onClick={() => { set(key, isOn ? '' : 'Sim'); if (isOn) { set(`${key}_login`, ''); set(`${key}_senha`, '') } }}
                          style={{ ...styles.accessItem, width: '100%', ...(isOn ? { borderColor: '#34C759', background: 'rgba(52,199,89,0.1)', color: '#34C759' } : {}) }}>
                          <span style={{ ...styles.accessIcon, ...(isOn ? { background: '#34C759', borderColor: '#34C759', color: '#06040C' } : {}) }}>{isOn ? '\u2713' : ''}</span>
                          <span style={{ fontSize: 13 }}>{a}</span>
                        </button>
                        {isOn && needsLogin && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6, marginLeft: 28 }}>
                            <input style={{ ...styles.input, fontSize: 13, padding: '8px 10px' }} placeholder="Login / e-mail" value={data[`${key}_login`] || ''} onChange={e => set(`${key}_login`, e.target.value)} />
                            <input style={{ ...styles.input, fontSize: 13, padding: '8px 10px' }} placeholder="Senha" value={data[`${key}_senha`] || ''} onChange={e => set(`${key}_senha`, e.target.value)} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Nav */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
          <button onClick={() => setCurrent(Math.max(0, current - 1))} style={{ ...styles.btn, visibility: current === 0 ? 'hidden' : 'visible', background: '#131020', border: '1px solid rgba(255,255,255,0.08)', color: '#9B96B0' }}>
            &#8592; Voltar
          </button>
          {isLast ? (
            <button onClick={submit} disabled={submitting} style={{ ...styles.btn, background: '#34C759', color: '#06040C', fontWeight: 700 }}>
              {submitting ? 'Enviando...' : '\u2713 Enviar respostas'}
            </button>
          ) : (
            <button onClick={() => setCurrent(Math.min(STEPS.length - 1, current + 1))} style={{ ...styles.btn, background: '#F5A623', color: '#06040C', fontWeight: 700 }}>
              Continuar &#8594;
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#06040C', color: '#EBEBF0', fontFamily: "'DM Sans', -apple-system, sans-serif", display: 'flex', justifyContent: 'center', padding: '32px 16px' },
  wrapper: { maxWidth: 640, width: '100%' },
  card: { background: '#131020', borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)', padding: '48px 32px', textAlign: 'center' as const, maxWidth: 500, margin: '80px auto' },
  checkCircle: { width: 64, height: 64, borderRadius: '50%', background: 'rgba(52,199,89,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: '#34C759', margin: '0 auto 16px' },
  input: { width: '100%', background: '#0C0916', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px', fontSize: 14, color: '#EBEBF0', fontFamily: 'inherit', outline: 'none' },
  pill: { padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: '#0C0916', color: '#9B96B0', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  pillOn: { background: 'rgba(245,166,35,0.1)', borderColor: '#F5A623', color: '#F5A623', fontWeight: 600 },
  accessItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#0C0916', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, cursor: 'pointer', color: '#9B96B0', textAlign: 'left' as const, fontFamily: 'inherit' },
  accessIcon: { width: 20, height: 20, borderRadius: 5, border: '2px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 },
  btn: { padding: '12px 28px', borderRadius: 10, fontSize: 14, cursor: 'pointer', border: 'none', fontFamily: 'inherit' },
}
