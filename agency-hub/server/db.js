import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbPath = resolve(__dirname, 'data', 'hub.db')

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  -- Clients (agency's clients)
  CREATE TABLE IF NOT EXISTS clients (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    slug          TEXT NOT NULL UNIQUE,
    logo_url      TEXT,
    contact_name  TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
  );

  -- Users (dono, funcionario, cliente)
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id   INTEGER,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('dono', 'gerente', 'funcionario', 'cliente')),
    avatar_url  TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
  );

  -- Departments (setores)
  CREATE TABLE IF NOT EXISTS departments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    color       TEXT NOT NULL DEFAULT '#FFB300',
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
  );

  -- User-department many-to-many
  CREATE TABLE IF NOT EXISTS user_departments (
    user_id       INTEGER NOT NULL,
    department_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, department_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
  );

  -- Task categories
  CREATE TABLE IF NOT EXISTS task_categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    color       TEXT NOT NULL DEFAULT '#5DADE2',
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
  );

  -- Pipeline stages
  CREATE TABLE IF NOT EXISTS pipeline_stages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    position    INTEGER NOT NULL DEFAULT 0,
    color       TEXT NOT NULL DEFAULT '#FFB300',
    is_terminal INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
  );

  -- Tasks
  CREATE TABLE IF NOT EXISTS tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id       INTEGER NOT NULL,
    category_id     INTEGER,
    department_id   INTEGER,
    stage           TEXT NOT NULL DEFAULT 'backlog',
    title           TEXT NOT NULL,
    description     TEXT,
    due_date        TEXT,
    priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    assigned_to     INTEGER,
    drive_link      TEXT,
    created_by      INTEGER NOT NULL,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES task_categories(id) ON DELETE SET NULL,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_client ON tasks(client_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_stage ON tasks(stage);
  CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
  CREATE INDEX IF NOT EXISTS idx_tasks_department ON tasks(department_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
  CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);

  -- Task comments
  CREATE TABLE IF NOT EXISTS task_comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    content     TEXT NOT NULL,
    is_internal INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id, created_at);

  -- Task history (audit trail)
  CREATE TABLE IF NOT EXISTS task_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL,
    from_stage  TEXT,
    to_stage    TEXT NOT NULL,
    user_id     INTEGER,
    comment     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_history_task ON task_history(task_id, created_at);

  -- Task attachments
  CREATE TABLE IF NOT EXISTS task_attachments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL,
    url         TEXT NOT NULL,
    filename    TEXT NOT NULL,
    type        TEXT DEFAULT 'file',
    uploaded_by INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attachments_task ON task_attachments(task_id);

  -- Time entries (timer for task execution)
  CREATE TABLE IF NOT EXISTS time_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    started_at  TEXT NOT NULL,
    ended_at    TEXT,
    duration_seconds INTEGER DEFAULT 0,
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries(task_id);

  -- Client access credentials (platform logins)
  CREATE TABLE IF NOT EXISTS client_credentials (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id   INTEGER NOT NULL,
    platform    TEXT NOT NULL,
    login       TEXT NOT NULL,
    password    TEXT NOT NULL,
    observation TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_credentials_client ON client_credentials(client_id);

  -- Notifications
  CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    message     TEXT,
    task_id     INTEGER,
    triggered_by INTEGER,
    is_read     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (triggered_by) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notif_task ON notifications(task_id);

  -- Services (agency services offered to clients)
  CREATE TABLE IF NOT EXISTS services (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    color       TEXT NOT NULL DEFAULT '#5DADE2',
    fields      TEXT NOT NULL DEFAULT '[]',
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
  );

  -- Client-service many-to-many with config
  CREATE TABLE IF NOT EXISTS client_services (
    client_id   INTEGER NOT NULL,
    service_id  INTEGER NOT NULL,
    config      TEXT DEFAULT '{}',
    PRIMARY KEY (client_id, service_id),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
  );
`)

// Seed dono
const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@drosagencia.com.br')
if (!adminExists) {
  db.prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'dono')").run(
    'Dros Admin', 'admin@drosagencia.com.br', bcrypt.hashSync('dros2026', 10)
  )
  console.log('[DB] Dono created: admin@drosagencia.com.br')
}

// Seed departments
const deptExists = db.prepare('SELECT id FROM departments LIMIT 1').get()
if (!deptExists) {
  const depts = [
    { name: 'Trafego', color: '#FF6B6B' }, { name: 'Social Media', color: '#5DADE2' },
    { name: 'Design', color: '#9B59B6' }, { name: 'Edicao de Video', color: '#FFAA83' },
    { name: 'Desenvolvimento Web', color: '#34C759' }, { name: 'Comercial', color: '#FFB300' },
  ]
  const stmt = db.prepare('INSERT INTO departments (name, color) VALUES (?, ?)')
  depts.forEach(d => stmt.run(d.name, d.color))
  console.log('[DB] Departments seeded')
}

// Seed categories
const catExists = db.prepare('SELECT id FROM task_categories LIMIT 1').get()
if (!catExists) {
  const cats = [
    { name: 'Linha Editorial', color: '#5DADE2' },
    { name: 'Demanda Extra', color: '#FFAA83' },
    { name: 'Urgente', color: '#FF6B6B' },
  ]
  const stmt = db.prepare('INSERT INTO task_categories (name, color) VALUES (?, ?)')
  cats.forEach(c => stmt.run(c.name, c.color))
  console.log('[DB] Categories seeded')
}

// Seed services
const svcExists = db.prepare('SELECT id FROM services LIMIT 1').get()
if (!svcExists) {
  const svcs = [
    { name: 'Gestao de Trafego', color: '#FF6B6B', fields: [{ name: 'Relatorio Mensal', type: 'toggle' }, { name: 'Relatorio Semanal', type: 'toggle' }] },
    { name: 'Linha Editorial', color: '#5DADE2', fields: [{ name: 'Posts', type: 'quantity' }, { name: 'Videos', type: 'quantity' }] },
    { name: 'Criacao de Site', color: '#34C759', fields: [] },
  ]
  const stmt = db.prepare('INSERT INTO services (name, color, fields) VALUES (?, ?, ?)')
  svcs.forEach(s => stmt.run(s.name, s.color, JSON.stringify(s.fields)))
  console.log('[DB] Services seeded')
}
// Backfill fields for existing services
try {
  const noFields = db.prepare("SELECT id, name FROM services WHERE fields = '[]' OR fields IS NULL").all()
  noFields.forEach(s => {
    const n = s.name.toLowerCase()
    if (n.includes('trafego')) db.prepare('UPDATE services SET fields = ? WHERE id = ?').run(JSON.stringify([{ name: 'Relatorio Mensal', type: 'toggle' }, { name: 'Relatorio Semanal', type: 'toggle' }]), s.id)
    if (n.includes('editorial')) db.prepare('UPDATE services SET fields = ? WHERE id = ?').run(JSON.stringify([{ name: 'Posts', type: 'quantity' }, { name: 'Videos', type: 'quantity' }]), s.id)
  })
} catch {}

// Seed pipeline stages
const stageExists = db.prepare('SELECT id FROM pipeline_stages LIMIT 1').get()
if (!stageExists) {
  const stages = [
    { name: 'Backlog', slug: 'backlog', position: 0, color: '#6B6580' },
    { name: 'Em Producao', slug: 'em_producao', position: 1, color: '#5DADE2' },
    { name: 'Revisao Interna', slug: 'revisao_interna', position: 2, color: '#9B59B6' },
    { name: 'Aprovacao Interna', slug: 'aprovacao_interna', position: 3, color: '#FFAA83' },
    { name: 'Aguardando Cliente', slug: 'aguardando_cliente', position: 4, color: '#FFB300' },
    { name: 'Aprovado pelo Cliente', slug: 'aprovado_cliente', position: 5, color: '#34C759' },
    { name: 'Programar Publicacao', slug: 'programar_publicacao', position: 6, color: '#FF6B8A' },
    { name: 'Concluido', slug: 'concluido', position: 7, color: '#34C759', is_terminal: 1 },
    { name: 'Rejeitado', slug: 'rejeitado', position: 8, color: '#FF6B6B', is_terminal: 1 },
  ]
  const stmt = db.prepare('INSERT INTO pipeline_stages (name, slug, position, color, is_terminal) VALUES (?, ?, ?, ?, ?)')
  stages.forEach(s => stmt.run(s.name, s.slug, s.position, s.color, s.is_terminal || 0))
  console.log('[DB] Pipeline stages seeded')
}

// Migrations - add columns if missing
try { db.exec("ALTER TABLE tasks ADD COLUMN drive_link_raw TEXT") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN drive_folder TEXT") } catch {}
try { db.exec("ALTER TABLE tasks ADD COLUMN approval_link TEXT") } catch {}
try { db.exec("ALTER TABLE tasks ADD COLUMN approval_text TEXT") } catch {}
try { db.exec("ALTER TABLE tasks ADD COLUMN publish_date TEXT") } catch {}
try { db.exec("ALTER TABLE tasks ADD COLUMN publish_objective TEXT") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN onboard_token TEXT") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN approval_token TEXT") } catch {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_approval_token ON clients(approval_token)") } catch {}
try { db.exec("ALTER TABLE client_services ADD COLUMN config TEXT DEFAULT '{}'") } catch {}
try { db.exec("ALTER TABLE services ADD COLUMN fields TEXT DEFAULT '[]'") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN monthly_fee REAL DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN payment_day INTEGER DEFAULT 10") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN cnpj TEXT") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN razao_social TEXT") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN segmento TEXT") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN website TEXT") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN instagram TEXT") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN cidade TEXT") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN estado TEXT") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN observacoes TEXT") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN contrato_inicio TEXT") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN inactivated_at TEXT") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN core_client_name TEXT") } catch {}
// IDs explicitos por plataforma — usados pra filtrar precisamente em /api/performance/*.
// core_client_name continua sendo o "hint" textual (CRM lookup, GA4 properties, Kiwify check).
try { db.exec("ALTER TABLE clients ADD COLUMN core_meta_account_id TEXT") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN core_ig_page_id TEXT") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN core_gads_customer_id TEXT") } catch {}
try { db.exec("ALTER TABLE clients ADD COLUMN core_ga4_property_id TEXT") } catch {}
try { db.exec("ALTER TABLE payments ADD COLUMN bank TEXT") } catch {}
try { db.exec("ALTER TABLE expenses ADD COLUMN bank TEXT") } catch {}
try { db.exec("ALTER TABLE extra_revenue ADD COLUMN bank TEXT") } catch {}
try { db.exec("ALTER TABLE installments ADD COLUMN bank TEXT") } catch {}
// Editorial/Anuncios task-mae support (hardcoded workflows)
try { db.exec("ALTER TABLE tasks ADD COLUMN task_type TEXT DEFAULT 'normal'") } catch {}
try { db.exec("ALTER TABLE tasks ADD COLUMN num_posts INTEGER") } catch {}
try { db.exec("ALTER TABLE tasks ADD COLUMN num_videos INTEGER") } catch {}
try { db.exec("ALTER TABLE tasks ADD COLUMN recording_datetime TEXT") } catch {}
// Rastreia origem da task quando criada a partir de template recorrente.
// Usado pra (a) mostrar badge visual "Recorrente" na UI e (b) disparar proxima instancia quando task fecha (mode='on_complete').
try { db.exec("ALTER TABLE tasks ADD COLUMN template_id INTEGER") } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_template ON tasks(template_id)") } catch {}
// Flag na tarefa MAE: se 1, subtarefas so podem ser concluidas em ordem de subtask_position.
// Backend bloqueia PUT /:id/stage='concluido' se ha alguma subtarefa anterior nao concluida.
// Ignorado em tarefas normais (sem subtarefas).
try { db.exec("ALTER TABLE tasks ADD COLUMN sequential_subtasks INTEGER NOT NULL DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE tasks ADD COLUMN briefing_content TEXT") } catch {}
try { db.exec("ALTER TABLE tasks ADD COLUMN parent_task_id INTEGER") } catch {}
try { db.exec("ALTER TABLE tasks ADD COLUMN subtask_position INTEGER") } catch {}
try { db.exec("ALTER TABLE tasks ADD COLUMN subtask_kind TEXT") } catch {}
try { db.exec("ALTER TABLE tasks ADD COLUMN meeting_datetime TEXT") } catch {}
try { db.exec("ALTER TABLE tasks ADD COLUMN requested_by_client INTEGER DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE tasks ADD COLUMN changes_requested TEXT") } catch {}
// Multi-arquivo pra aprovacao (carrossel) — JSON array de strings. approval_link fica como fallback/compat.
try { db.exec("ALTER TABLE tasks ADD COLUMN approval_files TEXT") } catch {}
// Seed solicitacao_pendente stage for existing DBs
try {
  const exists = db.prepare("SELECT id FROM pipeline_stages WHERE slug = 'solicitacao_pendente'").get()
  if (!exists) {
    db.prepare('INSERT INTO pipeline_stages (name, slug, position, color, is_terminal) VALUES (?, ?, ?, ?, ?)').run('Solicitacao Pendente', 'solicitacao_pendente', -1, '#9B59B6', 0)
  }
} catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id)") } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_subtask_kind ON tasks(subtask_kind)") } catch {}

// Checklist items — bloqueia conclusao da tarefa se algum item nao estiver done
try {
  db.exec(`CREATE TABLE IF NOT EXISTS task_checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', '-3 hours')),
    done_at TEXT
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_checklist_task ON task_checklist_items(task_id, position)')
} catch (e) { console.error('[db] checklist table err:', e.message) }

