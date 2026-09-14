# Dros Hub v2

Preview isolado do novo hub de gestao interna da Dros Agencia.

- **URL producao:** https://drosagencia.com.br/hub2
- **Hub v1 (producao atual, intocado):** https://drosagencia.com.br/hub

## Objetivo

Validar novo IA (sidebar em grupos, Team Hub interno por cliente, modulo de CS, jornada de Entrada Onboarding+Kickoff, Kanbans especializados) sem tocar no v1 em producao. Rodam em paralelo, bancos completamente isolados.

## Estrutura

```
dros-hub-v2/
  .env.example      # template — copiar pra .env
  agency-hub/       # aplicacao (frontend + backend)
    src/            # React 19 + Vite 6 + TS
    server/         # Express 5 + SQLite
      data/         # hub.db local (gitignored)
    dist/           # build de producao (commitado pra deploy)
    CLAUDE.md       # instrucoes pra Claude Code
    DEPLOY.md       # procedimento de deploy VPS
```

## Dev local

```bash
git clone https://github.com/soaresjoaoluiz1/dros-hub-v2.git
cd dros-hub-v2
cp .env.example .env    # editar JWT_SECRET e outras chaves
cd agency-hub
npm ci
npm run dev             # inicia backend porta 3005 + frontend porta 5179
```

Acessar: http://localhost:5179/hub2/

## Deploy

Ver [agency-hub/DEPLOY.md](agency-hub/DEPLOY.md).

## Isolamento vs v1

- Banco separado (`/root/hub2/agency-hub/server/data/hub.db` vs `/opt/platform/agency-hub/server/data/hub.db`)
- PM2 process separado (`dros-hub-v2` vs `dros-hub`)
- Porta separada (3005 vs 3003)
- JWT_SECRET diferente (sessoes nao se misturam)
- Path Apache separado (`/hub2` vs `/hub`)

Apos o seed inicial (cp one-shot do banco do v1), cada base evolui independente — sem sync automatico.
