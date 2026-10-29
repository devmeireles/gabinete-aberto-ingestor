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
| `INNGEST_SIGNING_KEY`    | Produção              | Chave de assinatura do Inngest para validar chamadas recebidas.                 |
| `INNGEST_EVENT_KEY`      | Produção              | Chave do Inngest necessária para publicar eventos entre as etapas dos seeds.     |

Crie/atualize o schema do banco e inicie o serviço:

```sh
npm run db:migrate
npm run dev
```

Em produção, crie o secret `INNGEST_EVENT_KEY` no Secret Manager com a Event
Key do ambiente Inngest correspondente e conceda ao service account do Cloud
Run o papel `roles/secretmanager.secretAccessor`. O Cloud Build configura esse
secret na revisão do serviço; ele é usado pelo worker para publicar os eventos
que encadeiam os seeds de partidos e deputados.

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
   `seed-legislaturas` não tem cron: após iniciar o serviço e sincronizar as
   funções no Inngest, envie pelo painel um evento com nome
   `camara/legislaturas.seed` e dados `{}`. Uma única execução percorre todas
   as páginas da API e faz upsert idempotente. Não é necessário repetir essa
   carga mensalmente.
2. **Carregue partidos e seus perfis pelo Inngest.** Envie
   `camara/partidos.seed` com `{"legislaturaId": 57}`. O seed lista e grava os
   partidos da legislatura e dispara, separadamente, os eventos para buscar
   cada detalhe em `/partidos/{id}`. Para repetir o enriquecimento de todos os
   partidos já cadastrados, envie `camara/partidos.perfil.seed` com dados `{}`.
3. **Carregue a lista de deputados pelo Inngest.** Envie
   `camara/deputados.seed` com `{"legislaturaId": 57}` (substitua pelo ID
   desejado). A legislatura deve estar carregada. Esse seed sincroniza
   partidos, a lista e o histórico partidário, depois dispara eventos para a
   segunda etapa.
4. **Enriqueça os perfis em um seed separado.** Para cada deputado recebido,
   `seed-perfis-deputados` consulta `/deputados/{id}` e grava os dados pessoais
   e o snapshot de `ultimoStatus`. Os payloads brutos das listas, históricos e
   detalhes também são preservados. Para reenriquecer todos os deputados já
   cadastrados, envie `camara/deputados.perfil.seed` com dados `{}`; use
   `{"deputadoId": 218086}` para processar apenas um perfil.
5. **Carregue os CSVs oficiais de passagens pelo Inngest.** Envie o evento
   `camara/bilhetes-aereos.seed` sem dados para importar todos os anos desde
   2008, ou informe `{"ano": 2025}` para carregar somente um ano. Os ZIPs são
   baixados da Câmara, extraídos em streaming e importados sem salvar arquivos
   localmente.
6. **Sincronize despesas recentes ou faça backfill.** O comando consulta a API
   por deputado, legislatura e mês. A reconciliação com passageiros e trechos
   usa os dados já importados no banco.

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
a API da Câmara respeitam o rate limit configurado. O seed de passagens é
separado e baixa arquivos oficiais pelo Inngest.

