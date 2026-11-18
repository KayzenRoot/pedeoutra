# PedeOutra — identidade legal publicada

Data: 2026-11-18
Main: `4d5e591` (PRs [#104](https://github.com/KayzenRoot/pedeoutra/pull/104),
[#106](https://github.com/KayzenRoot/pedeoutra/pull/106) e
[#107](https://github.com/KayzenRoot/pedeoutra/pull/107))
Veredito: **IDENTIDADE_PUBLICADA / REVISÃO_JURÍDICA_PENDENTE**

## Entregue

- `src/lib/launch-info.ts`: fonte única para razão social, CNPJ, endereço
  opcional, e-mails de suporte/privacidade, data e estado da revisão.
- Identidade publicada: PedeOutra, CNPJ `30.317.383/0001-97`,
  `suporte@pedeoutra.com.br` e `admin@pedeoutra.com.br`.
- O CPF informado anteriormente **não** foi publicado; o endereço foi omitido
  por decisão do proprietário e a cláusula não aparece.
- `legalReview: 'pending'`: páginas mostram “Documento em revisão”, CNPJ e
  contatos, mas mantêm o aviso de revisão jurídica humana.
- Termos com os dois planos e a troca sujeita a atendimento; landing e rodapé
  com CNPJ e suporte no lugar do aviso de MVP.
- `docs/legal-launch.md`: checklist, decisões e sequência de fechamento.
- Testes cobrem os três estados: preliminar, em revisão e vigente; formatação
  de CNPJ/CPF e endereço opcional.

## Verificação

- lint, typecheck, build, SEO e smoke com axe: PASS.
- Unitários: 38 arquivos verdes.
- PRs #104/#106/#107: checks verdes; CI da `main` success.
- Produção (`/termos` e `/privacidade`): CNPJ presente, “Documento em revisão”
  presente, contatos presentes, sem CPF, sem endereço e sem “MVP”.
- Chrome em produção: `/termos`, `/privacidade` e `/` com 0 violações WCAG 2.1
  A/AA; landing com 2 planos disponíveis.
- Nenhuma cobrança, e-mail, WhatsApp, crédito ou mutação de dados.

Screenshot: `evidence/screenshots/prod-termos-identidade.png`.

## Limites atuais

- O domínio `pedeoutra.com.br` segue NXDOMAIN; os e-mails publicados só
  recebem mensagens depois de registro, DNS/MX e SMTP.
- A revisão jurídica humana não foi concluída; por isso o rótulo é “Documento
  em revisão”, não “Documento vigente”.

## Próxima sequência

1. Advogado revisa `/termos` e `/privacidade` no preview do Pages.
2. Aplicar ajustes e mudar `legalReview` para `'approved'`.
3. Publicar; remover avisos residuais e liberar a primeira cobrança.
4. Ativar domínio, DNS/MX e SMTP para os e-mails oficiais funcionarem.