// =====================================================================
// Tarefas recorrentes — templates que o cron usa pra criar tasks novas
// =====================================================================
// Detecta tabela com schema antigo (criada antes do schema final) e dropa pra recriar limpa.
// Como nenhum template foi criado com sucesso ainda, e seguro descartar.
try {
  const cols = db.prepare("PRAGMA table_info(task_templates)").all()
  if (cols.length > 0) {
    const colNames = cols.map(c => c.name)
    const required = ['client_id', 'task_type', 'title', 'recurrence_type', 'recurrence_day']
    const missingCritical = required.filter(c => !colNames.includes(c))
    if (missingCritical.length > 0) {
      console.log('[migration] task_templates com schema incompleto, recriando. Faltando:', missingCritical)
      db.exec('DROP TABLE IF EXISTS task_template_subtask_assignees')
      db.exec('DROP TABLE IF EXISTS task_template_subtasks')
      db.exec('DROP TABLE IF EXISTS task_template_assignees')
      db.exec('DROP TABLE IF EXISTS task_templates')
    }
  }
} catch (e) { console.log('[migration] check task_templates falhou:', e.message) }
try {
  db.exec(`CREATE TABLE IF NOT EXISTS task_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    task_type TEXT DEFAULT 'normal',
    client_id INTEGER NOT NULL,
    category_id INTEGER, department_id INTEGER,
    title TEXT NOT NULL, description TEXT, priority TEXT DEFAULT 'normal',
    drive_link TEXT, drive_link_raw TEXT,
    approval_link TEXT, approval_files TEXT, approval_text TEXT,
    publish_date TEXT, publish_objective TEXT,
    due_date_offset_days INTEGER DEFAULT 7,
    recurrence_type TEXT NOT NULL,
    recurrence_day INTEGER NOT NULL,
    recurrence_hour INTEGER DEFAULT 6,
    last_run_at TEXT, next_run_at TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now', '-3 hours')),
    updated_at TEXT DEFAULT (datetime('now', '-3 hours'))
  )`)
} catch {}
try {
  db.exec(`CREATE TABLE IF NOT EXISTS task_template_assignees (
    template_id INTEGER,
    user_id INTEGER,
    PRIMARY KEY (template_id, user_id)
  )`)
} catch {}
try {
  db.exec(`CREATE TABLE IF NOT EXISTS task_template_subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER,
    subtask_position INTEGER,
    title TEXT NOT NULL, description TEXT, priority TEXT DEFAULT 'normal',
    category_id INTEGER, department_id INTEGER,
    due_date_offset_days INTEGER,
    drive_link TEXT, drive_link_raw TEXT,
    approval_link TEXT, approval_files TEXT, approval_text TEXT,
    publish_date TEXT, publish_objective TEXT
  )`)
} catch {}
try {
  db.exec(`CREATE TABLE IF NOT EXISTS task_template_subtask_assignees (
    template_subtask_id INTEGER,
    user_id INTEGER,
    PRIMARY KEY (template_subtask_id, user_id)
  )`)
} catch {}
// Sem WHERE: sqlite3 CLI do CentOS 7 nao parseia partial index, quebra inspecao manual.
try { db.exec("CREATE INDEX IF NOT EXISTS idx_task_templates_next_run ON task_templates(next_run_at)") } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_task_template_subtasks_template ON task_template_subtasks(template_id)") } catch {}

