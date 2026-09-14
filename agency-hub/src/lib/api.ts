const getToken = () => localStorage.getItem('dros_hub_token')
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

export async function apiFetch<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const url = path.startsWith('/api') ? `${BASE}${path}` : path
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json', ...opts.headers } })
  if (res.status === 401) { localStorage.removeItem('dros_hub_token'); window.location.href = `${BASE}/login`; throw new Error('Unauthorized') }
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `API error: ${res.status}`) }
  return res.json()
}

// Parse approval_files (JSON array no DB) pra array limpo. Fallback: approval_link como item unico.
export function getApprovalFiles(task: { approval_files?: string | null; approval_link?: string | null }): string[] {
  if (task.approval_files) {
    try {
      const parsed = JSON.parse(task.approval_files)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.filter((s: any) => s && String(s).trim()).map(String)
    } catch {}
  }
  return task.approval_link ? [task.approval_link] : []
}

export function formatNumber(n: number) { return n.toLocaleString('pt-BR') }
export function formatBRL(n: number) { return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

// Types
export interface Client { id: number; name: string; slug: string; logo_url: string | null; contact_name: string | null; contact_email: string | null; contact_phone?: string | null; drive_folder?: string | null; is_active: number; approval_token?: string | null; onboard_token?: string | null; task_count?: number; user_count?: number; cnpj?: string | null; razao_social?: string | null; segmento?: string | null; website?: string | null; instagram?: string | null; cidade?: string | null; estado?: string | null; observacoes?: string | null; monthly_fee?: number | null; payment_day?: number | null; contrato_inicio?: string | null; core_client_name?: string | null; core_meta_account_id?: string | null; core_ig_page_id?: string | null; core_gads_customer_id?: string | null; core_ga4_property_id?: string | null }
export interface ClientCredential { id: number; client_id: number; platform: string; login: string; password: string; observation: string | null; created_at: string }
export interface TimeEntry { id: number; task_id: number; user_id: number; started_at: string; ended_at: string | null; duration_seconds: number; description: string | null; user_name: string }
export interface Department { id: number; name: string; color: string; is_active: number; employee_count?: number; task_count?: number }
export interface TaskCategory { id: number; name: string; color: string; is_active: number }
export interface PipelineStage { id: number; name: string; slug: string; position: number; color: string; is_terminal: number }
export interface User { id: number; client_id: number | null; name: string; email: string; role: string; is_active: number; client_name?: string; departments?: Department[] }

export interface Task {
  id: number; client_id: number; category_id: number | null; department_id: number | null
  stage: string; title: string; description: string | null; due_date: string | null
  priority: string; assigned_to: number | null; drive_link: string | null; drive_link_raw: string | null
  approval_link: string | null; approval_text: string | null; approval_files?: string | null; publish_date: string | null; publish_objective: string | null
  created_by: number; is_active: number; created_at: string; updated_at: string
  client_name?: string; department_name?: string; department_color?: string
  category_name?: string; category_color?: string; assigned_name?: string
  created_by_name?: string; comment_count?: number; stage_name?: string; stage_color?: string
  task_type?: string; parent_task_id?: number | null; subtask_position?: number | null
  subtask_kind?: string | null
  num_posts?: number | null; num_videos?: number | null
  recording_datetime?: string | null; briefing_content?: string | null
  changes_requested?: string | null
  template_id?: number | null   // preenchido quando a task foi criada por uma recorrencia
  sequential_subtasks?: number  // 1 = subtarefas precisam ser concluidas em ordem (so faz sentido em mae)
  subtask_count?: number; subtask_done_count?: number
  assignees?: { user_id: number; name: string }[]
  subtasks?: Task[]
  parent?: Task & { subtasks?: { id: number; title: string; stage: string; subtask_position: number; stage_name?: string; stage_color?: string }[] }
}

export interface TaskComment { id: number; task_id: number; user_id: number; content: string; is_internal: number; created_at: string; user_name: string; user_role: string }
export interface TaskHistory { id: number; task_id: number; from_stage: string | null; to_stage: string; user_id: number; comment: string | null; created_at: string; user_name: string; from_stage_name?: string; to_stage_name?: string }
export interface TaskAttachment { id: number; task_id: number; url: string; filename: string; type: string; uploaded_by_name?: string; created_at: string }

// API Functions
export const fetchClients = (opts?: { inactive?: boolean }) => apiFetch<{ clients: Client[] }>(`/api/clients${opts?.inactive ? '?inactive=1' : ''}`).then(d => d.clients)
export const createClient = (data: Partial<Client>) => apiFetch<{ client: Client }>('/api/clients', { method: 'POST', body: JSON.stringify(data) }).then(d => d.client)
export const fetchClient = (id: number) => apiFetch<{ client: Client; users: User[]; tasksByStage: any[] }>(`/api/clients/${id}`)
export const generateApprovalToken = (clientId: number) => apiFetch<{ approval_token: string }>(`/api/clients/${clientId}/approval-token`, { method: 'POST' })
export const revokeApprovalToken = (clientId: number) => apiFetch(`/api/clients/${clientId}/approval-token`, { method: 'DELETE' })
export const updateClient = (id: number, data: Partial<Client>) => apiFetch(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) })

