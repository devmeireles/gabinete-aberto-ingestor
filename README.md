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

Legislaturas e despesas estão conectadas ao agendamento Inngest. O crawler de
deputados pode ser executado manualmente por legislatura; a sincronização dos
partidos necessários é executada como pré-requisito desse crawler. Para cada
deputado único, o módulo também consulta seu endpoint de histórico partidário,
portanto a execução completa faz mais requisições que a listagem paginada.

O comando unificado aceita `legislaturas`, `deputados`, `despesas` ou
`bilhetes-csv`. Para os crawlers da API, o dry-run é o padrão; `--persist`
habilita gravação e `--dry-run` pode ser informado explicitamente. Não combine
os dois modos.

### Referência completa da CLI

Formato geral:

```sh
npm run crawler -- <módulo> [argumentos]
```

Argumentos que recebem valor aceitam tanto `--opção=valor` como
`--opção valor`. O modo padrão é sempre dry-run; `--persist` é necessário
para gravar. `--dry-run` pode ser informado explicitamente, mas não pode ser
combinado com `--persist`.

| Módulo         | Argumento                                | Obrigatório | Padrão / comportamento                                                                                                    |
| -------------- | ---------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `legislaturas` | `--legislatura=<id>`                     | Não         | Sem filtro, percorre todas as legislaturas; com ID positivo, busca somente essa legislatura.                              |
| `legislaturas` | `--pages=<n>`                            | Não         | Limite de páginas entre 1 e 50; padrão: 50.                                                                               |
| `legislaturas` | `--dry-run`                              | Não         | Modo padrão: consulta e valida sem gravar; pode ser escrito explicitamente.                                               |
| `legislaturas` | `--persist`                              | Não         | Persiste payload bruto e legislaturas; exige `DATABASE_URL` e migrations aplicadas.                                       |
| `deputados`    | `--legislatura=<id>`                     | Sim         | ID inteiro positivo da legislatura a consultar.                                                                           |
| `deputados`    | `--pages=<n>`                            | Não         | Limite de páginas entre 1 e 50; padrão: 50.                                                                               |
| `deputados`    | `--dry-run`                              | Não         | Modo padrão: consulta e valida deputados, partidos e históricos sem gravar.                                               |
| `deputados`    | `--persist`                              | Não         | Persiste payloads e dados relacionados; exige `DATABASE_URL` e migrations aplicadas.                                      |
| `despesas`     | `--legislatura=<id>`                     | Sim         | ID inteiro positivo da legislatura.                                                                                       |
| `despesas`     | `--deputado=<id>`                        | No dry-run  | Restringe a consulta a um deputado. No modo persistente, se omitido, usa os deputados cadastrados na legislatura.         |
| `despesas`     | `--ano=<AAAA>` e `--mes=<MM>`            | Não         | Devem ser informados juntos; limitam a consulta a um mês específico. Não combinar com `--desde`/`--ate`.                  |
| `despesas`     | `--desde=<AAAA-MM>` e `--ate=<AAAA-MM>`  | Não         | Devem ser informados juntos; intervalo inclusivo para backfill histórico, máximo de 120 meses.                            |
| `despesas`     | Sem `--ano`/`--mes` ou `--desde`/`--ate` | Não         | Usa o mês corrente e os dois meses anteriores.                                                                            |
| `despesas`     | `--pages=<n>`                            | Não         | Limite de páginas por período entre 1 e 500; padrão: 500.                                                                 |
| `despesas`     | `--dry-run`                              | Não         | Modo padrão: consulta e valida sem gravar; exige `--deputado` para limitar as chamadas.                                   |
| `despesas`     | `--persist`                              | Não         | Persiste despesas; se `--deputado` for omitido, exige deputados previamente sincronizados para a legislatura.             |
| `bilhetes-csv` | `--arquivo=<caminho>`                    | Sim         | Caminho para o CSV oficial; o arquivo é processado em streaming.                                                          |
| `bilhetes-csv` | `--dry-run`                              | Não         | Modo padrão: valida o CSV, conta registros e candidatos e mostra uma amostra JSON, sem conexão ou gravação no PostgreSQL. |
| `bilhetes-csv` | `--persist`                              | Não         | Importa candidatos em lotes e tenta enriquecer despesas existentes; exige `DATABASE_URL` e migrations aplicadas.          |

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

### Consultar e sincronizar despesas