| Módulo         | Argumento                               | Obrigatório | Padrão / comportamento                                                                                          |
| -------------- | --------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| `legislaturas` | `--legislatura=<id>`                    | Não         | Filtra pelo ID; se omitido, valida todas. CLI é somente dry-run; a persistência é feita pelo evento Inngest.    |
| `legislaturas` | `--pages=<n>`                           | Não         | Limite de 1 a 50 páginas; padrão `50`.                                                                          |
| `legislaturas` | `--dry-run`                             | Não         | Opcional, pois o CLI sempre é somente leitura.                                                                  |
| `deputados`    | `--legislatura=<id>`                    | Sim         | ID positivo da legislatura.                                                                                     |
| `deputados`    | `--pages=<n>`                           | Não         | Limite de 1 a 50 páginas; padrão `50`.                                                                          |
| `deputados`    | `--dry-run` / `--persist`               | Não         | Dry-run padrão; `--persist` grava a lista, o histórico e o detalhe de cada deputado; requer migrations.         |
| `despesas`     | `--legislatura=<id>`                    | Sim         | ID positivo da legislatura.                                                                                     |
| `despesas`     | `--deputado=<id>`                       | No dry-run  | Limita a consulta; no persist, se omitido, usa os deputados já cadastrados na legislatura.                      |
| `despesas`     | `--ano=<AAAA>` e `--mes=<MM>`           | Não         | Devem ser usados juntos para sincronizar um mês.                                                                |
| `despesas`     | `--desde=<AAAA-MM>` e `--ate=<AAAA-MM>` | Não         | Devem ser usados juntos; intervalo inclusivo para backfill, máximo 120 meses. Não combinar com `--ano`/`--mes`. |
| `despesas`     | Sem período                             | Não         | Usa o mês corrente e os dois meses anteriores.                                                                  |
| `despesas`     | `--pages=<n>`                           | Não         | Limite de 1 a 500 páginas por período; padrão `500`.                                                            |
| `despesas`     | `--dry-run` / `--persist`               | Não         | Dry-run padrão; no modo persistente, exige `DATABASE_URL` e migrations.                                         |

### Backfill local de despesas com auditoria

Para executar no terminal o equivalente ao evento
`camara/despesas.backfill` com legislatura 57 e intervalo de março a abril
de 2024:

```sh
npm run crawler -- despesas --legislatura=57 --desde=2024-03 --ate=2024-04 --persist
```

O comando grava no banco indicado por `DATABASE_URL` (também pode vir do
`.env`). Aplique as migrations nesse banco antes de iniciar; legislaturas,
deputados e vínculos com a legislatura devem estar cadastrados. Sem
`--deputado`, processa todos os deputados cadastrados na legislatura, como
o dispatcher do Inngest. Não é necessário iniciar o servidor nem configurar
chaves do Inngest.

No modo persistente, cada deputado/mês registra uma linha em `crawler_runs`
com `function_id = 'cli-despesas-month'`, evento
`cli/despesas.backfill.month`, `run_id` iniciado por `cli-` e `attempt = 1`.
O status começa em `running`, termina em `completed` com resumo por mês
(escopo, páginas e contadores, incluindo `conflicted`) ou em `failed` com
a mensagem de erro. A lógica de auditoria é compartilhada com o Inngest;
payloads brutos, despesas, quarentena e enriquecimento usam os mesmos casos
de uso e repositórios. O dry-run não grava nem cria execuções.

A execução local é sequencial e para no primeiro erro; os meses seguintes
não são iniciados. Não há checkpoints, retries de jobs ou limite de
concorrência global do Inngest. Uma nova invocação cria novas linhas de
execução e reprocessa os dados de forma idempotente. Evite `--pages` para
uma carga completa: ao atingir um limite com páginas pendentes, o comando
interrompe a varredura e o resumo registra `truncated = true`.

Para conferir as execuções locais:

```sql
SELECT run_id, status, started_at, finished_at, summary, error
FROM crawler_runs
WHERE function_id = 'cli-despesas-month'
ORDER BY started_at DESC;
```

### Exemplos de CLI

Validar a API de legislaturas sem persistir:

```sh
npm run crawler -- legislaturas --pages=1
```

Validar deputados e depois persistir os deputados da legislatura 57:

```sh
npm run crawler -- deputados --legislatura=57 --pages=1
npm run crawler -- deputados --legislatura=57 --persist
```

Sincronizar uma página de despesas de um deputado para abril de 2025; em
seguida, carregar os três meses recentes de todos os deputados já sincronizados:

```sh
npm run crawler -- despesas --legislatura=57 --deputado=218086 --ano=2025 --mes=4 --pages=1
npm run crawler -- despesas --legislatura=57 --persist
```

