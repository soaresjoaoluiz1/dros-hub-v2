import { useState, useEffect, createContext, useContext, useCallback, type ReactNode } from 'react'

interface ToastItem { id: number; message: string; type: 'success' | 'error' | 'info' }

const ToastContext = createContext<{ toast: (msg: string, type?: 'success' | 'error' | 'info') => void }>({ toast: () => {} })

export function useToast() { return useContext(ToastContext) }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  let nextId = 0

  const toast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = ++nextId
    setItems(prev => [...prev, { id, message, type }])
    setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{ position: 'fixed', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 9999, pointerEvents: 'none' }}>
        {items.map(t => (
          <ToastMessage key={t.id} item={t} onDismiss={() => setItems(prev => prev.filter(x => x.id !== t.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastMessage({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => { requestAnimationFrame(() => setVisible(true)) }, [])

  const colors = {
    success: { bg: 'rgba(52,199,89,0.95)', border: '#34C759', icon: '✓' },
    error: { bg: 'rgba(255,107,107,0.95)', border: '#FF6B6B', icon: '✕' },
    info: { bg: 'rgba(255,179,0,0.95)', border: '#FFB300', icon: 'ℹ' },
  }
  const c = colors[item.type]

  return (
    <div onClick={onDismiss} style={{
      padding: '12px 18px', borderRadius: 10, background: c.bg, color: '#1a1625',
      fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)', border: `1px solid ${c.border}`,
      transform: visible ? 'translateX(0)' : 'translateX(100px)',
      opacity: visible ? 1 : 0, transition: 'all 0.3s ease-out',
      cursor: 'pointer', pointerEvents: 'auto', maxWidth: 400,
    }}>
      <span style={{ fontSize: 16, fontWeight: 800 }}>{c.icon}</span>
      {item.message}
    </div>
  )
}