export const fetchDepartments = () => apiFetch<{ departments: Department[] }>('/api/departments').then(d => d.departments)
export const createDepartment = (name: string, color: string) => apiFetch<{ department: Department }>('/api/departments', { method: 'POST', body: JSON.stringify({ name, color }) }).then(d => d.department)
export const updateDepartment = (id: number, data: Partial<Department>) => apiFetch(`/api/departments/${id}`, { method: 'PUT', body: JSON.stringify(data) })

export const fetchUsers = (filters?: Record<string, string>) => {
  const params = filters ? '?' + new URLSearchParams(filters).toString() : ''
  return apiFetch<{ users: User[] }>(`/api/users${params}`).then(d => d.users)
}
export const createUser = (data: { name: string; email: string; password: string; role: string; client_id?: number }) => apiFetch<{ user: User }>('/api/users', { method: 'POST', body: JSON.stringify(data) }).then(d => d.user)
export const updateUser = (id: number, data: any) => apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const updateUserDepartments = (id: number, departmentIds: number[]) => apiFetch(`/api/users/${id}/departments`, { method: 'PUT', body: JSON.stringify({ department_ids: departmentIds }) })
export const deleteUser = (id: number) => apiFetch(`/api/users/${id}`, { method: 'DELETE' })

export const fetchCategories = () => apiFetch<{ categories: TaskCategory[] }>('/api/categories').then(d => d.categories)
export const createCategory = (name: string, color: string) => apiFetch<{ category: TaskCategory }>('/api/categories', { method: 'POST', body: JSON.stringify({ name, color }) }).then(d => d.category)
export const updateCategory = (id: number, data: Partial<TaskCategory>) => apiFetch(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) })

export const fetchStages = () => apiFetch<{ stages: PipelineStage[] }>('/api/stages').then(d => d.stages)

