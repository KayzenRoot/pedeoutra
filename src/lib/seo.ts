import { useEffect } from 'react'

interface SeoInput {
  title: string
  description: string
  path: string
  noindex?: boolean
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>
}

function stripTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end -= 1
  return value.slice(0, end)
}

function baseUrl(): string {
  const configured = (import.meta.env.VITE_APP_URL as string | undefined)?.trim()
  return stripTrailingSlashes(configured || window.location.origin)
}

function setMeta(selector: string, attribute: 'name' | 'property', key: string, value: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.append(element)
  }
  element.content = value
}

export function useSeo(input: SeoInput): void {
  useEffect(() => {
    const suffix = input.path.startsWith('/') ? input.path : `/${input.path}`
    const canonical = `${baseUrl()}${suffix}`
    document.title = input.title
    setMeta('meta[name="description"]', 'name', 'description', input.description)
    setMeta(
      'meta[name="robots"]',
      'name',
      'robots',
      input.noindex ? 'noindex, nofollow' : 'index, follow',
    )
    setMeta('meta[property="og:title"]', 'property', 'og:title', input.title)
    setMeta('meta[property="og:description"]', 'property', 'og:description', input.description)
    setMeta('meta[property="og:url"]', 'property', 'og:url', canonical)
    setMeta('meta[property="og:type"]', 'property', 'og:type', 'website')
    setMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary')
    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', input.title)
    setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', input.description)

    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'canonical'
      document.head.append(link)
    }
    link.href = canonical

    const existing = document.getElementById('pedeoutra-jsonld')
    if (existing) existing.remove()
    if (input.jsonLd) {
      const script = document.createElement('script')
      script.id = 'pedeoutra-jsonld'
      script.type = 'application/ld+json'
      script.textContent = JSON.stringify(input.jsonLd)
      document.head.append(script)
    }
  }, [input.description, input.jsonLd, input.noindex, input.path, input.title])
}
