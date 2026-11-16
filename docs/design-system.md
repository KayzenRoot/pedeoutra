# Design system PedeOutra V2 (#81)

## Tokens

Os tokens existentes em `src/styles.css` continuam sendo a fonte de verdade:

- Marca: `--brand-navy`, `--brand-navy-2`, `--lime`, `--lime-strong`, `--blue`.
- Superfícies: `--bg`, `--surface`, `--surface-2`, `--glass-bg`, `--header-bg`.
- Texto/linhas: `--ink`, `--ink-2`, `--muted`, `--line`.
- Estados: `--success`, `--warning`, `--danger`, `--focus`.
- Tipografia/espaçamento usam a escala existente; novos componentes não
  introduzem biblioteca, CSS-in-JS ou dependência de animação.

## Componentes

`src/components/design.tsx`:

| Componente | Uso |
| --- | --- |
| `SectionHeading` | eyebrow + h2 + descrição de seção |
| `GlassCard` | superfície translúcida com fallback sólido |
| `FeatureCard` | card de recurso com badge e lista |
| `PricingCard` | moldura visual dos planos |
| `StatCard` | métrica com rótulo, valor e detalhe |
| `IconButton` | botão de ícone com `aria-label` e foco visível |
| `TiltCard` | tilt 3D sutil, somente ponteiro fino |
| `Reveal` | entrada por IntersectionObserver |

Os componentes são visual-only: nenhum faz chamada de rede, lê organização ou
decide permissão. Conteúdo, links e CTAs continuam no DOM e funcionam sem JS.

## Motion e acessibilidade

- Tilt máximo de 4°, 180ms, apenas `hover: hover` + `pointer: fine`.
- Toque, teclado e `prefers-reduced-motion: reduce` não recebem transform.
- `Reveal` nunca esconde conteúdo: a classe apenas adiciona uma animação curta
  de 260ms. Sem `IntersectionObserver`, sem JS ou com reduced motion, o conteúdo
  permanece visível.
- Hover não é o único canal de informação; badges e textos carregam o estado.
- Foco visível mantido; alvos de toque com pelo menos 38px no `IconButton`.
- Glass tem fallback sólido; `backdrop-filter` é progressivo via `@supports`.

## Aplicação

- Landing: seções de recursos e planos usam `SectionHeading`, `Reveal`,
  `TiltCard`, `FeatureCard` e `PricingCard`.
- Relatório de clientes: `StatCard` e `SectionHeading` mantêm a mesma
  linguagem visual.
- Painel admin e demais telas continuam com os componentes existentes; a
  migração é incremental para não criar monólito nem duplicar markup.

## Performance

- Sem bibliotecas novas; tilt é CSS transform + dois event handlers por card.
- `will-change` não é aplicado globalmente.
- A animação usa `transform`/`opacity` (composição), sem listener de scroll.
- O prerender comercial continua gerando HTML com conteúdo visível; o JS só
  adiciona classes de movimento.
- Smoke mede axe e screenshots light/dark/mobile; CWV de campo segue
  `EXTERNAL_SETUP_REQUIRED` até deploy/GSC autorizados.

## Testes

- `design.test.tsx`: FeatureCard/StatCard, Reveal sem IO e TiltCard sem
  ponteiro fino.
- `npm run smoke:preview`: axe 0 violações em landing/demo, light/dark/system,
  desktop/mobile.
- `npm run test:seo`: HTML inicial, preços, canonical/JSON-LD e 404.