// Backward-compat: garante que TODAS as colunas existem mesmo se a tabela foi criada antes
const taskTplCols = [
  ['is_active', 'INTEGER DEFAULT 1'],
  ['task_type', "TEXT DEFAULT 'normal'"],
  ['category_id', 'INTEGER'],
  ['department_id', 'INTEGER'],
  ['description', 'TEXT'],
  ['priority', "TEXT DEFAULT 'normal'"],
  ['drive_link', 'TEXT'],
  ['drive_link_raw', 'TEXT'],
  ['approval_link', 'TEXT'],
  ['approval_files', 'TEXT'],
  ['approval_text', 'TEXT'],
  ['publish_date', 'TEXT'],
  ['publish_objective', 'TEXT'],
  ['due_date_offset_days', 'INTEGER DEFAULT 7'],
  ['recurrence_hour', 'INTEGER DEFAULT 6'],
  ['last_run_at', 'TEXT'],
  ['next_run_at', 'TEXT'],
  ['created_by', 'INTEGER'],
  ['created_at', "TEXT DEFAULT (datetime('now', '-3 hours'))"],
  ['updated_at', "TEXT DEFAULT (datetime('now', '-3 hours'))"],
  // mode = 'auto' (cron cria toda vez que bate a data, mesmo se ha pendentes — legado)
  //        'on_complete' (cron so cria proxima se nao ha nenhuma instancia pendente do template).
  // Padrao 'auto' pra nao alterar comportamento de templates ja existentes.
  ['mode', "TEXT DEFAULT 'auto'"],
  // Espelha tasks.sequential_subtasks — quando template gera task mae, propaga essa flag.
  ['sequential_subtasks', 'INTEGER NOT NULL DEFAULT 0'],
  // is_recurring=1 (default): template roda automatico via cron (bate next_run_at).
  // is_recurring=0: modelo de biblioteca — nunca cria automatico, so por aplicacao manual (botao 'Usar modelo').
  //   Nesse caso recurrence_type/recurrence_day podem ser NULL e next_run_at eh sempre NULL.
  ['is_recurring', 'INTEGER NOT NULL DEFAULT 1'],
]
for (const [col, def] of taskTplCols) {
  try { db.exec(`ALTER TABLE task_templates ADD COLUMN ${col} ${def}`) } catch {}
}

