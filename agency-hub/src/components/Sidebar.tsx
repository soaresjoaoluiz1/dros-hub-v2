import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useSSE } from '../context/SSEContext'
import { useTheme } from '../context/ThemeContext'
import { apiFetch } from '../lib/api'
import {
  LayoutDashboard, Kanban, ListTodo, CheckCircle, Building2, UsersRound,
  Layers, Tag, Briefcase, DollarSign, Settings, LogOut, Menu, X, ChevronsLeft, ChevronsRight, Video, ExternalLink, BarChart3, Sun, Moon, Repeat,
  Bell, Table2, ChevronDown, ChevronRight,
} from 'lucide-react'
import NotificationBell from './NotificationBell'

function getInitials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Grupos colapsaveis — estado persistido em localStorage por grupo
function useGroupOpen(slug: string, defaultOpen: boolean) {
  const storageKey = `sidebar_group_${slug}`
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw === null) return defaultOpen
      return raw === '1'
    } catch { return defaultOpen }
  })
  const toggle = () => setOpen(prev => {
    const next = !prev
    try { localStorage.setItem(storageKey, next ? '1' : '0') } catch {}
    return next
  })
  return { open, toggle }
}

type GroupProps = {
  slug: string
  title: string
  defaultOpen?: boolean
  collapsed: boolean
  children: React.ReactNode
}

function NavGroup({ slug, title, defaultOpen = false, collapsed, children }: GroupProps) {
  const { open, toggle } = useGroupOpen(slug, defaultOpen)
  if (collapsed) {
    // Quando sidebar colapsada, nao mostra o titulo do grupo — so lista os itens.
    return <>{children}</>
  }
  return (
    <div className="nav-group">
      <button
        type="button"
        className="nav-section nav-section-toggle"
        onClick={toggle}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '10px 16px 4px',
          textAlign: 'left',
          font: 'inherit',
          color: 'inherit',
        }}
      >
        <span>{title}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && <div className="nav-group-items">{children}</div>}
    </div>
  )
}

