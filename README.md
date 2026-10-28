# Ingestor da Câmara dos Deputados

Aplicação TypeScript que ingere dados abertos da Câmara, preserva os payloads
originais e grava os dados normalizados em PostgreSQL.

## Requisitos

- Node.js 22.12 ou superior e npm
- PostgreSQL
- Inngest Cloud ou Inngest Dev Server para a carga de legislaturas e a rotina
  agendada de despesas

## Instalação e configuração

```sh
npm install
cp .envexample .env
```

Configure `DATABASE_URL` no `.env` com a connection string PostgreSQL da
aplicação. Para migrations, configure também `DATABASE_URL_DIRECT` quando o
banco exigir conexão direta. Não versione o `.env`.

| Variável                 | Obrigatória           | Descrição                                                                       |
| ------------------------ | --------------------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`           | Sim                   | Connection string usada pelo serviço e pelos comandos `--persist`.              |
| `DATABASE_URL_DIRECT`    | Não                   | Connection string direta, usada nas migrations; se omitida, usa `DATABASE_URL`. |
| `PORT`                   | Não                   | Porta HTTP do serviço; padrão `8080`.                                           |
| `CAMARA_MAX_CONCURRENT`  | Não                   | Requisições simultâneas à API por instância; padrão `2`.                        |
| `CAMARA_MIN_INTERVAL_MS` | Não                   | Intervalo mínimo entre requisições; padrão `250` ms.                            |
| `INNGEST_SIGNING_KEY`    | Produção              | Chave de assinatura do Inngest.                                                 |
| `INNGEST_EVENT_KEY`      | Conforme configuração | Chave para envio de eventos do Inngest.                                         |

Crie/atualize o schema do banco e inicie o serviço:

```sh
npm run db:migrate
npm run dev
```

Antes de iniciar uma versão com registro de execuções, aplique todas as
migrations pendentes, incluindo a criação de `crawler_runs`.

O serviço expõe `GET /healthz` e o endpoint do Inngest em `/api/inngest`.
Registre esse endpoint no Inngest Cloud ou conecte o Inngest Dev Server ao
endereço local. Para desenvolvimento local, por exemplo:

```sh
npx inngest-cli@latest dev -u http://localhost:8080/api/inngest
```

### Executar localmente com Docker Compose

Defina uma senha local em `.env` (`POSTGRES_PASSWORD`) e suba PostgreSQL,
migrations e o worker:

```sh
docker compose up --build
```

O Compose não cria um container de API nem um serviço separado de crawler.
Ele inicia o banco e um único worker; a migration roda antes de o worker
iniciar. Conecte o Inngest Dev Server ao worker em
`http://localhost:8080/api/inngest` para receber eventos e cron locais.
`docker compose down` para os containers; `docker compose down -v` também
apaga o volume local do PostgreSQL.

## Fluxo recomendado de ingestão

1. **Carregue as legislaturas uma vez pelo Inngest.** A função
   `sync-legislaturas` não tem cron: após iniciar o serviço e sincronizar as
   funções no Inngest, envie pelo painel um evento com nome
   `camara/legislaturas.seed` e dados `{}`. Uma única execução percorre todas
   as páginas da API e faz upsert idempotente. Não é necessário repetir essa
   carga mensalmente.
2. **Sincronize deputados da legislatura desejada.** A legislatura precisa
   estar carregada no passo anterior. O crawler sincroniza os partidos como
   pré-requisito e importa o histórico partidário de cada deputado.
3. **Pré-valide e importe o CSV anual de passagens.** Importe-o antes da
   primeira carga de despesas para que as correspondências já estejam no
   PostgreSQL quando as despesas chegarem.
4. **Sincronize despesas recentes ou faça backfill.** O comando consulta a API
   por deputado, legislatura e mês; o importador de CSV não é executado junto.

O campo `legislaturas.legislatura_atual` é booleano. Seu valor é recalculado
com base na data de Brasília e no intervalo inclusivo `data_inicio`–`data_fim`
durante o seed e antes da rotina semanal de despesas. A consulta de despesas
seleciona a legislatura vigente a partir desse mesmo intervalo.

## CLI

Formato geral:

```sh
npm run crawler -- <módulo> [argumentos]
```

Argumentos com valor aceitam `--opção=valor` ou `--opção valor`. O modo padrão
é `--dry-run`: consulta e valida sem gravar. Use `--persist` explicitamente
para gravar; não combine `--persist` com `--dry-run`. Os módulos que consultam
a API respeitam o rate limit configurado; o importador CSV não faz requisições
HTTP.

