<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/logo-dark.png">
    <img src="branding/logo.png" alt="Light Downloader" width="520">
  </picture>
</p>

🇬🇧 [English version](README.md)

Aplicação pequena que corre num container Docker e abre uma interface no browser para descarregar **vários ficheiros do 1fichier de uma só vez**, a partir de pastas partilhadas, JSONs ou listas de links, e organizá-los já no formato que o **Jellyfin** reconhece (`Série (Ano)/Season 01/...`). Requer uma conta **1fichier Premium** e a respectiva API key.

## Funcionalidades

**Entrada**
- Cola um link de pasta (`https://1fichier.com/dir/...`), o JSON da pasta (`?json=1|2`), a tabela copiada do browser ou uma lista de links (um por linha)
- Podes colar ou carregar **vários de uma vez**: cada origem fica num separador próprio
- Os ficheiros aparecem logo, com nome, temporada/episódio e tamanho

**Organização (Jellyfin)**
- Detecta série, temporada e episódio no nome dos ficheiros: `S01E01`, `1x05` e `Nome - 05 - Título` (neste último assume temporada 1)
- Por grupo, escolhes o nome da pasta entre os nomes detectados ou escreves outro, e podes definir o ano
- Pesquisa no **TMDB** (opcional) para preencher nome e ano, com a opção de incluir `[tmdbid-N]` no nome da pasta
- Nome dos ficheiros à escolha: original, `Série (Ano) S01E01` ou só `S01E01`, igual para todos os grupos ou por grupo
- Resultado: `Série (Ano)/Season NN/ficheiro`