export default function Sidebar() {
  const { user, logout } = useAuth()
  const { theme, setTheme, toggleTheme } = useTheme()
  const [approvalCount, setApprovalCount] = useState(0)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === '1')
  if (!user) return null

  const isDono = user.role === 'dono'
  const isGerente = user.role === 'gerente'
  const isFunc = user.role === 'funcionario'
  const isCliente = user.role === 'cliente'
  const isStaff = isDono || isGerente
  const close = () => setMobileOpen(false)
  const toggleCollapse = () => { setCollapsed(p => { const v = !p; localStorage.setItem('sidebar_collapsed', v ? '1' : '0'); return v }) }

  const [overdueCount, setOverdueCount] = useState(0)

  useEffect(() => {
    if (isDono || isGerente) {
      apiFetch('/api/approvals/internal').then((d: any) => setApprovalCount(d.tasks?.length || 0)).catch(() => {})
      apiFetch('/api/dashboard/stats?days=1').then((d: any) => setOverdueCount(d.overdue || 0)).catch(() => {})
    } else if (isCliente) apiFetch('/api/approvals/client').then((d: any) => setApprovalCount(d.tasks?.length || 0)).catch(() => {})
  }, [isDono, isGerente, isCliente])

  useSSE('task:stage_changed', () => {
    if (isDono || isGerente) apiFetch('/api/approvals/internal').then((d: any) => setApprovalCount(d.tasks?.length || 0)).catch(() => {})
    else if (isCliente) apiFetch('/api/approvals/client').then((d: any) => setApprovalCount(d.tasks?.length || 0)).catch(() => {})
  })

  return (
    <>
      {!mobileOpen && <button className="hamburger-btn" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>}
      {mobileOpen && <div className="sidebar-overlay" onClick={close} />}
      <aside className={`sidebar ${mobileOpen ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div>
                <img src="https://drosagencia.com.br/wp-content/uploads/2025/12/DROS-LOGO-1-1024x1024.png" alt="Dros" className="sidebar-logo" />
                {!collapsed && <div className="sidebar-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  HUB
                  <span style={{
                    background: '#FFB300',
                    color: '#3E2723',
                    fontSize: 9,
                    fontWeight: 800,
                    padding: '1px 5px',
                    borderRadius: 3,
                    letterSpacing: 0.4,
                  }}>V2</span>
                </div>}
              </div>
              {!collapsed && <NotificationBell />}
            </div>
            <button className="sidebar-close-btn" onClick={close}><X size={18} /></button>
          </div>
        </div>
        <nav className="sidebar-nav">
          {/* ============ PESSOAL ============ */}
          <NavGroup slug="pessoal" title="Pessoal" defaultOpen collapsed={collapsed}>
            <NavLink to="/dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={close}>
              <LayoutDashboard size={16} /> {isCliente ? 'Dashboard' : 'Meu Dashboard'}
            </NavLink>
            <NavLink to="/tasks" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={close}>
              <ListTodo size={16} /> {isCliente ? 'Minhas Tarefas' : 'Minhas Tarefas'}
              {overdueCount > 0 && (isDono || isGerente) && <span className="nav-badge" style={{ background: '#FF6B6B' }}>{overdueCount}</span>}
            </NavLink>
            {(isDono || isGerente || isCliente) && (
              <NavLink to="/approvals" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={close}>
                <CheckCircle size={16} /> {isCliente ? 'Aprovações' : 'Aprovacoes'}
                {approvalCount > 0 && <span className="nav-badge">{approvalCount}</span>}
              </NavLink>
            )}
            <NavLink to="/notifications" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={close}>
              <Bell size={16} /> Notificacoes
            </NavLink>
          </NavGroup>

          {/* ============ GESTAO & CS (staff) ============ */}
          {isStaff && (
            <NavGroup slug="gestao" title="Gestao & CS" defaultOpen collapsed={collapsed}>
              <NavLink to="/clients" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={close}>
                <Building2 size={16} /> Clientes
              </NavLink>
              <NavLink to="/visao-geral" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={close}>
                <Table2 size={16} /> Visao Geral
              </NavLink>
              {isDono && (
                <NavLink to="/financial" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={close}>
                  <DollarSign size={16} /> Faturamento
                </NavLink>
              )}
            </NavGroup>
          )}

          {/* ============ PERFORMANCE ============ */}
          {(isStaff || isCliente) && (
            <NavGroup slug="performance" title="Performance" collapsed={collapsed}>
              <NavLink to="/performance" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={close}>
                <BarChart3 size={16} /> Performance
              </NavLink>
            </NavGroup>
          )}

          {/* ============ CONTEUDO ============ */}
          {(isDono || isGerente || isFunc) && (
            <NavGroup slug="conteudo" title="Conteudo" collapsed={collapsed}>
              <NavLink to="/pipeline" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={close}>
                <Kanban size={16} /> Pipeline editorial
              </NavLink>
              <NavLink to="/gravacoes" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={close}>
                <Video size={16} /> Gravacoes
              </NavLink>
              {!isCliente && (
                <NavLink to="/tarefas-recorrentes" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={close}>
                  <Repeat size={16} /> Recorrencias
                </NavLink>
              )}
            </NavGroup>
          )}

          {/* ============ ADMINISTRACAO (staff) ============ */}
          {isStaff && (
            <NavGroup slug="admin" title="Administracao" collapsed={collapsed}>
              <NavLink to="/team" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={close}>
                <UsersRound size={16} /> Equipe
              </NavLink>
              <NavLink to="/departments" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={close}>
                <Layers size={16} /> Departamentos
              </NavLink>
              <NavLink to="/categories" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={close}>
                <Tag size={16} /> Categorias
              </NavLink>
              <NavLink to="/services" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={close}>
                <Briefcase size={16} /> Servicos
              </NavLink>
              {isDono && (
                <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={close}>
                  <Settings size={16} /> Configuracoes
                </NavLink>
              )}
              {isDono && (
                <a href="/crm/" target="_blank" rel="noopener noreferrer" className="nav-item" style={{ textDecoration: 'none' }} onClick={close}>
                  <ExternalLink size={16} /> CRM
                </a>
              )}
            </NavGroup>
          )}
        </nav>
        <div className="sidebar-footer">
          {collapsed ? (
            <>
              <button
                type="button"
                className="theme-toggle-collapsed"
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
              >
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              </button>
              <button className="logout-btn" onClick={logout} title="Sair"><LogOut size={16} /></button>
            </>
          ) : (
            <>
              <div className="theme-toggle" role="tablist" aria-label="Alternar tema">
                <button
                  type="button"
                  role="tab"
                  aria-selected={theme === 'light'}
                  className={`theme-toggle-option ${theme === 'light' ? 'active' : ''}`}
                  onClick={() => setTheme('light')}
                  title="Tema claro"
                >
                  <Sun size={13} /> Claro
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={theme === 'dark'}
                  className={`theme-toggle-option ${theme === 'dark' ? 'active' : ''}`}
                  onClick={() => setTheme('dark')}
                  title="Tema escuro"
                >
                  <Moon size={13} /> Escuro
                </button>
              </div>
              <div className="sidebar-user-row">
                <div className="sidebar-avatar" aria-hidden="true">{getInitials(user.name)}</div>
                <div className="sidebar-user-info">
                  <div className="sidebar-user">{user.name}</div>
                  <div className="sidebar-role">{user.role === 'dono' ? 'CEO' : user.role === 'gerente' ? 'Gerente' : user.role === 'funcionario' ? 'Funcionario' : 'Cliente'}</div>
                </div>
                <button className="logout-btn" onClick={logout} title="Sair"><LogOut size={16} /></button>
              </div>
            </>
          )}
        </div>
        <button className="collapse-btn" onClick={toggleCollapse} title={collapsed ? 'Expandir menu' : 'Recolher menu'}>
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </aside>
    </>
  )
}
