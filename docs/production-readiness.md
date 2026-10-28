# Preparação para produção

O repositório é um ambiente local de aprendizado. Esta lista registra trabalho necessário antes de qualquer oferta comercial; itens listados não representam controles já implantados nem homologação.

## Bloqueadores de uso comercial

- Definir responsável institucional, autorização de uso da marca/imagens, termos de oferta, conteúdo dos cursos e validade dos certificados. Os conteúdos e critérios atuais são demonstrativos.
- Projetar a operação com HTTPS público, proxy confiável, cookies seguros, domínio OIDC e redirects exatos. Desabilitar a configuração de identidade que permite HTTP local e isolar interfaces administrativas.
- Definir fluxos de recuperação, MFA para perfis privilegiados, revogação de acessos e renovação de sessão. Testar desligamento de usuário e alteração de perfil; o BFF atual não renova tokens.
- Substituir a configuração exclusiva de Stripe sandbox somente após projeto e revisão específicos para produção. Não basta mudar uma chave: o código rejeita operações live intencionalmente.
- Implementar e testar reembolso, contestação, cancelamento comercial, reserva expirada, pagamentos assíncronos e atendimento. Documentar estados e reconciliação operacional.
- Definir backup criptografado, restauração comprovada, retenção e descarte. O SQLite contém dados pessoais e tokens de sessão; o host e seus volumes precisam de proteção própria.
- Definir estratégia para concorrência, múltiplas instâncias e migrações. Locks e rate limits em memória e a persistência local não constituem uma arquitetura distribuída.
- Substituir Mailpit por SMTP transacional autenticado com TLS, configurar domínio e políticas de envio, monitorar falhas da outbox e fornecer reprocessamento controlado.
- Estabelecer finalidade e base legal do tratamento de dados, avisos de privacidade, direitos dos titulares, controle de acesso e resposta a incidentes com os responsáveis competentes. Este código não comprova conformidade com LGPD ou PCI DSS.

## Verificações antes de expor um ambiente

- Revisão de ameaças e testes independentes de autenticação, autorização por objeto, CSRF, sessão, abuso, entradas e cabeçalhos.
- Teste completo de webhook: assinatura inválida, evento repetido, ordem invertida, valor/moeda divergentes, indisponibilidade e replay após recuperação. Uma confirmação por consulta ao Stripe não prova entrega do webhook.
- Auditoria de dependências e imagens, correção dos achados aplicáveis e processo de atualização contínuo.
- Observabilidade com logs sanitizados, métricas, alertas e trilha de ações privilegiadas, sem credenciais ou dados de pagamento.
- Testes de carga, acessibilidade, navegadores, jornadas de erro e recuperação de desastres.
- Procedimentos de rollback, migração, gestão de segredos, incidentes e acesso temporário de operadores.
- Revisão do PDF de certificado, política acadêmica, assinaturas e validação antes de qualquer emissão oficial.

As verificações automatizadas da CI reduzem riscos conhecidos, mas não substituem essas decisões e evidências operacionais. Mantenha um registro explícito de responsáveis, resultados e pendências antes da liberação.