**Descarregar**
- Escolhe os ficheiros a descarregar: caixas por ficheiro e um filtro (`S02`, `E05`, nome…)
- **Histórico**: os ficheiros já descarregados aparecem marcados com ✓ e desmarcados por defeito
- Downloads em paralelo, com progresso, velocidade, pausa/retoma e botão de cancelar; botão para repetir depois de um erro
- Uma fila a sério: os downloads arrancam de cima para baixo e podes arrastar as linhas para mudar a ordem
- Limite de velocidade global opcional (MB/s), nas **Definições (⚙)**
- Tamanho restante, tempo que falta e hora prevista de fim; a velocidade média das últimas sessões fica guardada **por rede** (identificada pelo operador da ligação, via ipinfo.io; podes desligar) para que uma rede diferente nunca use a média de outra
- Limite de dados opcional por dia, semana, mês ou ano: os downloads pausam ao atingi-lo e retomam sozinhos quando o período renova
- Proteção da API: os pedidos ao 1fichier têm limite por segundo (máx. 3, como a documentação deles exige) e tudo pausa depois de N erros seguidos, para evitar o bloqueio da conta ou do IP
- Vigia do disco: avisa quando o espaço livre no destino está a acabar, pausa abaixo de um mínimo e verifica se a seleção cabe antes de começares
- Retoma downloads interrompidos (ficheiros `.part`)
- Pasta de destino por defeito, ou escolhida na app (opcional, ver [Configuração](#configuração))

**Geral**
- Interface em Português e Inglês (botão PT/EN)
- A API key nunca vai para o código nem para o repositório

## Requisitos

- Docker e Docker Compose
- Conta 1fichier Premium e a API key (1fichier → *Parâmetros* → *API*)
- Opcional: chave da API do TMDB ([themoviedb.org](https://www.themoviedb.org) → *Definições* → *API*)

## Instalação

```bash
git clone https://github.com/Filipe-Vasconcelos-Batista/1fichierlightdownloader.git
cd 1fichierlightdownloader
cp .env.example .env
```

Edita o `.env`:

```env
DOWNLOAD_DIR=/home/o-teu-user/Videos/1fichier
FICHIER_API_KEY=a_tua_chave_aqui
```

Arranca:

```bash
docker compose up -d --build
```

Para actualizar mais tarde: `git pull` e `docker compose up -d --build`.

## Utilização

1. Abre <http://localhost:8080>
2. Se não definiste `FICHIER_API_KEY` no `.env`, abre as **Definições (⚙)**, cola a tua API key do 1fichier e guarda (uma barra de aviso lembra-te enquanto faltar)
3. Cola o link da pasta, o JSON ou a lista de links. A lista aparece sozinha
4. Por cada grupo (separador), confirma o nome da pasta, o ano (podes usar **Pesquisar no TMDB**) e o formato dos nomes dos ficheiros. Um **!** laranja assinala os grupos ainda por rever
5. Marca os ficheiros que queres e clica em **Descarregar selecionados**

Os ficheiros ficam no destino, organizados em `Série (Ano)/Season NN/`.

## Configuração

Todas as variáveis vão no `.env`. As API keys e o número de downloads em simultâneo são opcionais aí: podes introduzi-los e alterá-los quando quiseres em **Definições (⚙)**. Um valor guardado na app tem prioridade sobre o do `.env`.

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DOWNLOAD_DIR` | sim | Pasta do teu computador onde os downloads são gravados por defeito |
| `FICHIER_API_KEY` | não | API key inicial do 1fichier. Também a podes definir ou alterar em **Definições (⚙)** |
| `TMDB_API_KEY` | não | Chave inicial (v3 ou token v4) do TMDB. Activa o botão **Pesquisar no TMDB**. Também em **Definições (⚙)** |
| `SELECTABLE_DIR` | não | Pasta do computador (ex.: `/home/o-teu-user` ou `/mnt/media`) dentro da qual podes escolher o destino na app, com o botão **Alterar**. Se ficar vazia, o botão não aparece e é usado sempre o `DOWNLOAD_DIR` |
| `TZ` | não | O teu fuso horário (ex.: `Europe/Lisbon`), só usado se escolheres "A minha hora" no limite de dados. Defeito: UTC |
| `MAX_PARALLEL` | não | Número inicial de downloads em simultâneo (defeito: 2). Também em **Definições (⚙)** |

Sobre `SELECTABLE_DIR`: dá ao container permissão de escrita nessa pasta, por isso escolhe a mais estreita possível. Na app só consegues navegar dentro dela.

## Limite de dados

Nas **Definições (⚙)** podes definir um limite em GB por dia, semana (a começar à segunda), mês ou ano. A app conta os bytes que **esta app** descarrega (não vê o resto do tráfego do PC nem o que o 1fichier regista na conta), por isso serve de travão e não de contador oficial. Ao atingir o limite, todos os downloads pausam e retomam sozinhos quando o período renova ou se aumentares o limite. Podes mudar o período quando quiseres: o consumo é guardado por dia, por isso a contagem ajusta-se. Por defeito o dia muda à meia-noite **de França** (a API do 1fichier indica que as datas são em CET/CEST); podes mudar para a tua hora (`TZ` no `.env`). A API do 1fichier não indica quando a quota de tráfego renova, por isso, num limite mensal, podes definir o dia do mês em que o período começa, para coincidir com a data de renovação que a tua conta mostra.

## Ficheiro de definições

As tuas API keys e os limites ficam em **`config/settings.yaml`**. É criado na primeira execução (as definições de versões anteriores são migradas sozinhas), podes editá-lo à mão (a app relê-o sozinha) ou alterá-lo nas **Definições (⚙)**. Contém as tuas API keys, por isso está no `.gitignore` e **nunca vai para o repositório**; o `config/settings.example.yaml` é o modelo comentado. Um valor no `settings.yaml` tem prioridade sobre o mesmo valor no `.env`.

Inclui: as API keys, os downloads em simultâneo e o limite de velocidade, os pedidos por segundo e o limite de erros (`api`), o limite de dados (`data_limit`) e os limites de espaço em disco (`disk`).

Se o ficheiro tiver um erro de YAML, a app continua com os últimos valores válidos e mostra um aviso.

## Dados guardados

O destino escolhido, o histórico de downloads e a contagem de dados ficam num volume Docker (`fichier-config`). Sobrevivem a `docker compose down` e a actualizações, mas são apagados com `docker compose down -v`. O `config/settings.yaml` não é afectado.

## Notas

- O servidor só escuta em `127.0.0.1:8080`. Não o exponhas à rede sem autenticação: quem aceder pode usar a tua API key.
- Corre a aplicação a partir da tua ligação doméstica. O 1fichier bloqueia IPs de servidores, VPNs e proxies nas contas Premium.
- O container grava como `root`, por isso os ficheiros novos podem ficar com esse dono. Se isso te incomodar, corrige com `sudo chown -R $USER: <pasta>`.
- Se os downloads falharem ao gravar, confirma que o Docker tem acesso de escrita à pasta de destino.
- Se dois ficheiros do mesmo grupo resultarem no mesmo nome final (por exemplo, versões 720p e 1080p do mesmo episódio no formato `S01E01`), o segundo sobrescreve o primeiro.

## Desenvolvimento

Frontend em React + Vite (`frontend/`), backend em Flask (`app/`). O Docker compila o frontend e o Flask serve-o.

```bash
cd frontend && npm install && npm run dev   # http://localhost:5173, com proxy de /api para :8080
```

O backend corre no container (`docker compose up -d --build`); em desenvolvimento, o Vite reencaminha `/api` para ele.

## Licença

[PolyForm Noncommercial 1.0.0](LICENSE): livre para usar, modificar e partilhar para fins não comerciais. Não é permitido vendê-lo nem usá-lo comercialmente.

## Autor

Filipe Vasconcelos Batista · [filipevbatista1@gmail.com](mailto:filipevbatista1@gmail.com) · [GitHub](https://github.com/Filipe-Vasconcelos-Batista)

## Aviso

Projecto não oficial, sem qualquer relação com o 1fichier nem com o TMDB. Usa-o apenas para descarregar conteúdo a que tens direito de acesso.
Este produto usa a API do TMDB mas não é por ele endossado nem certificado.
