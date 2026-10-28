# Orientações para agentes e colaboradores

Este repositório contém uma demonstração local de marketplace educacional. Leia `README.md`, `SECURITY.md` e `docs/architecture.md` antes de alterar comportamentos. Use pt-BR em documentação e mensagens de produto. Preserve alterações de outros colaboradores e mantenha tarefas independentes com ownership explícito quando delegar trabalho.

## Escopo e dados

- Trabalhe somente com dados sintéticos. Não importe alunos, documentos, pagamentos ou credenciais reais.
- Nunca registre segredos em código, saída de comandos, logs, testes, screenshots, issues ou commits. `data/`, arquivos `.env` e bancos locais não são entregáveis.
- Não acesse produção, publique serviços, altere permissões externas ou faça cobranças reais como consequência de uma tarefa local.
- Não altere proteções de segurança para fazer um teste passar. Relate o bloqueio e corrija a causa.
- O provisionamento de privilégios usa IDs de recursos criados e um registro local protegido. Nunca adote uma conta preexistente apenas por e-mail, nem contorne divergências desse registro.
- A configuração Docker é local. Não exponha Keycloak, Mailpit ou bancos à rede pública.

## Invariantes de implementação

- Autenticação usa Authorization Code OIDC com PKCE S256, state/nonce de uso único, validação de assinatura, issuer, audience e expiração. Tokens ficam no servidor; não introduza armazenamento de tokens no navegador.
- Autorização pertence ao servidor. Alunos acessam apenas seus registros; professores, apenas turmas atribuídas; privilégios não podem vir de campos enviados pelo cliente.
- Mutações autenticadas exigem controles de origem e CSRF. Preserve cookies HttpOnly/SameSite e Secure quando o origin for HTTPS.
- Preços, moeda, disponibilidade, vínculos e identidade do aluno são resolvidos no servidor.
- Stripe é exclusivamente de teste. Preserve validação de `livemode`, assinatura de webhook, consulta ao provedor, metadados e deduplicação. A URL de retorno nunca aprova um pedido sozinha.
- Pedidos, reservas, matrículas e outbox devem manter consistência transacional e tolerar repetição. Considere corrida entre pagamento e cancelamento.
- Preserve a validação de conflitos de horários, capacidade e versão de turma. Mudanças em critérios acadêmicos exigem testes de elegibilidade.
- Escape conteúdo não confiável; não use HTML arbitrário no chatbot ou comentários. O assistente atual responde a partir de catálogo, sem LLM.
- Certificados e turmas são demonstrativos. Não atribua validade oficial, regras acadêmicas ou endosso institucional sem fonte e autorização.

## Mudanças e validação

Use dependências fixadas pelos lockfiles e `npm ci`. Antes de concluir alterações relevantes, execute:

```sh
npm ci
npm --prefix web ci
npm test
npm run build
```

Adicione testes de comportamento para mudanças em autenticação, autorização, pagamentos, concorrência e domínio acadêmico. Para mudanças visuais, confira desktop/mobile, navegação por teclado, foco, carregamento e mensagens de erro. Não declare validada uma integração externa com base apenas em mocks.

Antes de publicar, revise `git diff`, nomes dos arquivos preparados e resultados dos verificadores de segredos e dependências configurados no repositório. Nunca suprima alertas sem uma justificativa específica, revisável e limitada. Preserve ações de CI com permissões mínimas e versões imutáveis quando configuradas.

Mantenha contratos e documentação alinhados ao código. Não inclua artefatos internos de agentes, transcrições ou caminhos pessoais. Ao entregar, descreva o comportamento, verificações executadas e limites conhecidos; não declare conformidade ou prontidão para produção sem evidência correspondente.
