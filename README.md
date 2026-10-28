# Ingestor de dados abertos da Câmara dos Deputados

Aplicação TypeScript que consulta a API de dados abertos da Câmara, preserva
os payloads recebidos e grava os dados normalizados em PostgreSQL.

## Requisitos

- Node.js 22.12 ou superior
- npm
- PostgreSQL
- Conta/configuração do Inngest para executar as sincronizações agendadas

## Desenvolvimento

```sh
npm install
cp .envexample .env
npm run dev
```

O serviço inicia na porta `8080` por padrão. `GET /healthz` responde à
verificação de disponibilidade; `/api/inngest` expõe o endpoint do Inngest.

| Variável | Obrigatória | Padrão | Descrição |
| --- | --- | --- | --- |
| `DATABASE_URL` | Sim | — | Connection string PostgreSQL usada pela aplicação. |
| `PORT` | Não | `8080` | Porta HTTP. |
| `CAMARA_MAX_CONCURRENT` | Não | `2` | Máximo de requisições simultâneas à API por instância. |
| `CAMARA_MIN_INTERVAL_MS` | Não | `250` | Intervalo mínimo entre inícios de requisições por instância. |
| `INNGEST_SIGNING_KEY` | Em produção | — | Chave de assinatura lida pelo SDK do Inngest. |
| `INNGEST_EVENT_KEY` | Conforme configuração Inngest | — | Chave de eventos lida pelo SDK do Inngest. |

Use uma connection string PostgreSQL adequada ao ambiente. A configuração
recomendada para produção e os valores de exemplo estão em
[.envexample](./.envexample); não versione o arquivo `.env`.

## Comandos

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Executa a aplicação em modo watch. |
| `npm run crawler:dry-run` | Consulta e valida legislaturas sem persistir dados. |
| `npm run build` | Compila TypeScript para `dist/`. |
| `npm start` | Executa a versão compilada. |
| `npm test` | Executa os testes Vitest. |
| `npm run typecheck` | Verifica os tipos sem emitir arquivos. |
| `npm run lint` | Executa ESLint em `src/`. |
| `npm run format:check` | Verifica formatação com Prettier em `src/`. |
| `npm run check` | Executa formatação, lint e verificação de tipos. |

O schema Drizzle fica em `src/infrastructure/persistence/schema.ts` e a
migração SQL inicial está em `drizzle/`.

## Arquitetura

```text
src/
  application/
    ports/                 Contratos de gateways e persistência
      camara-gateway/       Contratos da API separados por recurso
    use-cases/              Regras e orquestração da sincronização
  config/                   Leitura e validação de ambiente
  domain/
    model/                  Modelos de domínio independentes de I/O
  infrastructure/
    camara/                 Cliente HTTP, política de retry e adaptadores
    http/                   Endpoint de health check e integração Inngest
    inngest/                Cliente e funções agendadas
    persistence/            Drizzle, schema e implementações PostgreSQL
  shared/                   Utilitários compartilhados
```

As dependências apontam para dentro: casos de uso dependem de portas e modelos
do domínio; infraestrutura implementa essas portas. `src/main.ts` é o
composition root que instancia as implementações concretas e conecta as
camadas.

O contrato da API da Câmara está dividido em portas por recurso
(`legislaturas`, `partidos`, `deputados` e `despesas`), para cada caso de uso
depender somente do que utiliza. `HttpCamaraGateway` implementa essas portas
com o cliente HTTP compartilhado.

## Fluxo e confiabilidade da ingestão

1. A função Inngest agenda a sincronização de legislaturas no primeiro dia de
   cada mês, às 03h no horário de Brasília, e processa uma página por etapa.
2. O gateway segue o link `next` informado pela API, usa ordenação estável e
   registra a chave canônica da requisição junto do payload.
3. O cliente HTTP aplica timeout, retry com backoff e respeita `Retry-After`;
   o scheduler limita a concorrência e a taxa local por instância.
4. O caso de uso persiste o payload bruto antes de validar e normalizar os
   registros.
5. O repositório Drizzle faz upsert idempotente por identificador e hash,
   vinculando cada registro normalizado ao payload de origem.

A persistência do payload bruto permite auditoria e reprocessamento. A
concorrência local é complementada pelo limite configurado no Inngest para
controlar a pressão global sobre a API.

No estado atual, somente a sincronização de legislaturas está conectada ao
agendamento e à persistência normalizada. Os contratos para os demais recursos
já estão definidos, mas suas rotinas completas ainda precisam ser
implementadas e conectadas.

### Testar o crawler sem gravar no banco

Execute o dry-run contra a API aberta da Câmara:

```sh
npm run crawler:dry-run
npm run crawler:dry-run -- --pages=3
npm run crawler:dry-run -- --legislatura=57
npm run crawler:dry-run -- --legislatura=57 --pages=3
```

O comando lê `.env` se existir, mas não exige `DATABASE_URL`, não inicia o
servidor/Inngest e não grava payloads nem dados normalizados. Por padrão,
consulta uma página; `--pages` define o máximo (de 1 a 50). `--legislatura`
filtra por um ID específico da API, por exemplo `57` ou futuramente `58`.
O resultado informa as páginas lidas, os registros validados, a chave da
requisição e se a leitura foi truncada por atingir o limite. Uma resposta HTTP
inválida ou um registro fora do formato esperado encerra o comando com código
diferente de zero. O comando imprime a entidade da legislatura e o objeto
recebido da API em JSON formatado.

Esse teste exercita a comunicação real com a API, a paginação e a validação de
legislaturas, mas não testa persistência PostgreSQL nem o agendamento do
Inngest. Para testar gravação, use um PostgreSQL de desenvolvimento e execute a
sincronização normal após aplicar as migrations.