Uma despesa é ligada ao deputado e à legislatura; seu tipo e fornecedor são
normalizados em tabelas próprias. O fornecedor é identificado pela combinação
de nome e CNPJ/CPF normalizado. Os valores monetários usam `numeric(14,2)` e
aceitam valores negativos, como ajustes de passagens.

O crawler consulta as despesas por deputado, legislatura, ano e mês, com 100
itens por página, ordenação decrescente por ano e paginação pelos links da API.
O agendamento semanal, aos domingos às 03h no horário de Brasília, atualiza o
mês corrente e os dois meses anteriores. A rotina obtém os deputados já
sincronizados para a legislatura vigente; sincronize os deputados antes da
primeira execução automática.

```sh
# Conferir uma página sem gravar
npm run crawler -- despesas --legislatura=57 --deputado=218086 --ano=2025 --mes=4 --pages=1 --dry-run

# Sincronizar os três meses mais recentes de todos os deputados já cadastrados
npm run crawler -- despesas --legislatura=57 --persist

# Backfill histórico explícito, por mês e com upsert idempotente
npm run crawler -- despesas --legislatura=57 --desde=2023-02 --ate=2026-10 --persist
```

O dry-run exige `--deputado` para limitar as chamadas. `--desde`/`--ate`
incluem os meses inicial e final. A carga histórica usa a mesma paginação,
rate limit e upsert; se interrompida, pode ser repetida sem duplicar despesas.
O limite de páginas por período é configurável por `--pages` (máximo 500);
verifique `truncated` no evento de conclusão se informar um limite menor.

### Enriquecer passagens aéreas com CSV

O CSV anual oficial fornece passageiro e trecho, ausentes da API. Importe-o
com o módulo próprio `bilhetes-csv`; ele não faz chamadas à API. O arquivo é
lido em streaming, apenas linhas do tipo `PASSAGEM AÉREA - SIGEPA` são
mantidas e as inserções são feitas em lotes:

```sh
# Validar o arquivo e visualizar uma amostra sem conectar ao banco
npm run crawler -- bilhetes-csv --arquivo=assets/Ano-2025.csv --dry-run

# Importar candidatos e tentar enriquecer despesas persistidas
npm run crawler -- bilhetes-csv --arquivo=assets/Ano-2025.csv --persist
```

O dry-run é o padrão, então `--dry-run` pode ser omitido. Ele lê o arquivo
inteiro em streaming para detectar erros e contabilizar candidatos, mas não
acessa nem grava no PostgreSQL.

O importador grava candidatos em `bilhetes_aereos_csv` e reconcilia os que
correspondem a despesas já existentes. Se o CSV for carregado antes, a
sincronização posterior da API consulta esses candidatos no banco ao fazer
upsert. Assim, os dois fluxos são independentes da ordem; o agendamento
semanal não precisa ter o arquivo CSV disponível no ambiente de execução.

A associação não usa apenas `codDocumento`, que pode aparecer em várias
ocorrências. A reconciliação exige deputado, legislatura, ano/mês, tipo de
despesa, código e tipo de documento, data, número, parcela, lote e valor exato
em centavos; CNPJ/CPF normalizado também é comparado quando fornecido. Assim,
o documento `302323` é desambiguado por sua ocorrência de abril de 2025 e pelo
valor `-391.23`. Se várias linhas concordarem com os campos-chave mas
discordarem em passageiro/trecho, nenhum candidato é escolhido
automaticamente, os campos de trecho ficam vazios e a despesa é marcada como
ambígua no resumo.

### Dry-run sem gravação

Sem `--persist`, os módulos da API consultam e validam os dados, imprimem
amostras JSON quando aplicável e reportam páginas e registros. O módulo CSV
valida o arquivo e mostra uma amostra, sem acessar o banco:

```sh
npm run crawler -- legislaturas --legislatura=57 --dry-run
npm run crawler -- deputados --legislatura=57 --pages=1 --dry-run
npm run crawler -- despesas --legislatura=57 --deputado=218086 --ano=2025 --mes=4 --pages=1 --dry-run
npm run crawler -- bilhetes-csv --arquivo=assets/Ano-2025.csv --dry-run
```

No modo dry-run, não é necessária `DATABASE_URL` e nada é gravado. Informe
`--persist` explicitamente somente após configurar PostgreSQL e aplicar as
migrations. Erros HTTP, CSV inválido ou dados inválidos resultam em código de
saída diferente de zero. A rotina mensal do Inngest continua persistindo
legislaturas automaticamente, independentemente destes comandos manuais.
