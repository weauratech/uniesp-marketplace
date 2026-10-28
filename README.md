# UNIESP Marketplace

Demonstração educacional de um marketplace de cursos livres, mantida pela Aura Tech. Inclui catálogo, grade curricular demonstrativa, área do aluno, agenda de turmas presenciais, registros do professor e checkout hospedado no Stripe em ambiente de teste.

Este projeto não é um canal oficial de matrículas do UNIESP. Preços e conteúdos de referência não constituem oferta comercial. Certificados emitidos pelo aplicativo são demonstrações, sem validade institucional. A publicação do código não representa aprovação para uso em produção.

## Funcionalidades

- Cadastro, verificação de e-mail, login e recuperação de senha com Keycloak.
- Perfis de aluno, professor e administrador, com autorização no servidor.
- Catálogo, carrinho, seleção de turma e pedidos vinculados ao aluno autenticado.
- Checkout Stripe exclusivamente em sandbox; confirmação no servidor por webhook assinado ou consulta à API do provedor.
- Agenda com validação de sobreposição de sala, professor e encontros do aluno.
- Notas, presença, comentários, progresso da grade e certificados demonstrativos.
- Assistente de dúvidas determinístico, baseado no catálogo; não utiliza um modelo de linguagem.
- E-mails locais capturados pelo Mailpit.

A identidade usa vermelho institucional e fontes locais Montserrat e Source Sans Pro. Imagens sem licença de redistribuição identificada são substituídas por placeholders na versão pública. As marcas não são cedidas por este repositório.

## Executar localmente

Requisitos: Node.js 22.13 ou superior compatível com `node:sqlite`, npm, Docker Engine com Compose v2, shell POSIX e acesso à internet para baixar dependências e imagens. O preflight exige 10 GiB livres na primeira instalação das imagens de infraestrutura, ou 3 GiB quando já estão presentes. Não remove imagens ou volumes automaticamente.

```sh
git clone https://github.com/weauratech/uniesp-marketplace.git
cd uniesp-marketplace
sh scripts/start-local.sh
```

O script gera credenciais aleatórias em arquivos locais ignorados pelo Git, prepara a infraestrutura de identidade, configura o cliente OIDC e constrói a aplicação. Na primeira execução, o Keycloak pode levar alguns minutos para ficar disponível.

| Serviço | Endereço local |
|---|---|
| Marketplace | http://127.0.0.1:5177 |
| Keycloak | http://127.0.0.1:8088 |
| Mailpit | http://127.0.0.1:8025 |

Use `127.0.0.1` consistentemente: as URLs OIDC e de retorno estão configuradas com esse host. As portas publicadas estão vinculadas ao loopback. O PostgreSQL da identidade não publica porta no host. Os dados da aplicação, identidade e e-mails persistem em volumes Docker separados.

### Contas e turmas

O cadastro pode ser iniciado na Área do aluno. Leia o e-mail de verificação no Mailpit e siga as ações exigidas pelo Keycloak. O administrador local da aplicação é `admin@uniesp.local`; sua senha aleatória fica em `data/secrets/marketplace-admin-password`. O bootstrap da identidade usa a conta distinta `bootstrap-admin`, com senha em `data/secrets/keycloak-admin-password`.

Opcionalmente, depois da infraestrutura configurada:

```sh
node scripts/setup-identity.mjs --demo-accounts
```

Isso cria contas sintéticas de aluno, professor e administrador. As credenciais ficam apenas em `data/secrets/demo-accounts.json`, com permissão `0600`. Abra esse arquivo localmente para consultar; não o copie para issues, logs, commits ou capturas públicas. Não há senha compartilhada no código.

O provisionador registra os IDs das identidades que criou em `data/secrets/provisioned-identities.json`, com permissão `0600`. Ele recusa conceder privilégios a uma conta preexistente encontrada apenas pelo e-mail. Preserve esse registro junto do ambiente local: se ele for perdido ou não corresponder ao Keycloak, o setup interrompe a execução e exige recuperação manual da identidade. Não contorne a proteção apagando contas ou volumes automaticamente.

Um banco novo contém o catálogo, mas não os pedidos, alunos ou turmas do ambiente de demonstração original. Entre como professor ao menos uma vez para sincronizar sua identidade com a aplicação. Depois, como administrador, use **Administrar agenda** para criar turmas, atribuir professores e publicá-las. Defina critérios acadêmicos explicitamente; eles não representam regras oficiais do UNIESP.

### Checkout de teste no Stripe

Sem configuração do Stripe, o aplicativo inicia em modo de simulação local. A simulação não comprova pagamento nem equivale à matrícula resultante do fluxo Stripe.

1. Instale a CLI oficial do Stripe e use uma conta sandbox própria.
2. Grave a chave secreta de teste em `data/secrets/stripe-secret-key`, com permissão `0600`. Nunca use uma chave live. Conceda somente as permissões necessárias para criar, consultar e expirar sessões de Checkout; uma chave restrita usada pela CLI também precisa permitir sua operação.
3. Em um terminal separado, execute o listener e mantenha-o ativo:

   ```sh
   node scripts/stripe-listener.mjs
   ```

4. Quando estiver pronto, o listener grava a assinatura local em `data/secrets/stripe-webhook-secret`. Em outro terminal, habilite a aplicação com o override:

   ```sh
   docker compose -f compose.yaml -f compose.local.yaml -f compose.stripe.yaml --env-file .env.infra up -d --build uniesp-marketplace
   ```

5. Faça login como aluno com e-mail verificado, adicione um curso, escolha uma turma e prossiga ao checkout. Para pedidos pendentes, use **Área do aluno → Pedidos → Continuar pagamento no Stripe**.

Use somente os dados de teste publicados na [documentação do Stripe](https://docs.stripe.com/testing). O aplicativo não recebe o número do cartão. O retorno ao site não aprova um pedido por si só: o servidor consulta o Stripe e valida a sessão. Se o segredo do listener mudar, recrie o container da aplicação para carregar a nova configuração.

## Desenvolvimento e verificações

```sh
npm ci
npm --prefix web ci
npm test
npm run build
```

Os testes de unidade e integração usam banco isolado e fixtures. Eles não comprovam uma transação real com Stripe ou uma jornada no Keycloak. O roteiro `tests/v2-e2e.cjs` usa Playwright e exige os serviços locais, contas demonstrativas, uma turma presencial publicada e uma turma EAD disponível. Prepare o navegador com `npx playwright install chromium` e execute `node tests/v2-e2e.cjs` somente nesse ambiente sintético. Esse roteiro altera dados locais de teste e não é executado na CI offline.

Para encerrar os serviços preservando os dados:

```sh
docker compose --env-file .env.infra stop
```

Não use `down -v` a menos que queira apagar explicitamente os volumes locais.

## Estrutura e documentação

- `server/`: API Node.js, autenticação, pagamentos, domínio acadêmico e outbox de e-mail.
- `web/`: interface React/TypeScript e ativos públicos.
- `scripts/`: preparação e configuração do ambiente local.
- `tests/`: verificações automatizadas.
- [Arquitetura](docs/architecture.md), [preparação para produção](docs/production-readiness.md), [segurança](SECURITY.md), [contribuição](CONTRIBUTING.md) e [orientações para agentes](AGENTS.md).

O código está disponível sob a [licença MIT](LICENSE). As fontes mantêm suas licenças próprias em `web/public/assets/licenses/`. Nenhuma licença de código autoriza o uso de marcas, fotografias ou identidade institucional de terceiros.