// ============= Configuracoes / Tokens (dono-only) =============
export interface AppSetting {
  key: string
  label: string
  group: string
  description: string
  howto: string[]
  is_secret: 0 | 1
  value: string       // mascarado se is_secret e tem valor; '' se vazio
  has_value: boolean
  from_env_fallback: boolean
  updated_at: string | null
}
export const fetchSettings = () => apiFetch<{ settings: AppSetting[] }>('/api/settings').then(d => d.settings)
export const updateSetting = (key: string, value: string) =>
  apiFetch(`/api/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value }) })

export interface TaskFilters { client_id?: number; department_id?: number; stage?: string; assigned_to?: number; category_id?: number; priority?: string; search?: string; date_from?: string; date_to?: string; date_field?: string; page?: number; limit?: number }
export const fetchTasks = (filters: TaskFilters = {}) => {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== '') params.set(k, String(v)) })
  return apiFetch<{ tasks: Task[]; total: number; page: number; totalPages: number }>(`/api/tasks?${params}`)
}
export const fetchPipelineTasks = (filters: Record<string, any> = {}) => {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== '') params.set(k, String(v)) })
  return apiFetch<{ stages: PipelineStage[]; tasks: Task[] }>(`/api/tasks/pipeline?${params}`)
}
export const createTask = (data: Partial<Task>) => apiFetch<{ task: Task }>('/api/tasks', { method: 'POST', body: JSON.stringify(data) }).then(d => d.task)
export const createTaskRequest = (data: { title: string; description?: string; drive_link_raw?: string }) => apiFetch<{ task: Task }>('/api/tasks/request', { method: 'POST', body: JSON.stringify(data) }).then(d => d.task)
export const fetchPendingRequests = () => apiFetch<{ tasks: Task[] }>('/api/tasks/requests/pending').then(d => d.tasks)
export const approveTaskRequest = (id: number) => apiFetch(`/api/tasks/${id}/approve-request`, { method: 'POST' })
export const rejectTaskRequest = (id: number, comment: string) => apiFetch(`/api/tasks/${id}/reject-request`, { method: 'POST', body: JSON.stringify({ comment }) })
export const createEditorialTask = (data: { client_id: number; month_label: string; num_posts?: number; num_videos?: number; due_date?: string; category_id?: number }) => apiFetch<{ task: Task; parent_id: number }>('/api/tasks/editorial', { method: 'POST', body: JSON.stringify(data) })
export const createMaeTask = (data: { client_id: number; title: string; description?: string; due_date?: string; category_id?: number; department_id?: number; priority?: string; assigned_to?: number[]; drive_link?: string; drive_link_raw?: string; approval_link?: string; approval_files?: string[]; approval_text?: string; publish_date?: string; publish_objective?: string; sequential_subtasks?: boolean }) => apiFetch<{ task: Task }>('/api/tasks/mae', { method: 'POST', body: JSON.stringify(data) }).then(d => d.task)
export const addSubtask = (parentId: number, data: { title: string; description?: string; due_date?: string; category_id?: number; department_id?: number; priority?: string; assigned_to?: number | number[]; drive_link?: string; drive_link_raw?: string; approval_link?: string; approval_files?: string[]; approval_text?: string; publish_date?: string; publish_objective?: string }) => apiFetch<{ subtask: Task }>(`/api/tasks/${parentId}/subtasks`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.subtask)
export const convertTaskToMae = (id: number) => apiFetch<{ task: Task }>(`/api/tasks/${id}/convert-to-mae`, { method: 'POST' }).then(d => d.task)
export const saveTaskAsTemplate = (id: number, name?: string) => apiFetch<{ template: any; subtasks_copied: number }>(`/api/tasks/${id}/save-as-template`, { method: 'POST', body: JSON.stringify(name ? { name } : {}) })

export interface ChecklistItem { id: number; position: number; text: string; done: number; done_at: string | null }
export const addChecklistItem = (taskId: number, text: string) => apiFetch<{ item: ChecklistItem }>(`/api/tasks/${taskId}/checklist`, { method: 'POST', body: JSON.stringify({ text }) }).then(d => d.item)
export const updateChecklistItem = (itemId: number, data: { text?: string; done?: boolean; position?: number }) => apiFetch<{ item: ChecklistItem }>(`/api/tasks/checklist/${itemId}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.item)
export const deleteChecklistItem = (itemId: number) => apiFetch(`/api/tasks/checklist/${itemId}`, { method: 'DELETE' })

// ---------- Task Templates (recorrencia) ----------
export interface TaskTemplateSubtask {
  id?: number
  subtask_position?: number
  title: string
  description?: string | null
  priority?: string
  category_id?: number | null
  department_id?: number | null
  due_date_offset_days?: number | null
  drive_link?: string | null
  drive_link_raw?: string | null
  approval_link?: string | null
  approval_files?: string[] | null
  approval_text?: string | null
  publish_date?: string | null
  publish_objective?: string | null
  assigned_to?: number[]
}

export interface TaskTemplate {
  id: number
  name: string
  is_active: number
  task_type: 'normal' | 'mae'
  client_id: number
  client_name?: string
  category_id: number | null
  department_id: number | null
  title: string
  description: string | null
  priority: string
  drive_link: string | null
  drive_link_raw: string | null
  approval_link: string | null
  approval_files: string | null
  approval_text: string | null
  publish_date: string | null
  publish_objective: string | null
  due_date_offset_days: number
  recurrence_type: 'weekly' | 'monthly'
  recurrence_day: number
  recurrence_hour: number
  // 'auto' = cron cria sempre na data marcada (comportamento antigo, mesmo com pendentes).
  // 'on_complete' = cria proxima apenas quando a instancia anterior for concluida.
  mode?: 'auto' | 'on_complete'
  sequential_subtasks?: number  // propaga pra tarefa mae criada (subtarefas em ordem)
  last_run_at: string | null
  next_run_at: string | null
  created_by: number | null
  created_at: string
  updated_at: string
  subtasks_count?: number
  // Carregados em GET /:id
  assigned_to?: number[]
  subtasks?: TaskTemplateSubtask[]
}

