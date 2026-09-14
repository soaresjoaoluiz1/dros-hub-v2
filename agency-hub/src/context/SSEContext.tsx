import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

type Handler = (data: any) => void
interface SSECtx { subscribe: (event: string, handler: Handler) => () => void; connected: boolean }
const SSEContext = createContext<SSECtx>({ subscribe: () => () => {}, connected: false })

export function SSEProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false)
  const handlers = useRef(new Map<string, Set<Handler>>())

  useEffect(() => {
    const token = localStorage.getItem('dros_hub_token')
    if (!token) return
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const es = new EventSource(`${base}/api/events?token=${token}`)
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    for (const type of ['task:created', 'task:updated', 'task:stage_changed', 'task:comment', 'approval:pending', 'notification:new', 'timer:check']) {
      es.addEventListener(type, (e) => {
        try { const data = JSON.parse((e as MessageEvent).data); handlers.current.get(type)?.forEach(h => h(data)) } catch {}
      })
    }
    return () => { es.close(); setConnected(false) }
  }, [])

  const subscribe = (event: string, handler: Handler) => {
    if (!handlers.current.has(event)) handlers.current.set(event, new Set())
    handlers.current.get(event)!.add(handler)
    return () => { handlers.current.get(event)?.delete(handler) }
  }

  return <SSEContext.Provider value={{ subscribe, connected }}>{children}</SSEContext.Provider>
}

export function useSSE(event: string, handler: Handler) {
  const { subscribe } = useContext(SSEContext)
  useEffect(() => subscribe(event, handler), [event, handler, subscribe])
}
