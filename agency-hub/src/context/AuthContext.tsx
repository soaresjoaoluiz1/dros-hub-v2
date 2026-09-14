import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export interface User {
  id: number; email: string; name: string
  role: 'dono' | 'gerente' | 'funcionario' | 'cliente'
  client_id: number | null
}

interface AuthCtx { user: User | null; token: string | null; login: (e: string, p: string) => Promise<void>; logout: () => void; loading: boolean }

const AuthContext = createContext<AuthCtx>({} as AuthCtx)
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(localStorage.getItem('dros_hub_token'))
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) { setLoading(false); return }
    fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setUser(d.user))
      .catch(() => { localStorage.removeItem('dros_hub_token'); setToken(null); setUser(null) })
      .finally(() => setLoading(false))
  }, [token])

  const login = async (email: string, password: string) => {
    const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
    if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Erro') }
    const data = await res.json()
    localStorage.setItem('dros_hub_token', data.token); setToken(data.token); setUser(data.user)
  }

  const logout = () => { localStorage.removeItem('dros_hub_token'); setToken(null); setUser(null) }

  return <AuthContext.Provider value={{ user, token, login, logout, loading }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
