const API = 'http://localhost:3003'
const h = { 'Content-Type': 'application/json' }

async function api(path, method = 'GET', body = null, token = null) {
  const opts = { method, headers: { ...h } }
  if (token) opts.headers['Authorization'] = `Bearer ${token}`
  if (body) opts.body = JSON.stringify(body)
  return (await fetch(API + path, opts)).json()
}

async function run() {
  const { token } = await api('/api/auth/login', 'POST', { email: 'admin@drosagencia.com.br', password: 'dros2026' })
  const post = (p, b) => api(p, 'POST', b, token)
  const put = (p, b) => api(p, 'PUT', b, token)
  const get = (p) => api(p, 'GET', null, token)

  // Create clients
  const { client: c1 } = await post('/api/clients', { name: 'BG Imoveis', contact_name: 'Carlos', contact_email: 'carlos@bg.com' })
  const { client: c2 } = await post('/api/clients', { name: 'Kellermann', contact_name: 'Maria', contact_email: 'maria@keller.com' })
  const { client: c3 } = await post('/api/clients', { name: 'ASK Equipamentos', contact_name: 'Roberto', contact_email: 'roberto@ask.com' })
  console.log('Clients:', c1.name, c2.name, c3.name)

  // Create employees
  const { user: f1 } = await post('/api/users', { name: 'Lucas Designer', email: 'lucas@dros.com', password: 'test123', role: 'funcionario' })
  const { user: f2 } = await post('/api/users', { name: 'Ana Social Media', email: 'ana@dros.com', password: 'test123', role: 'funcionario' })
  const { user: f3 } = await post('/api/users', { name: 'Pedro Trafego', email: 'pedro@dros.com', password: 'test123', role: 'funcionario' })
  const { user: f4 } = await post('/api/users', { name: 'Julia Editora', email: 'julia@dros.com', password: 'test123', role: 'funcionario' })
  console.log('Employees:', f1.name, f2.name, f3.name, f4.name)

  // Assign departments
  const { departments } = await get('/api/departments')
  const design = departments.find(d => d.name === 'Design')
  const social = departments.find(d => d.name === 'Social Media')
  const trafego = departments.find(d => d.name === 'Trafego')
  const video = departments.find(d => d.name.includes('Video'))

  await put(`/api/users/${f1.id}/departments`, { department_ids: [design.id] })
  await put(`/api/users/${f2.id}/departments`, { department_ids: [social.id] })
  await put(`/api/users/${f3.id}/departments`, { department_ids: [trafego.id] })
  await put(`/api/users/${f4.id}/departments`, { department_ids: [video.id] })
  console.log('Departments assigned')

  // Create client users
  const { user: cu1 } = await post('/api/users', { name: 'Carlos BG (Cliente)', email: 'cliente@bg.com', password: 'test123', role: 'cliente', client_id: c1.id })
  const { user: cu2 } = await post('/api/users', { name: 'Maria Keller (Cliente)', email: 'cliente@keller.com', password: 'test123', role: 'cliente', client_id: c2.id })
  console.log('Client users:', cu1.name, cu2.name)

  // Get categories
  const { categories } = await get('/api/categories')
  const editorial = categories.find(c => c.name.includes('Editorial'))
  const extra = categories.find(c => c.name.includes('Extra'))
  const urgente = categories.find(c => c.name.includes('Urgente'))

  // Create tasks for BG
  const bgTasks = [
    { title: 'Carrossel Terrenos - Marco', category_id: editorial.id, department_id: design.id, assigned_to: f1.id, priority: 'normal', due_date: '2026-04-05' },
    { title: 'Video Tour Loteamento', category_id: editorial.id, department_id: video.id, assigned_to: f4.id, priority: 'high', due_date: '2026-04-03' },
    { title: 'Campanha Trafego Nova Torres', category_id: extra.id, department_id: trafego.id, assigned_to: f3.id, priority: 'normal', due_date: '2026-04-07' },
    { title: 'Stories Depoimento Cliente', category_id: editorial.id, department_id: social.id, assigned_to: f2.id, priority: 'low' },
    { title: 'Post Promo Semana Santa', category_id: urgente.id, department_id: design.id, assigned_to: f1.id, priority: 'urgent', due_date: '2026-04-02' },
    { title: 'Reels Drone Praia', category_id: editorial.id, department_id: video.id, assigned_to: f4.id, priority: 'normal', due_date: '2026-04-10' },
    { title: 'Relatorio Mensal Meta Ads', category_id: extra.id, department_id: trafego.id, assigned_to: f3.id, priority: 'normal', due_date: '2026-04-01' },
  ]

  for (const t of bgTasks) {
    await post('/api/tasks', { ...t, client_id: c1.id, drive_link: 'https://drive.google.com/drive/example' })
  }
  console.log('7 BG tasks created')

  // Create tasks for Kellermann
  const kellerTasks = [
    { title: 'Post Novo Empreendimento', category_id: editorial.id, department_id: design.id, assigned_to: f1.id, priority: 'high', due_date: '2026-04-04' },
    { title: 'Campanha Leads Forms', category_id: extra.id, department_id: trafego.id, assigned_to: f3.id, priority: 'normal', due_date: '2026-04-06' },
    { title: 'Video Institucional', category_id: extra.id, department_id: video.id, assigned_to: f4.id, priority: 'high', due_date: '2026-04-08' },
    { title: 'Feed Semanal Instagram', category_id: editorial.id, department_id: social.id, assigned_to: f2.id, priority: 'normal' },
  ]

  for (const t of kellerTasks) {
    await post('/api/tasks', { ...t, client_id: c2.id })
  }
  console.log('4 Kellermann tasks created')

  // Create tasks for ASK
  const askTasks = [
    { title: 'Landing Page Produtos', category_id: extra.id, department_id: departments.find(d => d.name.includes('Desenvolvimento')).id, priority: 'high', due_date: '2026-04-15' },
    { title: 'Post LinkedIn B2B', category_id: editorial.id, department_id: social.id, assigned_to: f2.id, priority: 'normal' },
    { title: 'Campanha Google Ads', category_id: extra.id, department_id: trafego.id, assigned_to: f3.id, priority: 'normal', due_date: '2026-04-10' },
  ]

  for (const t of askTasks) {
    await post('/api/tasks', { ...t, client_id: c3.id })
  }
  console.log('3 ASK tasks created')

  // Move some tasks through pipeline
  const allTasks = await get('/api/tasks?limit=50')
  for (let i = 0; i < allTasks.tasks.length; i++) {
    const t = allTasks.tasks[i]
    if (i < 3) { // Move first 3 to em_producao
      await put(`/api/tasks/${t.id}/stage`, { stage: 'em_producao' })
    } else if (i < 5) { // Next 2 to revisao_interna
      await put(`/api/tasks/${t.id}/stage`, { stage: 'em_producao' })
      await put(`/api/tasks/${t.id}/stage`, { stage: 'revisao_interna' })
    } else if (i < 7) { // Next 2 to aprovacao_interna
      await put(`/api/tasks/${t.id}/stage`, { stage: 'em_producao' })
      await put(`/api/tasks/${t.id}/stage`, { stage: 'revisao_interna' })
      await put(`/api/tasks/${t.id}/stage`, { stage: 'aprovacao_interna' })
    } else if (i < 9) { // Next 2 to aguardando_cliente
      await put(`/api/tasks/${t.id}/stage`, { stage: 'em_producao' })
      await put(`/api/tasks/${t.id}/stage`, { stage: 'revisao_interna' })
      await put(`/api/tasks/${t.id}/stage`, { stage: 'aprovacao_interna' })
      await post(`/api/approvals/${t.id}/approve`, { comment: 'Aprovado internamente' })
    }
    // Rest stay in backlog
  }
  console.log('Tasks moved through pipeline')

  // Add some comments
  for (let i = 0; i < 5; i++) {
    const t = allTasks.tasks[i]
    await post(`/api/tasks/${t.id}/comments`, { content: 'Trabalhando nessa demanda, previsao de entrega amanha.', is_internal: false })
    await post(`/api/tasks/${t.id}/comments`, { content: 'Nota interna: verificar referencia do cliente', is_internal: true })
  }
  console.log('Comments added')

  console.log('\n=== SEED COMPLETO ===')
  console.log('3 Clientes: BG Imoveis, Kellermann, ASK Equipamentos')
  console.log('4 Funcionarios: Lucas (Design), Ana (Social), Pedro (Trafego), Julia (Video)')
  console.log('14 Tarefas distribuidas pelo pipeline')
  console.log('\nLogins:')
  console.log('Dono:         admin@drosagencia.com.br / dros2026')
  console.log('Funcionario:  lucas@dros.com / test123')
  console.log('Funcionario:  ana@dros.com / test123')
  console.log('Funcionario:  pedro@dros.com / test123')
  console.log('Funcionario:  julia@dros.com / test123')
  console.log('Cliente BG:   cliente@bg.com / test123')
  console.log('Cliente Keller: cliente@keller.com / test123')
}

run().catch(e => console.error(e))