const taskTplSubCols = [
  ['description', 'TEXT'],
  ['priority', "TEXT DEFAULT 'normal'"],
  ['category_id', 'INTEGER'],
  ['department_id', 'INTEGER'],
  ['due_date_offset_days', 'INTEGER'],
  ['drive_link', 'TEXT'],
  ['drive_link_raw', 'TEXT'],
  ['approval_link', 'TEXT'],
  ['approval_files', 'TEXT'],
  ['approval_text', 'TEXT'],
  ['publish_date', 'TEXT'],
  ['publish_objective', 'TEXT'],
  ['subtask_position', 'INTEGER'],
]
for (const [col, def] of taskTplSubCols) {
  try { db.exec(`ALTER TABLE task_template_subtasks ADD COLUMN ${col} ${def}`) } catch {}
}

// =====================================================================
// Configuracoes globais (tokens, integracoes). Substitui parte do .env.
// Lido via routes/settings.js. Performance.js le tokens daqui com fallback env.
// =====================================================================
try {
  db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    is_secret INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now', '-3 hours')),
    updated_by INTEGER
  )`)
} catch {}

// Migrate users.role CHECK to include 'gerente' (SQLite requires table rebuild)
try {
  const tbl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()
  if (tbl && tbl.sql.includes("'dono', 'funcionario', 'cliente'") && !tbl.sql.includes('gerente')) {
    db.exec(`
      PRAGMA foreign_keys=OFF;
      BEGIN TRANSACTION;
      CREATE TABLE users_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id   INTEGER,
        name        TEXT NOT NULL,
        email       TEXT NOT NULL UNIQUE,
        password    TEXT NOT NULL,
        role        TEXT NOT NULL CHECK (role IN ('dono', 'gerente', 'funcionario', 'cliente')),
        avatar_url  TEXT,
        is_active   INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
      );
      INSERT INTO users_new SELECT * FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      COMMIT;
      PRAGMA foreign_keys=ON;
    `)
    console.log('[DB] Migrated users.role to include gerente')
  }
} catch (e) { console.error('[DB] Role migration failed:', e.message) }

// Payments table
db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id       INTEGER NOT NULL,
    amount          REAL NOT NULL,
    reference_month TEXT NOT NULL,
    paid_at         TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_payments_client ON payments(client_id);
  CREATE INDEX IF NOT EXISTS idx_payments_month ON payments(reference_month);
`)

