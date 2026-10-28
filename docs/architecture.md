# Arquitetura

## Componentes

| Componente | Responsabilidade | Persistência |
|---|---|---|
| React + TypeScript + Vite | Catálogo, carrinho e áreas de aluno/professor/admin | Sem tokens OIDC no browser |
| Node.js HTTP | Serve a interface, API e BFF de autenticação | SQLite em volume local |
| Keycloak | Cadastro, login, senha, e-mail e perfis | PostgreSQL exclusivo da identidade |
| Stripe sandbox | Checkout hospedado e confirmação de pagamento de teste | Recursos da conta sandbox do operador |
| Mailpit | Captura e visualiza e-mails locais | Volume próprio |
| Stripe CLI | Encaminha eventos da sandbox ao webhook local | Segredo de assinatura em arquivo local |

A aplicação serve UI e API na mesma origem. O PostgreSQL não armazena os pedidos: ele pertence ao Keycloak. SQLite guarda sessões, usuários sincronizados, carrinho, pedidos, tentativas de checkout, eventos, dados acadêmicos e outbox.

## Identidade e autorização

O browser inicia o fluxo no BFF; o Keycloak autentica o usuário. O callback troca o code por tokens com PKCE e valida assinatura, issuer, audience, nonce e expiração. A chave estável da identidade combina issuer e subject. O servidor permite apenas os perfis `aluno`, `professor` e `admin` e aplica controles de propriedade em cada recurso.

A sessão é rotacionada após login e expira no máximo junto com os tokens OIDC. A configuração usual do Keycloak resulta em uma sessão curta, aproximadamente cinco minutos; não há refresh automático. O logout invalida a sessão local e usa um ticket temporário de uso único para completar o logout no provedor.

## Compra e matrícula

1. O aluno escolhe cursos e turmas publicadas. O servidor valida preço, versão, capacidade e conflitos.
2. Um pedido pendente reserva as vagas e preserva o snapshot acadêmico da compra.
3. O servidor cria ou retoma uma sessão de Checkout em sandbox usando idempotência.
4. O browser navega ao domínio HTTPS do Stripe. Os dados de cartão são enviados diretamente ao provedor.
5. Webhook assinado ou reconciliação consultam a sessão no Stripe. Somente uma sessão paga, com vínculo, moeda, valor e modo esperados, pode liquidar o pedido.
6. Pedido, matrícula e mensagens da outbox são atualizados transacionalmente. O evento/pagamento é deduplicado.

Cancelar um pedido que já abriu checkout exige consultar e, quando aplicável, expirar a sessão no provedor; uma corrida ganha pelo pagamento resulta na confirmação, não em cancelamento fictício. O retorno do browser não constitui prova de pagamento.

## Domínio acadêmico

Turmas podem ser EAD ou presenciais. Encontros têm professor, sala, início e fim. A publicação verifica sobreposição e capacidade; a inscrição verifica conflitos do aluno. Professores registram notas, presença, comentários e módulos concluídos somente nas turmas atribuídas. O administrador configura critérios opcionais de conclusão.

A elegibilidade de certificado depende da matrícula paga de teste, conclusão registrada, módulos concluídos e regras configuradas. O PDF atual é demonstrativo e genérico, sem a composição de um certificado institucional personalizado. Verificação pública retorna validade e rótulo, sem dados pessoais do aluno.

## E-mails e operação

Keycloak envia verificação e recuperação diretamente ao SMTP local. A aplicação usa uma outbox com chave única por evento/agregado/versão e worker periódico. Há até cinco tentativas; falhas terminais precisam de intervenção. O envio SMTP pode se repetir após uma interrupção entre envio e gravação do sucesso: a semântica não é exatamente uma vez.

Locks e rate limits estão em memória, adequados ao processo único desta demonstração. Não há suporte estabelecido para múltiplas réplicas. As imagens e fontes são locais, e o chatbot aplica regras determinísticas ao catálogo sem acesso a dados privados ou ferramentas externas.
