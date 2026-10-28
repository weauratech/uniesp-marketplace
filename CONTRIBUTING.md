# Como contribuir

Antes de começar, leia [AGENTS.md](AGENTS.md), [SECURITY.md](SECURITY.md) e a arquitetura. Use issues para propostas e bugs sem informações sensíveis. Vulnerabilidades devem seguir o canal privado descrito na política de segurança.

1. Crie uma branch descritiva a partir de `main`.
2. Faça uma alteração de escopo claro, preservando trabalho existente.
3. Atualize testes de comportamento e documentação quando o contrato mudar.
4. Execute `npm ci`, `npm --prefix web ci`, `npm test` e `npm run build`, além dos scanners configurados na CI.
5. Revise o diff e os arquivos preparados. Exclua bancos, tokens, credenciais, dados reais e artefatos locais.
6. Abra um pull request descrevendo o problema, comportamento resultante, validação e limitações.

Prefira Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Não faça mudanças automáticas em todos os arquivos apenas para formatar uma alteração pequena.

Para mudanças de interface, preserve a direção institucional, contraste, foco de teclado, comportamento responsivo e estados de carregamento/erro. Não inclua fotografias, logos ou outros ativos sem direito de redistribuição e atribuição documentada. Os placeholders da versão pública devem continuar claramente identificados.

Para mudanças em segurança ou pagamento, inclua cenários de acesso negado, repetição e falha do provedor. Um teste com mocks não substitui a validação da integração sandbox; informe exatamente o que foi executado. Nunca utilize dados reais de cartão no aplicativo ou nos testes.
