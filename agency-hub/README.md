# Dros Hub

Hub administrativo da Agência DROS. Gestão de clientes, contas, tarefas (workflow editorial), aprovações, financeiro (DRE, despesas, parcelamentos) e calendário de gravações.

**Repo:** https://github.com/soaresjoaoluiz1/platform
**URL produção:** https://drosagencia.com.br/hub

## Stack

- **Backend:** Node 16 + Express 5 + SQLite (better-sqlite3) + JWT
- **Frontend:** React 19 + Vite 6 + TypeScript (base path `/hub/`)
- **Realtime:** Server-Sent Events (SSE)

## Rodar local

```bash
cd agency-hub
npm install
cp .env.example .env       # ajusta JWT_SECRET
npm run dev                # sobe backend + frontend juntos
```

Backend escuta em `http://localhost:3003`. Frontend em `http://localhost:5173/hub/` (Vite).

## Build de produção (frontend)

O bundle do frontend é **buildado localmente** e commitado em `dist/` — a VPS nunca roda `npm run build`. Antes de fazer deploy de mudança no frontend:

```bash
cd agency-hub
npm run build               # gera dist/
git add dist/
git commit -m "feat(agency-hub): ..."
git push platform master
```

## Deploy

Ver [DEPLOY.md](DEPLOY.md) — caminho na VPS, processo PM2, comandos por tipo de mudança.

## Arquitetura e convenções

Detalhes sobre workflow editorial, multi-tenancy, roles e constraints de versão em [CLAUDE.md](CLAUDE.md).
