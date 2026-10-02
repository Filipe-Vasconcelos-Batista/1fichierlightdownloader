# 1fichier Light Downloader

Aplicação pequena que corre num container Docker e expõe um frontend simples no browser para descarregar **todos os ficheiros de uma pasta partilhada do 1fichier** (`https://1fichier.com/?xxxxxxxx`) para uma pasta à tua escolha no computador. Requer uma conta **Premium** e a respectiva API key.

## Funcionalidades

- Cola o link da pasta (`/dir/...`), o JSON (`json=1|2`) ou uma lista de links: os ficheiros aparecem logo, com nome, temporada/episódio e tamanho
- Organiza em `Série/Season NN/` a partir do nome dos ficheiros
- Interface em Português e Inglês (botão PT/EN)
- Downloads em paralelo (por defeito 2), com barra de progresso e velocidade
- Retoma downloads interrompidos (ficheiros `.part`)
- Subpasta de destino opcional
- A API key fica guardada num volume Docker, nunca no código nem no repositório

## Requisitos

- Docker e Docker Compose
- Conta 1fichier Premium e a API key (1fichier → *Parâmetros* → *API*)

## Instalação

```bash
git clone https://github.com/Filipe-Vasconcelos-Batista/1fichierlightdownloader.git
cd 1fichierlightdownloader
cp .env.example .env
```

Edita o `.env` e define `DOWNLOAD_DIR` com a pasta do teu computador onde queres guardar os ficheiros (não precisa de ser a pasta de Downloads):

```env
DOWNLOAD_DIR=/home/o-teu-user/Videos/1fichier
FICHIER_API_KEY=a_tua_chave_aqui
```

Arranca:

```bash
docker compose up -d --build
```

## Utilização

1. Abre <http://localhost:8080>
2. Se não definiste `FICHIER_API_KEY` no `.env`, cola a key e clica em **Guardar** (o campo só aparece nesse caso)
3. Cola o link da pasta, o JSON ou a lista de links. A lista aparece sozinha
4. Clica em **Descarregar todos**

Os ficheiros aparecem em `DOWNLOAD_DIR` (ou numa subpasta, se a indicares).

## Configuração

| Variável | Onde | Descrição |
|---|---|---|
| `DOWNLOAD_DIR` | `.env` | Pasta do host onde os downloads são gravados (obrigatória) |
| `FICHIER_API_KEY` | `.env` | API key do 1fichier (opcional; alternativa: introduzir no browser) |
| `MAX_PARALLEL` | `docker-compose.yml` (`environment`) | Downloads em simultâneo (defeito: 2) |

## Notas

- O servidor só escuta em `127.0.0.1:8080`. Não o exponhas à rede sem autenticação: quem aceder pode usar a tua API key.
- Corre a aplicação a partir da tua ligação doméstica. O 1fichier bloqueia IPs de servidores, VPNs e proxies nas contas Premium.
- Se mudares as permissões da pasta de destino e os downloads falharem, confirma que o Docker tem acesso de escrita a `DOWNLOAD_DIR`.

## Aviso

Projecto não oficial, sem qualquer relação com o 1fichier. Usa-o apenas para descarregar conteúdo a que tens direito de acesso.

## Desenvolvimento

Frontend em React + Vite (`frontend/`), backend em Flask (`app/`). O Docker compila o frontend e o Flask serve-o.

```bash
cd frontend && npm install && npm run dev   # http://localhost:5173, com proxy de /api para :8080
```