export const fetchTaskTemplates = () => apiFetch<{ templates: TaskTemplate[] }>('/api/task-templates').then(d => d.templates)
export const fetchTaskTemplate = (id: number) => apiFetch<{ template: TaskTemplate }>(`/api/task-templates/${id}`).then(d => d.template)
export const createTaskTemplate = (data: Partial<TaskTemplate>) => apiFetch<{ template: TaskTemplate }>('/api/task-templates', { method: 'POST', body: JSON.stringify(data) }).then(d => d.template)
export const updateTaskTemplate = (id: number, data: Partial<TaskTemplate>) => apiFetch<{ template: TaskTemplate }>(`/api/task-templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.template)
export const deleteTaskTemplate = (id: number) => apiFetch(`/api/task-templates/${id}`, { method: 'DELETE' })
export const runTaskTemplate = (id: number) => apiFetch<{ ok: boolean; task_id: number; subtasks_created: number }>(`/api/task-templates/${id}/run-now`, { method: 'POST' })
export const confirmRecording = (parentId: number, data: { recording_datetime: string; capture_user_id?: number; edit_user_id?: number; design_user_id?: number }) => apiFetch<{ task: Task; gravacaoId: number; imagensId: number }>(`/api/tasks/${parentId}/confirm-recording`, { method: 'POST', body: JSON.stringify(data) })
export const fetchTask = (id: number) => apiFetch<{ task: Task; comments: TaskComment[]; history: TaskHistory[]; attachments: TaskAttachment[]; timeEntries: TimeEntry[]; totalTimeSeconds: number; activeTimer: TimeEntry | null }>(`/api/tasks/${id}`)
export const updateTask = (id: number, data: Partial<Task>) => apiFetch(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const moveTaskStage = (id: number, stage: string, comment?: string) => apiFetch(`/api/tasks/${id}/stage`, { method: 'PUT', body: JSON.stringify({ stage, comment }) })
export const addTaskComment = (taskId: number, content: string, isInternal = false) => apiFetch<{ comment: TaskComment }>(`/api/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ content, is_internal: isInternal }) }).then(d => d.comment)
export const addTaskAttachment = (taskId: number, url: string, filename: string) => apiFetch(`/api/tasks/${taskId}/attachments`, { method: 'POST', body: JSON.stringify({ url, filename }) })
export const deleteTaskAttachment = (taskId: number, attId: number) => apiFetch(`/api/tasks/${taskId}/attachments/${attId}`, { method: 'DELETE' })

export interface GravacaoEvent { id: number; title: string; recording_datetime: string; due_date: string | null; stage: string; client_id: number; parent_task_id: number | null; client_name: string; assigned_name: string | null; stage_name: string; stage_color: string }
export const fetchGravacoes = (month: string) => apiFetch<{ gravacoes: GravacaoEvent[] }>(`/api/tasks/gravacoes/calendar?month=${month}`).then(d => d.gravacoes)

export const fetchInternalApprovals = () => apiFetch<{ tasks: Task[] }>('/api/approvals/internal').then(d => d.tasks)
export const fetchClientApprovals = () => apiFetch<{ tasks: Task[] }>('/api/approvals/client').then(d => d.tasks)
export const approveTask = (id: number, comment?: string) => apiFetch(`/api/approvals/${id}/approve`, { method: 'POST', body: JSON.stringify({ comment }) })
export const rejectTask = (id: number, comment: string) => apiFetch(`/api/approvals/${id}/reject`, { method: 'POST', body: JSON.stringify({ comment }) })
export const requestChanges = (id: number, comment: string) => apiFetch(`/api/approvals/${id}/request-changes`, { method: 'POST', body: JSON.stringify({ comment }) })

