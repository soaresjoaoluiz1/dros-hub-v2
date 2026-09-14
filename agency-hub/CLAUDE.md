# Project — Dros Hub v2 (Preview isolado)

## Contexto

Este eh o **Dros Hub v2** — um mirror isolado do Hub v1 (`https://drosagencia.com.br/hub`) rodando em paralelo em `https://drosagencia.com.br/hub2`. Objetivo: validar novo IA (sidebar Tasty-style, Team Hub interno por cliente, CS/NPS/Melhoria Continua) sem tocar no v1 em producao.

- **v1 fica intacto** em porta 3003, banco `/opt/platform/agency-hub/server/data/hub.db`, PM2 `dros-hub`
- **v2 roda em paralelo** em porta 3005, banco `/root/hub2/agency-hub/server/data/hub.db`, PM2 `dros-hub-v2`
- **Banco 100% isolado** apos seed inicial (cp one-shot no F0). Sem sync automatico depois — cada base evolui separado
- Features novas do v1 pos-bootstrap NAO vem automaticamente pro v2

## Codebase Navigation
Codigo herdado do v1 por copia fisica no bootstrap. Estrutura identica; procure em `server/routes/`, `src/pages/`, `src/components/`.

## Git
- **Repo:** https://github.com/soaresjoaoluiz1/dros-hub-v2
- **Branch:** master
- **Remote name:** `origin`
- **Push:** `git push origin master`
- Sempre commit + push ao terminar mudancas. User pede comando de deploy depois.

## Deploy (HostGator VPS)

**Servidor:** vps-5269157.3store.com.br (root SSH)
**Caminho do repo:** `/root/hub2` (NAO `/opt/platform` — esse eh do v1)
**Processo PM2:** `dros-hub-v2`
**Node:** v16.x via nvm (`source ~/.nvm/nvm.sh && nvm use 16`)
**Porta API:** 3005
**Base path frontend:** `/hub2/`
**URL:** https://drosagencia.com.br/hub2

### IMPORTANTE — Build local igual ao v1

Frontend eh buildado LOCALMENTE — pasta `agency-hub/dist/` vai commitada no repo. VPS nunca roda `npm run build`.

1. No PC local: `cd agency-hub && npm run build`
2. Commit incluindo `agency-hub/dist/`
3. `git push origin master`
4. Na VPS: `git pull && pm2 restart dros-hub-v2`

### Comandos por tipo de mudanca

Todos comecam com:
```bash
source ~/.nvm/nvm.sh && nvm use 16 && cd /root/hub2
```

**1. So backend:**
```bash
git pull && pm2 restart dros-hub-v2
```

**2. Backend + nova dep npm:**
```bash
git pull && npm install --prefix agency-hub && pm2 restart dros-hub-v2
```

**3. Frontend (ja buildado local):**
```bash
git pull && pm2 restart dros-hub-v2
```

**4. Reset completo:**
```bash
rm -f agency-hub/package-lock.json && git pull && rm -rf agency-hub/node_modules && npm install --prefix agency-hub && pm2 restart dros-hub-v2
```

### Apagar tarefas de teste no DB (v2)
```bash
sqlite3 /root/hub2/agency-hub/server/data/hub.db "DELETE FROM ..."
```
Ordem: `task_history` → `task_assignees` → `task_comments` → `task_attachments` → `time_entries` → subtarefas → tarefa.

**NUNCA rodar isso em `/opt/platform/agency-hub/server/data/hub.db` — esse eh o banco do v1.**

## Constraints de versao (identicas ao v1)

- **Node 16.x** na VPS
- **better-sqlite3 ^12.8.0** — funciona em Node 16 com prebuilds
- **express ^5.1.0** — compat Node 16
- Frontend (Vite 6 / React 19) roda no PC local que tem Node 18+

## Arquitetura

- **Frontend:** React 19 + Vite 6 + TypeScript, base path `/hub2/`
- **Backend:** Express 5 + SQLite (better-sqlite3), JWT auth, SSE
- **DB:** SQLite em `server/data/hub.db` (auto-init + migrations idempotentes no `server/db.js`)
- **Realtime:** SSE em `server/sse.js`
- **Auth:** JWT (jsonwebtoken + bcryptjs) — JWT_SECRET **DIFERENTE** do v1 pra isolamento total
- **Roles:** `dono`, `gerente`, `funcionario`, `cliente`

## Diferencas vs v1 (que este v2 traz)

Ver plano completo em `C:\Users\conec\.claude\plans\toasty-floating-ritchie.md` (local do dono).

Resumo:
- Sidebar em grupos (Pessoal / Gestao & CS / Estrategia / Performance / Conteudo / Admin)
- Clientes em grid de cards
- Visao Geral tabela consolidada
- Team Hub interno com sub-sidebar por cliente (Dashboard Equipe, Ficha simplificada, Base Estrategica, Entrada, Reunioes, Melhoria Continua, Pesquisas, Trafego Planejamento/Metricas, Resultados, Design/Edicao/Captacao/Social Media, Acessos, Calendario)
- Modulos contratados por cliente (client_modules) — modulos desativados somem da sub-sidebar
- Jornada Entrada: Onboarding 5 + Kickoff 9 steps genericos (adaptados pra agencia geral, NAO restaurante)
- Kanbans especializados (Social Media 9 stages + Design 4 stages) com filtros/agrupamento por cliente
- Dashboard CS agregado (churn, health score, NPS medio, retention)
- NPS/Pesquisas com envio recorrente (cron)
- Melhoria Continua vinculada a NPS
- Reunioes com estrutura de decisoes/compromissos/pedidos/sugestoes (preenchimento manual, Meet AI fora do escopo)

## Preservado do v1 (nao mexer sem necessidade)

- Workflow editorial hardcoded (`tasks.js` PUT /stage) — coexiste com boards especializados
- Pipeline generico do v1 — vira "Pipeline editorial" na nova sidebar
- Gravacoes (`pages/Gravacoes.tsx`) — modulo v1 mantido integralmente
- Financial completo (dono-only)
- Performance (Meta/GAds/GA4/CRM Sheets/Kiwify) — reusa mesmas chaves API do v1
- Task-templates recorrentes — reusa mecanismo pra criar linha editorial mensal

## Conventions

- Mensagens de commit em portugues, prefixo `feat:`, `fix:`, `refactor:`, `chore:`
- Escopo `(agency-hub)` nos commits
- Sem emojis em codigo (so se o user pedir)
- Multi-tenant: toda query filtra por `client_id` do usuario logado
- NUNCA usar o nome do sistema de referencia (que foi olhado em prints) em variaveis, comentarios ou UI — eh so inspiracao