Backfill histórico inclusivo:

```sh
npm run crawler -- despesas --legislatura=57 --desde=2023-02 --ate=2026-10 --persist
```

O seed de passagens é executado exclusivamente pelo Inngest, nunca pela CLI.
Os registros importados ficam em `bilhetes_aereos_csv`; ao gravar despesas, a
aplicação reconcilia no banco sem baixar os arquivos novamente. Também é seguro
executar o seed depois das despesas: a etapa final reconcilia as despesas já
armazenadas. Valores negativos são preservados. Correspondências ambíguas não
escolhem automaticamente passageiro ou trecho.

Cada registro CSV mantém o status `available` até ser associado sem ambiguidade
a uma despesa; nesse caso, passa para `associated` e guarda o ID da despesa.
Assim, novas reconciliações priorizam o pool ainda disponível. Se os dados da
despesa mudarem, o bilhete associado é liberado para nova correspondência.

## Rotinas Inngest

| Função                  | Disparo                                      | Trabalho                                                                                              |
| ----------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `seed-legislaturas`     | Evento `camara/legislaturas.seed`            | Percorre todas as páginas e grava as legislaturas.                                                    |
| `seed-partidos`         | Evento `camara/partidos.seed`                | Com `{"legislaturaId": 57}`, grava a lista e dispara eventos de enriquecimento dos partidos.           |
| `seed-perfis-partidos`  | Evento `camara/partidos.perfil.seed`         | Sem payload enriquece sequencialmente todos os partidos cadastrados; com `{"partidoId": 37906}`, processa somente um. |
| `seed-deputados`        | Evento `camara/deputados.seed`               | Com `{"legislaturaId": 57}`, grava lista e histórico; dispara eventos para seed de perfis.             |
| `seed-perfis-deputados` | Evento `camara/deputados.perfil.seed`        | Sem payload enriquece sequencialmente todos os deputados cadastrados; com `{"deputadoId": 218086}`, processa somente um. |
| `seed-bilhetes-aereos`  | Evento `camara/bilhetes-aereos.seed`         | Sem payload importa de 2008 até o ano corrente; `{"ano": 2025}` importa somente aquele ano.           |
| `sync-despesas`         | Domingo, às 03h no horário de Brasília       | Atualiza os três meses mais recentes de todos os deputados cadastrados na legislatura vigente.        |
| `backfill-despesas`     | Evento `camara/despesas.backfill`            | Enfileira a varredura retroativa por deputado e mês; workers independentes processam e registram cada resultado. |

Para fazer uma varredura retroativa no Inngest, envie um evento com a
legislatura e um intervalo inclusivo de até 12 meses. Sem `deputadoId`, serão
enfileirados os deputados cadastrados naquela legislatura:

```json
{
  "name": "camara/despesas.backfill",
  "data": {
    "legislaturaId": 57,
    "desde": "2025-01",
    "ate": "2025-12"
  }
}
```

Para processar um deputado específico, inclua seu ID:

```json
{
  "name": "camara/despesas.backfill",
  "data": {
    "legislaturaId": 57,
    "deputadoId": 218086,
    "desde": "2025-01",
    "ate": "2025-12"
  }
}
```

A identidade de uma despesa inclui número e data do documento, além dos
campos anteriores da chave. Datas ausentes são consideradas iguais para
fins de unicidade (`UNIQUE NULLS NOT DISTINCT`, PostgreSQL 15 ou superior).
Assim, documentos distintos com `codDocumento = "0"` e valores iguais podem
ser armazenados separadamente.

Se uma página ainda contiver conteúdos diferentes para a mesma chave, todas
as variantes desse grupo são preservadas em `despesa_conflicts`, com chave,
motivo e referência ao `raw_payloads`. As demais despesas da página são
persistidas e a paginação continua. A quarentena e as despesas válidas são
gravadas na mesma transação; falhas de banco continuam interrompendo a
execução para permitir retry. Conflitos entre variantes de uma mesma página
são isolados; atualizações de registros vindos de páginas diferentes mantêm
a semântica de upsert existente.