| Módulo         | Argumento                               | Obrigatório | Padrão / comportamento                                                                                                              |
| -------------- | --------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `legislaturas` | `--legislatura=<id>`                    | Não         | Filtra pelo ID; se omitido, valida todas. CLI é somente dry-run; a persistência é feita pelo evento Inngest.                        |
| `legislaturas` | `--pages=<n>`                           | Não         | Limite de 1 a 50 páginas; padrão `50`.                                                                                              |
| `legislaturas` | `--dry-run`                             | Não         | Opcional, pois o CLI sempre é somente leitura.                                                                                      |
| `deputados`    | `--legislatura=<id>`                    | Sim         | ID positivo da legislatura.                                                                                                         |
| `deputados`    | `--pages=<n>`                           | Não         | Limite de 1 a 50 páginas; padrão `50`.                                                                                              |
| `deputados`    | `--dry-run` / `--persist`               | Não         | Dry-run padrão; persistência exige `DATABASE_URL` e migrations.                                                                     |
| `despesas`     | `--legislatura=<id>`                    | Sim         | ID positivo da legislatura.                                                                                                         |
| `despesas`     | `--deputado=<id>`                       | No dry-run  | Limita a consulta; no persist, se omitido, usa os deputados já cadastrados na legislatura.                                          |
| `despesas`     | `--ano=<AAAA>` e `--mes=<MM>`           | Não         | Devem ser usados juntos para sincronizar um mês.                                                                                    |
| `despesas`     | `--desde=<AAAA-MM>` e `--ate=<AAAA-MM>` | Não         | Devem ser usados juntos; intervalo inclusivo para backfill, máximo 120 meses. Não combinar com `--ano`/`--mes`.                     |
| `despesas`     | Sem período                             | Não         | Usa o mês corrente e os dois meses anteriores.                                                                                      |
| `despesas`     | `--pages=<n>`                           | Não         | Limite de 1 a 500 páginas por período; padrão `500`.                                                                                |
| `despesas`     | `--dry-run` / `--persist`               | Não         | Dry-run padrão; no modo persistente, exige `DATABASE_URL` e migrations.                                                             |
| `bilhetes-csv` | `--arquivo=<caminho>`                   | Sim         | Arquivo CSV anual oficial, lido em streaming.                                                                                       |
| `bilhetes-csv` | `--dry-run` / `--persist`               | Não         | Dry-run padrão; valida o arquivo, conta registros/candidatos e imprime amostra. `--persist` grava candidatos e reconcilia despesas. |

### Exemplos por etapa

Validar a API de legislaturas sem persistir:

```sh
npm run crawler -- legislaturas --pages=1
```

Validar deputados e depois persistir os deputados da legislatura 57:

```sh
npm run crawler -- deputados --legislatura=57 --pages=1
npm run crawler -- deputados --legislatura=57 --persist
```

Validar o CSV sem banco e, após revisar a amostra, importá-lo:

```sh
npm run crawler -- bilhetes-csv --arquivo=assets/Ano-2025.csv
npm run crawler -- bilhetes-csv --arquivo=assets/Ano-2025.csv --persist
```

Depois de importar o CSV, sincronizar uma página de despesas de um deputado
para abril de 2025; em seguida, carregar os três meses recentes de todos os
deputados já sincronizados:

```sh
npm run crawler -- despesas --legislatura=57 --deputado=218086 --ano=2025 --mes=4 --pages=1
npm run crawler -- despesas --legislatura=57 --persist
```

Backfill histórico inclusivo:

```sh
npm run crawler -- despesas --legislatura=57 --desde=2023-02 --ate=2026-10 --persist
```

O CSV é sempre um comando separado da API. Uma vez importados, os candidatos
ficam em `bilhetes_aereos_csv`; ao gravar despesas, a aplicação faz a
reconciliação no banco sem reler o arquivo. É seguro importar o CSV depois da
API também: nesse caso o importador reconcilia as despesas já armazenadas.
Valores negativos são preservados. Correspondências ambíguas não escolhem
automaticamente passageiro ou trecho.

## Rotinas Inngest

| Função              | Disparo                                  | Trabalho                                                                                                              |
| ------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `sync-legislaturas` | Evento manual `camara/legislaturas.seed` | Percorre todas as páginas e grava as legislaturas; execute no seed inicial ou quando precisar atualizar a referência. |
| `sync-despesas`     | Domingo, às 03h no horário de Brasília   | Atualiza os três meses mais recentes de todos os deputados cadastrados na legislatura vigente.                        |

Os payloads brutos são mantidos para auditoria e reprocessamento. Os upserts
normalizados são idempotentes; uma execução interrompida pode ser repetida.
O Inngest registra as etapas e faz retry das falhas sem marcar páginas
incompletas como concluídas.

Toda execução de função Inngest é registrada em `crawler_runs` antes de
começar o trabalho e finalizada com estado `completed` ou `failed`, horário,
resumo (quando concluída) e mensagem de erro (quando falha). O `run_id` do
Inngest identifica a execução; tentativas de retry atualizam o mesmo registro
e incrementam `attempt`, preservando uma linha por run. Se o registro de início
ou de término falhar no PostgreSQL, a função falha para que o Inngest faça
retry, em vez de executar sem histórico persistente.

Esse registro é para execuções Inngest; comandos CLI dry-run não criam linhas
em `crawler_runs`. Para consultar o histórico mais recente:

```sql
SELECT function_id, run_id, event_name, status, attempt,
       started_at, finished_at, summary, error
FROM crawler_runs
ORDER BY started_at DESC
LIMIT 50;
```

## Desenvolvimento

```sh
npm run check
npm test
npm run build
```

O schema fica em `src/infrastructure/persistence/schema.ts` e as migrations em
`drizzle/`. A arquitetura separa domínio, casos de uso, portas e adaptadores;
`src/main.ts` compõe as implementações de HTTP, PostgreSQL e Inngest.
