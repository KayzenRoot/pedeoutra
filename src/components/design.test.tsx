import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FeatureCard, Reveal, StatCard, TiltCard } from './design'

describe('componentes visuais', () => {
  it('FeatureCard mantém conteúdo e lista legíveis', () => {
    render(
      <FeatureCard
        badge="Essencial"
        badgeTone="pill-lime"
        title="Catálogo"
        items={[<>Primeiro item</>, <>Segundo item</>]}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Catálogo' })).toBeInTheDocument()
    expect(screen.getByText('Primeiro item')).toBeInTheDocument()
    expect(screen.getByText('Essencial')).toBeInTheDocument()
  })

  it('StatCard expõe rótulo, valor e detalhe', () => {
    render(<StatCard label="Inativos" value={12} detail="Sem pedido na janela" accent />)
    expect(screen.getByText('Inativos')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Sem pedido na janela')).toBeInTheDocument()
  })

  it('Reveal não esconde conteúdo sem IntersectionObserver', () => {
    render(
      <Reveal>
        <p>Conteúdo visível</p>
      </Reveal>,
    )
    expect(screen.getByText('Conteúdo visível')).toBeInTheDocument()
    expect(screen.getByText('Conteúdo visível').parentElement).not.toHaveClass('reveal-visible')
  })

  it('TiltCard não inclina sem ponteiro fino', () => {
    const { container } = render(
      <TiltCard>
        <article>Card</article>
      </TiltCard>,
    )
    const wrapper = container.firstElementChild as HTMLElement
    fireEvent.pointerMove(wrapper, { clientX: 10, clientY: 10 })
    expect(wrapper.style.getPropertyValue('--tilt-x')).toBe('')
    expect(wrapper.style.getPropertyValue('--tilt-y')).toBe('')
  })
})