// Expense categories
db.exec(`
  CREATE TABLE IF NOT EXISTS expense_categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    type        TEXT NOT NULL DEFAULT 'fixed' CHECK (type IN ('fixed', 'variable')),
    color       TEXT NOT NULL DEFAULT '#FF6B6B',
    is_active   INTEGER NOT NULL DEFAULT 1
  );
`)

// Expenses
db.exec(`
  CREATE TABLE IF NOT EXISTS expenses (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id     INTEGER NOT NULL,
    description     TEXT,
    amount          REAL NOT NULL,
    reference_month TEXT NOT NULL,
    paid_at         TEXT,
    is_recurring    INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (category_id) REFERENCES expense_categories(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses(reference_month);
  CREATE INDEX IF NOT EXISTS idx_expenses_cat ON expenses(category_id);
`)

// Seed expense categories
const expCatExists = db.prepare('SELECT id FROM expense_categories LIMIT 1').get()
if (!expCatExists) {
  const cats = [
    { name: 'Salarios', type: 'fixed', color: '#FF6B6B' },
    { name: 'Ferramentas/Software', type: 'fixed', color: '#5DADE2' },
    { name: 'Impostos', type: 'variable', color: '#FFAA83' },
    { name: 'Aluguel/Escritorio', type: 'fixed', color: '#9B59B6' },
    { name: 'Internet/Telefone', type: 'fixed', color: '#34C759' },
    { name: 'Contabilidade', type: 'fixed', color: '#FFB300' },
    { name: 'Marketing/Anuncios', type: 'variable', color: '#E91E63' },
    { name: 'Emprestimos/Parcelas', type: 'fixed', color: '#FF6B8A' },
    { name: 'Outros', type: 'variable', color: '#6B6580' },
  ]
  const stmt = db.prepare('INSERT INTO expense_categories (name, type, color) VALUES (?, ?, ?)')
  cats.forEach(c => stmt.run(c.name, c.type, c.color))
  console.log('[DB] Expense categories seeded')
}

