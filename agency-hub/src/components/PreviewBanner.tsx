import { useState } from 'react'
import { X } from 'lucide-react'

const DISMISS_KEY = 'hub2_banner_dismissed'

export default function PreviewBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })

  if (dismissed) return null

  const close = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch {}
    setDismissed(true)
  }

  return (
    <div
      role="status"
      style={{
        background: 'linear-gradient(90deg, #FFE082 0%, #FFCA28 100%)',
        color: '#5D4037',
        padding: '8px 20px',
        fontSize: 13,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        borderBottom: '1px solid #FFB300',
        letterSpacing: 0.2,
        position: 'sticky',
        top: 0,
        zIndex: 999,
      }}
    >
      <span aria-hidden style={{ fontSize: 15 }}>⚠</span>
      <span>
        Preview Hub v2 — ambiente de teste isolado. Dados iniciais copiados do Hub em producao; a partir daqui as bases seguem separadas.
      </span>
      <button
        type="button"
        onClick={close}
        aria-label="Fechar aviso"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#5D4037',
          cursor: 'pointer',
          padding: 4,
          display: 'flex',
          alignItems: 'center',
          marginLeft: 8,
        }}
      >
        <X size={14} />
      </button>
    </div>
  )
}
