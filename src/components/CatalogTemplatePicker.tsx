import { useEffect, useState } from 'react'
import { callAuthedFunction, EdgeFunctionError, getCatalogTemplates } from '../lib/edge'
import type {
  CatalogTemplate,
  CatalogTemplateItem,
  CatalogTemplatesResponse,
} from '../lib/types'
import { FormMessage } from './ui'

interface DraftItem {
  selected: boolean
  name: string
  category: string
  unit: string
  min_quantity: string
  quantity_increment: string
  conflict: boolean
  conflict_reason: string | null
}

interface PreviewResponse {
  mode: 'preview'
  items: Array<{
    item_key: string
    conflict: boolean
    conflict_reason: string | null
  }>
  summary: { selected: number; conflicts: number }
}

interface CommitResponse {
  mode: 'commit'
  summary: {
    created_count: number
    skipped_count: number
    total_items: number
  }
}

function initialDraft(items: CatalogTemplateItem[]): Record<string, DraftItem> {
  return Object.fromEntries(
    items.map((item) => [
      item.key,
      {
        selected: true,
        name: item.name,
        category: item.category,
        unit: item.unit,
        min_quantity: String(item.min_quantity),
        quantity_increment: String(item.quantity_increment),
        conflict: false,
        conflict_reason: null,
      },
    ]),
  )
}

