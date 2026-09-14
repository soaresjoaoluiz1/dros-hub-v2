# Deploy — Dros Hub v2

## Infra

- **VPS:** vps-5269157.3store.com.br (HostGator, root SSH)
- **OS:** CentOS 7 / TuxCare ELS
- **Node:** 16.x via nvm (`source ~/.nvm/nvm.sh && nvm use 16`)
- **Web server:** Apache 2.4 (cPanel) — proxy reverso pra porta 3007
- **Path:** `/root/hub2` (NAO `/opt/platform` — esse eh do v1)
- **Processo PM2:** `dros-hub-v2` (v1 continua com nome `dros-hub`)
- **Porta API:** 3007 (v1 = 3003, CRM = 3002, Core = 3004; 3005-3006 e 3010-3011 ocupadas por outros PM2)
- **Base path frontend:** `/hub2/`
- **URL:** https://drosagencia.com.br/hub2

## Estrategia de build

**Frontend eh buildado LOCALMENTE.** A pasta `agency-hub/dist/` vai commitada no repo. A VPS nunca roda `npm run build`.

1. No PC local: `cd agency-hub && npm run build`
2. Commit incluindo `agency-hub/dist/`
3. `git push origin master`
4. Na VPS: `git pull && pm2 restart dros-hub-v2`

## Bootstrap inicial (uma vez soh)

### 1. VPS: clonar repo + instalar deps + copiar seed do v1

```bash
mkdir -p /root/hub2 && cd /root/hub2
git clone https://github.com/soaresjoaoluiz1/dros-hub-v2.git .
cd agency-hub
source ~/.nvm/nvm.sh && nvm use 16
npm ci --production=false
mkdir -p server/data
# Seed one-shot do banco do v1 (dados reais dos clientes atuais):
cp /opt/platform/agency-hub/server/data/hub.db server/data/hub.db
# .env: pega chaves do .env do v1 e cria novo JWT_SECRET:
cp /opt/platform/.env /root/hub2/.env    # ou copiar manualmente
# ATENCAO: trocar JWT_SECRET pra valor diferente do v1 (isolamento de sessao)
nano /root/hub2/.env
```

### 2. VPS: iniciar PM2

```bash
cd /root/hub2/agency-hub
pm2 start server/index.js --name dros-hub-v2
pm2 save
```

### 3. Apache: adicionar proxy

Editar `/etc/httpd/conf.d/drosagencia.conf` (ou o virtual host apropriado do dominio), DENTRO do `<VirtualHost *:443>` de `drosagencia.com.br`, ANTES das regras do `/hub` pra evitar shadowing:

O cPanel usa userdata includes. Criar 2 arquivos identicos (HTTPS + HTTP):

```bash
cat > /etc/apache2/conf.d/userdata/ssl/2_4/dros/drosagencia.com.br/hub2-proxy.conf <<'EOF'
ProxyPreserveHost On
RedirectMatch 301 ^/hub2$ /hub2/
ProxyPass /hub2/ http://127.0.0.1:3007/
ProxyPassReverse /hub2/ http://127.0.0.1:3007/
EOF
cat > /etc/apache2/conf.d/userdata/std/2_4/dros/drosagencia.com.br/hub2-proxy.conf <<'EOF'
ProxyPreserveHost On
RedirectMatch 301 ^/hub2$ /hub2/
ProxyPass /hub2/ http://127.0.0.1:3007/
ProxyPassReverse /hub2/ http://127.0.0.1:3007/
EOF
```

O `RedirectMatch 301 ^/hub2$ /hub2/` eh critico: se um usuario acessa `/hub2` sem barra final, o Apache proxy nao captura (ProxyPass eh `/hub2/`) e cai no documento root do dominio (WordPress do site principal → erro de DB). O redirect forca a barra e ai o proxy pega.

Testar e recarregar:
```bash
/scripts/ensure_vhost_includes --all-users
apachectl configtest && apachectl graceful
```

## Comandos por tipo de mudanca

Todos comecam com:
```bash
source ~/.nvm/nvm.sh && nvm use 16 && cd /root/hub2
```

### 1. So backend (rotas, server/, sem nova dep)
```bash
git pull && pm2 restart dros-hub-v2
```

### 2. Backend + nova dependencia npm
```bash
git pull && npm install --prefix agency-hub && pm2 restart dros-hub-v2
```

### 3. Frontend (ja buildado localmente)
```bash
git pull && pm2 restart dros-hub-v2
```

### 4. Reset completo (deu pau no lock ou mudou versao de pacote)
```bash
rm -f agency-hub/package-lock.json && git pull && rm -rf agency-hub/node_modules && npm install --prefix agency-hub && pm2 restart dros-hub-v2
```

## Variaveis de ambiente

Arquivo `/root/hub2/.env` (raiz do repo, NAO dentro de agency-hub). O `server/index.js` carrega via `dotenv.config({ path: '../../.env' })` a partir de `server/`.

Ver [.env.example](../.env.example) na raiz do repo pra template.

**CRITICO:** `JWT_SECRET` deve ser DIFERENTE do v1 pra sessoes ficarem isoladas entre `/hub` e `/hub2`.

## Verificacao end-to-end pos-deploy

```bash
# v1 continua intacto:
curl -I https://drosagencia.com.br/hub/                    # esperado: 200
# v2 responde:
curl -I https://drosagencia.com.br/hub2/                   # esperado: 200
# APIs isoladas:
curl https://drosagencia.com.br/hub/api/auth/login -X POST -H 'Content-Type: application/json' -d '{"email":"...","password":"..."}'
curl https://drosagencia.com.br/hub2/api/auth/login -X POST -H 'Content-Type: application/json' -d '{"email":"...","password":"..."}'
# ^ ambos retornam JWT distintos (secrets diferentes)
# PM2 dois processos rodando:
pm2 status | grep -E 'dros-hub|dros-hub-v2'
```

## Reset one-shot do banco v2 (durante desenvolvimento)

Se quiser re-seedar v2 com estado atualizado do v1 (aceita PERDER edicoes de teste feitas no v2):

```bash
pm2 stop dros-hub-v2
cp /opt/platform/agency-hub/server/data/hub.db /root/hub2/agency-hub/server/data/hub.db
pm2 start dros-hub-v2
```

## Troubleshooting

- **PM2 v2 nao responde:** `pm2 logs dros-hub-v2 --lines 100`
- **502 Apache no /hub2:** processo Node morreu, `pm2 restart dros-hub-v2`
- **Bundle antigo:** esqueceu de buildar local antes do commit. Buildar e commitar `dist/`
- **Login falha com "Invalid token":** JWT_SECRET no `.env` do v2 esta diferente do que gerou o token (usuario logou em outra instancia). Normal — deslogar e logar de novo em `/hub2`
- **`/hub2` retorna pagina do `/hub`:** proxy Apache colocado DEPOIS das regras do `/hub` — o Apache faz greedy match. Mover as regras do `/hub2` pra ANTES no virtual host.
