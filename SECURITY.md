# Política de segurança

Este software é uma demonstração local. A branch `main` recebe correções; não há versões com suporte de longo prazo ou compromisso de prazo de resposta. A publicação pública não é uma certificação de segurança, LGPD ou PCI DSS.

## Reportar uma vulnerabilidade

Use [Report a vulnerability](https://github.com/weauratech/uniesp-marketplace/security/advisories/new) para um relato privado aos mantenedores. Informe componente, revisão afetada, pré-condições, passos mínimos de reprodução com dados sintéticos e impacto observado. Não inclua senhas, tokens, dados pessoais ou dados de cartão.

Não publique detalhes exploráveis em issues abertas antes da análise. Se o canal privado estiver indisponível, abra uma issue apenas solicitando um canal privado, sem divulgar a vulnerabilidade. Não realize testes contra serviços ou contas de terceiros.

## Controles implementados

- OIDC com PKCE, validação de tokens e sessão BFF com cookie HttpOnly/SameSite.
- CSRF e verificação de origem nas mutações; limites de tamanho e frequência de requisições.
- Autorização por perfil e vínculo com cada registro no servidor; provisionamento de contas privilegiadas por ID registrado, sem adotar identidades preexistentes por e-mail.
- Checkout hospedado, exclusivamente Stripe sandbox; validação de assinatura, sessão, pedido, moeda e valor; deduplicação de eventos.
- Secrets locais fora do Git, permissões restritas nos arquivos gerados, container da aplicação sem root e portas Docker em loopback.
- Cabeçalhos de proteção e CSP; dependências registradas em lockfiles.

Esses controles têm limites. O armazenamento SQLite contém dados de sessão, identidade e pedidos; é responsabilidade do operador proteger o host e backups. O limite de requisições e locks são locais ao processo. O Mailpit captura mensagens sem autenticação na interface local. O SMTP local não usa TLS. Revogação de roles depende da renovação da identidade por login; não há refresh de sessão implementado.

## Uso seguro da demonstração

Use contas e cartões de teste. Não reutilize credenciais de produção. Não exponha portas locais por túneis ou proxy público sem revisar autenticação, TLS e isolamento. Não publique `data/`, `.env*`, bancos, backups ou captures autenticadas. Em caso de exposição de segredo, revogue-o no provedor e gere outro; apagá-lo do último commit não remove o histórico.

As tarefas necessárias para um ambiente comercial estão em [Preparação para produção](docs/production-readiness.md). Não desative validações, assinatura de webhook ou verificação de e-mail para contornar uma falha de integração.