// Installments (parcelamentos — equipamentos, emprestimos)
db.exec(`
  CREATE TABLE IF NOT EXISTS installments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    total_amount    REAL NOT NULL,
    installment_count INTEGER NOT NULL,
    installment_amount REAL NOT NULL,
    start_month     TEXT NOT NULL,
    category_id     INTEGER,
    created_at      TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (category_id) REFERENCES expense_categories(id) ON DELETE SET NULL
  );
`)

// Extra revenue (servicos avulsos)
db.exec(`
  CREATE TABLE IF NOT EXISTS extra_revenue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id       INTEGER,
    description     TEXT NOT NULL,
    amount          REAL NOT NULL,
    reference_month TEXT NOT NULL,
    paid_at         TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_extra_revenue_month ON extra_revenue(reference_month);
`)

// Task assignees (multi-assignee support)
db.exec(`
  CREATE TABLE IF NOT EXISTS task_assignees (
    task_id   INTEGER NOT NULL,
    user_id   INTEGER NOT NULL,
    PRIMARY KEY (task_id, user_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`)
// Migrate existing assigned_to to task_assignees
try {
  const tasksWithAssigned = db.prepare('SELECT id, assigned_to FROM tasks WHERE assigned_to IS NOT NULL').all()
  const existing = db.prepare('SELECT task_id FROM task_assignees LIMIT 1').get()
  if (tasksWithAssigned.length > 0 && !existing) {
    const stmt = db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)')
    tasksWithAssigned.forEach(t => stmt.run(t.id, t.assigned_to))
    console.log(`[DB] Migrated ${tasksWithAssigned.length} task assignments to task_assignees`)
  }
} catch {}

// Client onboard responses table
db.exec(`
  CREATE TABLE IF NOT EXISTS client_onboard (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id   INTEGER NOT NULL,
    data        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );
`)

// Migrate: remove UNIQUE constraint from client_onboard (allow multiple responses)
try {
  const hasUnique = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'client_onboard'").get()
  if (hasUnique && hasUnique.sql.includes('UNIQUE')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS client_onboard_new (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')), updated_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')), FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE);
      INSERT INTO client_onboard_new SELECT * FROM client_onboard;
      DROP TABLE client_onboard;
      ALTER TABLE client_onboard_new RENAME TO client_onboard;
    `)
  }
} catch {}

// Backfill onboard_token for existing clients
import { randomBytes } from 'crypto'
const clientsNoToken = db.prepare('SELECT id FROM clients WHERE onboard_token IS NULL').all()
if (clientsNoToken.length > 0) {
  const stmt = db.prepare('UPDATE clients SET onboard_token = ? WHERE id = ?')
  clientsNoToken.forEach(c => stmt.run(randomBytes(16).toString('hex'), c.id))
}

console.log('[DB] SQLite ready at', dbPath)
export default db