export const fetchDashboardStats = (days = 30) => apiFetch(`/api/dashboard/stats?days=${days}`)
export const fetchDashboardTrends = (days = 30) => apiFetch<{ created: { date: string; count: number }[]; completed: { date: string; count: number }[] }>(`/api/dashboard/trends?days=${days}`)
export const fetchTeamWorkload = () => apiFetch<{ workers: { id: number; name: string; open_tasks: number; overdue_tasks: number; status: string; departments: { name: string; color: string }[] }[] }>('/api/dashboard/workload')

// Bulk
export const bulkMoveTasks = (taskIds: number[], stage: string) => apiFetch('/api/tasks/bulk/stage', { method: 'POST', body: JSON.stringify({ task_ids: taskIds, stage }) })
export const bulkAssignTasks = (taskIds: number[], assignedTo: number | null) => apiFetch('/api/tasks/bulk/assign', { method: 'POST', body: JSON.stringify({ task_ids: taskIds, assigned_to: assignedTo }) })

// Notifications
export interface AppNotification { id: number; user_id: number; type: string; title: string; message: string | null; task_id: number | null; triggered_by: number | null; triggered_by_name?: string; task_title?: string; is_read: number; created_at: string }
export const fetchNotifications = (page = 1, unreadOnly = false) => apiFetch<{ notifications: AppNotification[]; total: number }>(`/api/notifications?page=${page}${unreadOnly ? '&unread_only=1' : ''}`)
export const fetchUnreadCount = () => apiFetch<{ count: number }>('/api/notifications/unread-count').then(d => d.count)
export const markNotificationRead = (id: number) => apiFetch(`/api/notifications/${id}/read`, { method: 'PUT' })
export const markAllNotificationsRead = () => apiFetch('/api/notifications/read-all', { method: 'PUT' })

// Time entries
export const startTimer = (taskId: number) => apiFetch<{ entry: TimeEntry }>(`/api/tasks/${taskId}/time/start`, { method: 'POST' }).then(d => d.entry)
export const stopTimer = (taskId: number, description?: string) => apiFetch<{ entry: TimeEntry }>(`/api/tasks/${taskId}/time/stop`, { method: 'POST', body: JSON.stringify({ description }) }).then(d => d.entry)

