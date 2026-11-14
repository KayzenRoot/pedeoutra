export interface CatalogTemplateItem {
  key: string
  name: string
  category: string
  unit: string
  min_quantity: number
  quantity_increment: number
}

export interface CatalogTemplate {
  code: string
  name: string
  description: string
  version: number
  items: CatalogTemplateItem[]
}

function item(
  key: string,
  name: string,
  category: string,
  unit: string,
  minQuantity = 1,
  quantityIncrement = 1,
): CatalogTemplateItem {
  return {
    key,
    name,
    category,
    unit,
    min_quantity: minQuantity,
    quantity_increment: quantityIncrement,
  }
}

export const CATALOG_TEMPLATES: CatalogTemplate[] = [
  {
    code: 'packaging',
    name: 'Embalagens e descartáveis',
    description: 'Copos, potes, sacolas e itens de balcão para food service.',
    version: 1,
    items: [
      item('copo-200', 'Copo descartável 200ml', 'Copos e potes', 'cento'),
      item('copo-300', 'Copo descartável 300ml', 'Copos e potes', 'cento'),
      item('pote-500', 'Pote com tampa 500ml', 'Copos e potes', 'cento'),
      item('sacola', 'Sacola plástica reforçada', 'Sacolas e sacos', 'pacote'),
      item('guardanapo', 'Guardanapo de papel', 'Talheres e acessórios', 'pacote'),
    ],
  },
  {
    code: 'cleaning',
    name: 'Limpeza e higiene',
    description: 'Produtos de limpeza e descartáveis para manutenção.',
    version: 1,
    items: [
      item('agua-sanitaria', 'Água sanitária 5L', 'Desinfetantes', 'galão'),
      item('detergente', 'Detergente neutro 500ml', 'Detergentes', 'frasco'),
      item('desinfetante', 'Desinfetante 2L', 'Desinfetantes', 'frasco'),
      item('sabao-po', 'Sabão em pó 1kg', 'Lavanderia', 'pacote'),
      item('esponja', 'Esponja multiuso', 'Panos e esponjas', 'pacote'),
    ],
  },
  {
    code: 'water_ice',
    name: 'Água e gelo',
    description: 'Água mineral e gelo para revenda e eventos.',
    version: 1,
    items: [
      item('agua-5l', 'Água mineral 5L', 'Água', 'galão'),
      item('agua-20l', 'Água mineral 20L', 'Água', 'galão'),
      item('gelo-cubos-5kg', 'Gelo em cubos 5kg', 'Gelo', 'saco'),
      item('gelo-escamas-10kg', 'Gelo em escamas 10kg', 'Gelo', 'saco'),
    ],
  },
  {
    code: 'groceries',
    name: 'Mercearia e insumos',
    description: 'Itens secos e insumos básicos para cozinha e revenda.',
    version: 1,
    items: [
      item('arroz-5kg', 'Arroz tipo 1 5kg', 'Mercearia seca', 'pacote'),
      item('feijao-1kg', 'Feijão carioca 1kg', 'Mercearia seca', 'pacote'),
      item('acucar-5kg', 'Açúcar refinado 5kg', 'Mercearia seca', 'pacote'),
      item('oleo-900ml', 'Óleo vegetal 900ml', 'Mercearia seca', 'garrafa'),
      item('cafe-500g', 'Café torrado 500g', 'Bebidas', 'pacote'),
    ],
  },
  {
    code: 'empty',
    name: 'Catálogo vazio',
    description: 'Comece sem produtos e cadastre o que vende.',
    version: 1,
    items: [],
  },
]

export function findCatalogTemplate(
  code: string,
  version: number,
): CatalogTemplate | null {
  return (
    CATALOG_TEMPLATES.find(
      (template) => template.code === code && template.version === version,
    ) ?? null
  )
}
