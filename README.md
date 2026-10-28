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

| Variável                 | Obrigatória                   | Padrão | Descrição                                                    |
| ------------------------ | ----------------------------- | ------ | ------------------------------------------------------------ |
| `DATABASE_URL`           | Sim                           | —      | Connection string PostgreSQL usada pela aplicação.           |
| `PORT`                   | Não                           | `8080` | Porta HTTP.                                                  |
| `CAMARA_MAX_CONCURRENT`  | Não                           | `2`    | Máximo de requisições simultâneas à API por instância.       |
| `CAMARA_MIN_INTERVAL_MS` | Não                           | `250`  | Intervalo mínimo entre inícios de requisições por instância. |
| `INNGEST_SIGNING_KEY`    | Em produção                   | —      | Chave de assinatura lida pelo SDK do Inngest.                |
| `INNGEST_EVENT_KEY`      | Conforme configuração Inngest | —      | Chave de eventos lida pelo SDK do Inngest.                   |

Use uma connection string PostgreSQL adequada ao ambiente. A configuração
recomendada para produção e os valores de exemplo estão em
[.envexample](./.envexample); não versione o arquivo `.env`.

## Comandos

| Comando                       | Descrição                                                    |
| ----------------------------- | ------------------------------------------------------------ |
| `npm run dev`                 | Executa a aplicação em modo watch.                           |
| `npm run crawler -- <módulo>` | Executa um crawler em dry-run por padrão; `--persist` grava. |
| `npm run build`               | Compila TypeScript para `dist/`.                             |
| `npm start`                   | Executa a versão compilada.                                  |
| `npm test`                    | Executa os testes Vitest.                                    |
| `npm run typecheck`           | Verifica os tipos sem emitir arquivos.                       |
| `npm run lint`                | Executa ESLint em `src/`.                                    |
| `npm run format:check`        | Verifica formatação com Prettier em `src/`.                  |
| `npm run check`               | Executa formatação, lint e verificação de tipos.             |

O schema Drizzle fica em `src/infrastructure/persistence/schema.ts` e as
migrations em `drizzle/`. `drizzle.config.ts` usa `DATABASE_URL_DIRECT` para
migrations quando disponível, com fallback para `DATABASE_URL`.

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

A listagem de deputados usa páginas de 250 itens, ordenadas por nome, e segue
o indicador `next` retornado pela API. Como a listagem pode repetir o mesmo
deputado em diferentes vínculos partidários, o crawler deduplica por ID e
consulta `/deputados/{id}/historico`. As mudanças são normalizadas em períodos
de vigência na tabela `deputado_partido_vigencias`.

Cada vínculo referencia o partido e a legislatura por uma FK composta, e o
deputado e sua legislatura por outra FK composta. Assim, mudanças partidárias
dentro do mandato são preservadas sem escolher arbitrariamente uma sigla da
listagem. As datas são armazenadas como horário local exatamente como fornecido
pela API. O payload de cada histórico permanece disponível para auditoria.
Registros anteriores à nova tabela são migrados com início desconhecido; a
próxima sincronização substitui esse vínculo aproximado pelas vigências da API.

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

No estado atual, somente legislaturas está conectada ao agendamento Inngest.
O crawler de deputados pode ser executado manualmente por legislatura; a
sincronização dos partidos necessários é executada como pré-requisito desse
crawler. Para cada deputado único, o módulo também consulta seu endpoint de
histórico partidário, portanto a execução completa faz mais requisições que a
listagem paginada. Despesas ainda precisam de um fluxo próprio.

O comando unificado aceita o módulo `legislaturas` ou `deputados`. O dry-run é
o padrão; `--persist` habilita gravação e `--dry-run` pode ser informado
explicitamente. Não combine os dois modos.

### Consultar e sincronizar legislaturas

```sh
npm run crawler -- legislaturas
npm run crawler -- legislaturas --legislatura=57 --dry-run
npm run crawler -- legislaturas --legislatura=57 --persist
```

O comando lê `.env` se existir e não exige `DATABASE_URL` no dry-run. Por
padrão, percorre até 50 páginas; `--pages` limita o número de páginas e
`--legislatura` filtra por um ID. Para gravar, informe `--persist` após aplicar
as migrations; uma connection string `DATABASE_URL` válida é necessária.

### Consultar e sincronizar deputados

O comando exige o ID da legislatura e, por padrão, funciona como dry-run:

```sh
npm run crawler -- deputados --legislatura=57
npm run crawler -- deputados --legislatura=57 --pages=2 --dry-run
npm run crawler -- deputados --legislatura=57 --persist
```

O dry-run consulta e valida as páginas sem gravar no banco. `--pages` limita
quantas páginas serão lidas (padrão: 50). Para persistir os dados e os payloads
brutos, use `--persist` após configurar PostgreSQL e aplicar as migrations:

```sh
npm run db:migrate
npm run crawler -- deputados --legislatura=57 --persist
```

Cada deputado único exige uma consulta adicional ao endpoint de histórico.
Durante essa etapa, o crawler informa quantos históricos serão consultados,
reporta o progresso a cada 25 respostas e identifica falhas com o ID do
deputado. A página só é reportada como concluída após validar todos os
históricos.

O crawler sincroniza automaticamente os dados de referência da legislatura e
os partidos antes de persistir os deputados. O processo é idempotente e pode
ser repetido: só altera registros normalizados quando os campos de negócio
mudam.

### Dry-run sem gravação

Sem `--persist`, os dois comandos consultam e validam a API, imprimem um
exemplo em JSON e reportam páginas e registros:

```sh
npm run crawler -- legislaturas --legislatura=57 --dry-run
npm run crawler -- deputados --legislatura=57 --pages=1 --dry-run
```

No modo dry-run, não é necessária `DATABASE_URL` e nada é gravado. Informe
`--persist` explicitamente somente após configurar PostgreSQL e aplicar as
migrations. Erros HTTP ou dados inválidos resultam em código de saída
diferente de zero. A rotina mensal do Inngest continua persistindo
legislaturas automaticamente, independentemente destes comandos manuais.
