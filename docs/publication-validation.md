# Verificações da publicação inicial

Verificação local em 28/10/2026, em exportação independente com histórico Git novo:

- 24 testes automatizados passaram, incluindo autenticação/autorização, assinatura e replay de pagamentos, agenda e colisão de identidades no bootstrap.
- TypeScript e build Vite passaram.
- npm audit na raiz e em web: nenhuma vulnerabilidade conhecida reportada, incluindo dependências de desenvolvimento.
- Gitleaks 8.30.1: nenhuma credencial detectada nos arquivos preparados.
- Trivy 0.69.3: nenhuma vulnerabilidade HIGH/CRITICAL em dependências de produção nem configuração HIGH/CRITICAL nos dois Dockerfiles. Esta varredura de filesystem não inspecionou camadas das imagens de terceiros. Uma regra AWS CloudFront foi ignorada pelo scanner por exigir versão mais recente; não há configuração AWS neste projeto.
- Verificador de publicação bloqueia runtime, caminhos pessoais e padrões conhecidos de credenciais nos arquivos rastreados. É complementar, não substitui scanner de segredos.

Não é pentest, certificação de conformidade nem garantia de ausência de vulnerabilidades. As integrações externas dependem das credenciais e do ambiente do operador; fixtures de teste não comprovam configuração de outro ambiente. A configuração de produção deve seguir os pontos em production-readiness.md.