export function CatalogTemplatePicker({
  mode,
  onSeeded,
  onSkip,
}: {
  readonly mode: 'onboarding' | 'store'
  readonly onSeeded: () => Promise<void> | void
  readonly onSkip?: () => void
}) {
  const [templates, setTemplates] = useState<CatalogTemplate[]>([])
  const [selectedCode, setSelectedCode] = useState('')
  const [draft, setDraft] = useState<Record<string, DraftItem>>({})
  const [jobId, setJobId] = useState('')
  const [preview, setPreview] = useState<PreviewResponse['summary'] | null>(null)
  const [result, setResult] = useState<CommitResponse['summary'] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getCatalogTemplates<CatalogTemplatesResponse>()
      .then((data) => {
        if (active) setTemplates(data.templates ?? [])
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar os modelos agora.')
      })
    return () => {
      active = false
    }
  }, [])

  const template = templates.find((item) => item.code === selectedCode) ?? null
  const selectedItems = Object.entries(draft).filter(([, item]) => item.selected)

  function itemsPayload() {
    return selectedItems.map(([key, item]) => ({
      item_key: key,
      name: item.name,
      category: item.category,
      unit: item.unit,
      min_quantity: Number(item.min_quantity),
      quantity_increment: Number(item.quantity_increment),
    }))
  }

  async function runPreview(nextDraft: Record<string, DraftItem>, chosen: CatalogTemplate) {
    const items = Object.entries(nextDraft)
      .filter(([, item]) => item.selected)
      .map(([key, item]) => ({
        item_key: key,
        name: item.name,
        category: item.category,
        unit: item.unit,
        min_quantity: Number(item.min_quantity),
        quantity_increment: Number(item.quantity_increment),
      }))
    if (items.length === 0) {
      setPreview({ selected: 0, conflicts: 0 })
      return
    }
    const response = await callAuthedFunction<PreviewResponse>('onboarding-seed', {
      mode: 'preview',
      template_code: chosen.code,
      template_version: chosen.version,
      items,
    })
    setPreview(response.summary)
    setDraft((current) => {
      const next = { ...current }
      for (const item of response.items) {
        if (next[item.item_key]) {
          next[item.item_key] = {
            ...next[item.item_key],
            conflict: item.conflict,
            conflict_reason: item.conflict_reason,
          }
        }
      }
      return next
    })
  }

  async function chooseTemplate(chosen: CatalogTemplate) {
    const nextDraft = initialDraft(chosen.items)
    setSelectedCode(chosen.code)
    setDraft(nextDraft)
    setJobId(crypto.randomUUID())
    setPreview(null)
    setResult(null)
    setError(null)
    setSuccess(null)
    setBusy(true)
    try {
      await runPreview(nextDraft, chosen)
    } catch (previewError) {
      setError(
        previewError instanceof EdgeFunctionError
          ? previewError.message
          : 'Não foi possível validar o modelo.',
      )
    } finally {
      setBusy(false)
    }
  }

  function updateItem(
    key: string,
    field: 'selected' | 'name' | 'category' | 'unit' | 'min_quantity' | 'quantity_increment',
    value: string | boolean,
  ) {
    setDraft((current) => ({
      ...current,
      [key]: { ...current[key], [field]: value },
    }))
  }

  function selectAll(selected: boolean) {
    setDraft((current) =>
      Object.fromEntries(
        Object.entries(current).map(([key, item]) => [key, { ...item, selected }]),
      ),
    )
  }

  async function confirm() {
    if (!template || !jobId) return
    if (selectedItems.length === 0) {
      onSkip?.()
      return
    }
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await callAuthedFunction<CommitResponse>('onboarding-seed', {
        mode: 'commit',
        job_id: jobId,
        template_code: template.code,
        template_version: template.version,
        items: itemsPayload(),
      })
      setResult(response.summary)
      setSuccess(
        `Modelo aplicado: ${response.summary.created_count} criado(s), ${response.summary.skipped_count} ignorado(s).`,
      )
      await onSeeded()
    } catch (commitError) {
      setError(
        commitError instanceof EdgeFunctionError
          ? commitError.message
          : 'Não foi possível criar o catálogo.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card template-picker">
      <div className="card-heading">
        <div>
          <span className="eyebrow">
            {mode === 'onboarding' ? 'Primeiro catálogo' : 'Modelo de catálogo'}
          </span>
          <h2>Escolha um ponto de partida</h2>
        </div>
        {onSkip && (
          <button type="button" className="text-button" onClick={onSkip}>
            Pular por agora
          </button>
        )}
      </div>
      <p className="muted">
        Modelos genéricos, sem preço, estoque ou disponibilidade inventados. Você escolhe,
        edita e confirma o que será criado.
      </p>
      {error && <FormMessage>{error}</FormMessage>}
      {success && <FormMessage tone="success">{success}</FormMessage>}

      <fieldset className="template-options">
        <legend className="sr-only">Modelos de catálogo</legend>
        {templates.map((item) => (
          <button
            type="button"
            className="template-option"
            aria-pressed={selectedCode === item.code}
            onClick={() => void chooseTemplate(item)}
            key={item.code}
          >
            <strong>{item.name}</strong>
            <span>{item.description}</span>
            <small>{item.items.length} item(ns)</small>
          </button>
        ))}
      </fieldset>

      {template && template.items.length > 0 && (
        <>
          <div className="template-toolbar">
            <button type="button" className="text-button" onClick={() => selectAll(true)}>
              Selecionar todos
            </button>
            <button type="button" className="text-button" onClick={() => selectAll(false)}>
              Desmarcar todos
            </button>
            <span className="muted">
              {selectedItems.length} selecionado(s)
              {preview && preview.conflicts > 0 ? ` · ${preview.conflicts} conflito(s)` : ''}
            </span>
          </div>

          <div className="template-items">
            {template.items.map((item) => {
              const draftItem = draft[item.key]
              if (!draftItem) return null
              return (
                <div className="template-item" key={item.key}>
                  <label className="template-check">
                    <input
                      type="checkbox"
                      checked={draftItem.selected}
                      onChange={(event) =>
                        updateItem(item.key, 'selected', event.target.checked)
                      }
                    />
                    <span>{item.key}</span>
                  </label>
                  <div className="template-fields">
                    <input
                      aria-label={`Nome de ${item.key}`}
                      value={draftItem.name}
                      onChange={(event) => updateItem(item.key, 'name', event.target.value)}
                    />
                    <input
                      aria-label={`Categoria de ${item.key}`}
                      value={draftItem.category}
                      onChange={(event) =>
                        updateItem(item.key, 'category', event.target.value)
                      }
                    />
                    <input
                      aria-label={`Unidade de ${item.key}`}
                      value={draftItem.unit}
                      onChange={(event) => updateItem(item.key, 'unit', event.target.value)}
                    />
                    <input
                      aria-label={`Quantidade mínima de ${item.key}`}
                      inputMode="numeric"
                      value={draftItem.min_quantity}
                      onChange={(event) =>
                        updateItem(item.key, 'min_quantity', event.target.value)
                      }
                    />
                    <input
                      aria-label={`Múltiplo de ${item.key}`}
                      inputMode="numeric"
                      value={draftItem.quantity_increment}
                      onChange={(event) =>
                        updateItem(item.key, 'quantity_increment', event.target.value)
                      }
                    />
                  </div>
                  <span className="template-price">A combinar</span>
                  {draftItem.conflict && (
                    <span className="pill pill-muted" title={draftItem.conflict_reason ?? ''}>
                      Já existe; será ignorado
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          <div className="template-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                if (template) void runPreview(draft, template)
              }}
              disabled={busy}
            >
              Validar seleção
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void confirm()}
              disabled={busy || selectedItems.length === 0 || result !== null}
            >
              {busy
                ? 'Criando…'
                : mode === 'onboarding'
                  ? `Criar catálogo com ${selectedItems.length} item(ns)`
                  : `Importar ${selectedItems.length} item(ns)`}
            </button>
          </div>
        </>
      )}

      {template && template.items.length === 0 && (
        <div className="template-empty">
          <p>Este modelo não cria produtos. Você pode cadastrar manualmente depois.</p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              if (onSkip) onSkip()
              else void onSeeded()
            }}
          >
            Continuar com catálogo vazio
          </button>
        </div>
      )}
    </section>
  )
}