Os resultados por página/mês, os resumos do Inngest e os logs da CLI incluem
`conflicted`: quantidade de linhas de entrada em quarentena, incluindo
repetições. Esse contador não integra `unchanged`; portanto,
`fetched = written + unchanged + conflicted`. A quarentena deduplica por
payload de origem e hash do registro para permitir reexecuções.

Aplique a migration `0014_expense_document_identity_and_conflicts` com
`npm run db:migrate` antes de iniciar o worker atualizado. Para recuperar
meses interrompidos anteriormente, envie novamente o evento de backfill
para o deputado e período afetados. Os payloads brutos anteriores continuam
preservados; o backfill consulta novamente a API. A mudança da chave pode
manter versões adicionais quando número/data de documentos já persistidos
forem corrigidos pela fonte; não remove registros antigos automaticamente.

O evento coordenador informa quantos trabalhos foram enfileirados; cada
combinação deputado/mês roda como execução própria, com retries e
rastreabilidade. Se precisar de mais de 12 meses, divida a varredura em
intervalos menores.

Exemplo de evento para carregar partidos e enfileirar seus perfis:

```json
{
  "name": "camara/partidos.seed",
  "data": {
    "legislaturaId": 57
  }
}
```

O seed da lista emite um evento de perfil por partido. Para reenriquecer todos
os partidos já listados na base, envie o evento sem dados:

```json
{
  "name": "camara/partidos.perfil.seed",
  "data": {}
}
```

Também é possível solicitar um perfil individual:

```json
{
  "name": "camara/partidos.perfil.seed",
  "data": {
    "partidoId": 37906
  }
}
```

Os dados complementares da API ficam em `partido_detalhes`, separados da
identidade de referência em `partidos` e do vínculo temporal em
`partido_legislaturas`. A coluna `last_fetched_at` registra quando o perfil
foi consultado pela última vez, inclusive se os dados não mudaram; `updated_at`
indica quando o conteúdo persistido teve alteração.

Exemplo de evento para carregar lista e enfileirar os seeds de perfil:

```json
{
  "name": "camara/deputados.seed",
  "data": {
    "legislaturaId": 57
  }
}
```

O seed da lista emite automaticamente um evento por perfil. Para reenriquecer
todos os deputados já cadastrados, envie o evento sem dados:

```json
{
  "name": "camara/deputados.perfil.seed",
  "data": {}
}
```

Também é possível solicitar um perfil individual:

```json
{
  "name": "camara/deputados.perfil.seed",
  "data": {
    "deputadoId": 218086
  }
}
```

O perfil fica em `deputado_detalhes`, separado da identidade estável em
`deputados` e do vínculo temporal em `deputado_legislaturas`. O campo
`status_legislatura_id` identifica a legislatura do snapshot mais recente da
API. `last_fetched_at` registra toda consulta do perfil, mesmo quando os dados
não mudaram; `updated_at` só avança quando o conteúdo persistido muda. Para
atualizar os perfis de todos os deputados já cadastrados, envie
`camara/deputados.perfil.seed` com dados `{}`. Os payloads brutos são mantidos
para auditoria.

O seed anual pode ser repetido com segurança. A importação e a reconciliação
são etapas Inngest independentes para cada ano, limitando o trabalho de cada
execução anual. Para importar somente um ano, envie pelo painel do Inngest:

```json
{
  "name": "camara/bilhetes-aereos.seed",
  "data": {
    "ano": 2025
  }
}
```

Para a carga histórica completa, envie o mesmo evento com `data: {}`. O
Inngest baixa `Ano-2008.csv.zip` até `Ano-<ano-atual>.csv.zip` diretamente de
`https://www.camara.leg.br/cotas/`, extrai o CSV em streaming e grava os
candidatos em lotes no PostgreSQL; o ZIP/CSV não é persistido em disco.

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