// Client credentials
export const fetchClientCredentials = (clientId: number) => apiFetch<{ credentials: ClientCredential[] }>(`/api/clients/${clientId}/credentials`).then(d => d.credentials)
export const createClientCredential = (clientId: number, data: Partial<ClientCredential>) => apiFetch(`/api/clients/${clientId}/credentials`, { method: 'POST', body: JSON.stringify(data) })
export const updateClientCredential = (clientId: number, credId: number, data: Partial<ClientCredential>) => apiFetch(`/api/clients/${clientId}/credentials/${credId}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteClientCredential = (clientId: number, credId: number) => apiFetch(`/api/clients/${clientId}/credentials/${credId}`, { method: 'DELETE' })

// Onboard
export interface OnboardEntry { id: number; client_id: number; data: Record<string, string>; created_at: string; updated_at: string }
export const fetchClientOnboard = (clientId: number) => apiFetch<{ entries: OnboardEntry[] }>(`/api/clients/${clientId}/onboard`)

// Services
export interface ServiceField { name: string; type: 'toggle' | 'quantity' }
export interface Service { id: number; name: string; color: string; fields: ServiceField[]; is_active: number }
export const fetchServices = () => apiFetch<{ services: Service[] }>('/api/services').then(d => d.services)
export const createService = (name: string, color: string, fields: ServiceField[]) => apiFetch<{ service: Service }>('/api/services', { method: 'POST', body: JSON.stringify({ name, color, fields }) }).then(d => d.service)
export const updateService = (id: number, data: any) => apiFetch(`/api/services/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export interface ClientService extends Service { config: Record<string, string> }
export const fetchClientServices = (clientId: number) => apiFetch<{ services: ClientService[] }>(`/api/clients/${clientId}/services`).then(d => d.services)
export const updateClientServices = (clientId: number, services: { id: number; config: Record<string, string> }[]) => apiFetch(`/api/clients/${clientId}/services`, { method: 'PUT', body: JSON.stringify({ services }) })

// Financial
export interface FinancialClient { id: number; name: string; monthly_fee: number; payment_day: number; status: 'paid' | 'pending' | 'late'; paid_at?: string; amount_paid?: number; days_late: number; penalty: number; total_due: number; bank?: string | null }
export interface FinancialOverview { clients: FinancialClient[]; summary: { expected: number; received: number; received_recurring?: number; received_extra?: number; pending: number; late: number; lateCount: number } }
export interface MonthlyRevenue { month: string; total: number }
export const fetchFinancialOverview = (month: string) => apiFetch<FinancialOverview>(`/api/financial/overview?month=${month}`)
export const recordPayment = (data: { client_id: number; amount: number; reference_month: string; paid_at: string; bank?: string }) => apiFetch('/api/financial/payments', { method: 'POST', body: JSON.stringify(data) })
export const fetchFinancialDashboard = (year: number) => apiFetch<{ months: MonthlyRevenue[] }>(`/api/financial/dashboard?year=${year}`)

// Expenses
export interface ExpenseCategory { id: number; name: string; type: 'fixed' | 'variable'; color: string }
export interface Expense { id: number; category_id: number; category_name: string; category_color: string; category_type: string; description: string; amount: number; reference_month: string; paid_at: string; is_recurring: number }
export interface ExpensesByCategory { name: string; color: string; type: string; total: number; items: Expense[] }
export interface DRE { month: string; revenue: number; totalFixed: number; totalVariable: number; totalExpenses: number; profit: number; margin: number; categories: { name: string; type: string; color: string; total: number }[] }

export const fetchExpenseCategories = () => apiFetch<{ categories: ExpenseCategory[] }>('/api/financial/expense-categories').then(d => d.categories)
export const createExpenseCategory = (name: string, type: string, color: string) => apiFetch('/api/financial/expense-categories', { method: 'POST', body: JSON.stringify({ name, type, color }) })
export const fetchExpenses = (month: string) => apiFetch<{ expenses: Expense[]; byCategory: ExpensesByCategory[]; totalFixed: number; totalVariable: number; total: number }>(`/api/financial/expenses?month=${month}`)
export const createExpense = (data: { category_id: number; description: string; amount: number; reference_month: string; paid_at?: string; is_recurring?: boolean; bank?: string }) => apiFetch('/api/financial/expenses', { method: 'POST', body: JSON.stringify(data) })
export const updateExpense = (id: number, data: any) => apiFetch(`/api/financial/expenses/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteExpense = (id: number) => apiFetch(`/api/financial/expenses/${id}`, { method: 'DELETE' })
export const copyRecurringExpenses = (from: string, to: string) => apiFetch('/api/financial/expenses/copy-recurring', { method: 'POST', body: JSON.stringify({ from_month: from, to_month: to }) })
export const fetchDRE = (month: string) => apiFetch<DRE>(`/api/financial/dre?month=${month}`)

// Installments
export interface Installment { id: number; name: string; total_amount: number; installment_count: number; installment_amount: number; start_month: string; category_name?: string; category_color?: string; bank?: string | null }
export const fetchInstallments = () => apiFetch<{ installments: Installment[] }>('/api/financial/installments').then(d => d.installments)
export const createInstallment = (data: { name: string; total_amount: number; installment_count: number; start_month: string; category_id?: number; bank?: string }) => apiFetch('/api/financial/installments', { method: 'POST', body: JSON.stringify(data) })
export const deleteInstallment = (id: number) => apiFetch(`/api/financial/installments/${id}`, { method: 'DELETE' })

// Extra Revenue
export interface ExtraRevenue { id: number; client_id: number | null; client_name?: string; description: string; amount: number; reference_month: string; paid_at: string; bank?: string | null }
export const fetchExtraRevenue = (month: string) => apiFetch<{ items: ExtraRevenue[]; total: number }>(`/api/financial/extra-revenue?month=${month}`)
export const createExtraRevenue = (data: { client_id?: number; description: string; amount: number; reference_month: string; paid_at?: string; bank?: string }) => apiFetch('/api/financial/extra-revenue', { method: 'POST', body: JSON.stringify(data) })
export const deleteExtraRevenue = (id: number) => apiFetch(`/api/financial/extra-revenue/${id}`, { method: 'DELETE' })
