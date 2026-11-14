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

export const CATALOG_TEMPLATES: CatalogTemplate[] = [
  {
    code: 'packaging',
    name: 'Embalagens e descartáveis',
    description: 'Copos, potes, sacolas e itens de balcão para food service.',
    version: 1,
    items: [
      {
        key: 'copo-200',
        name: 'Copo descartável 200ml',
        category: 'Copos e potes',
        unit: 'cento',
        min_quantity: 1,
        quantity_increment: 1,
      },
      {
        key: 'copo-300',
        name: 'Copo descartável 300ml',
        category: 'Copos e potes',
        unit: 'cento',
        min_quantity: 1,
        quantity_increment: 1,
      },
      {
        key: 'pote-500',
        name: 'Pote com tampa 500ml',
        category: 'Copos e potes',
        unit: 'cento',
        min_quantity: 1,
        quantity_increment: 1,
      },
      {
        key: 'sacola',
        name: 'Sacola plástica reforçada',
        category: 'Sacolas e sacos',
        unit: 'pacote',
        min_quantity: 1,
        quantity_increment: 1,
      },
      {
        key: 'guardanapo',
        name: 'Guardanapo de papel',
        category: 'Talheres e acessórios',
        unit: 'pacote',
        min_quantity: 1,
        quantity_increment: 1,
      },
    ],
  },
  {
    code: 'cleaning',
    name: 'Limpeza e higiene',
    description: 'Produtos de limpeza e descartáveis para manutenção.',
    version: 1,
    items: [
      {
        key: 'agua-sanitaria',
        name: 'Água sanitária 5L',
        category: 'Desinfetantes',
        unit: 'galão',
        min_quantity: 1,
        quantity_increment: 1,
      },
      {
        key: 'detergente',
        name: 'Detergente neutro 500ml',
        category: 'Detergentes',
        unit: 'frasco',
        min_quantity: 1,
        quantity_increment: 1,
      },
      {
        key: 'desinfetante',
        name: 'Desinfetante 2L',
        category: 'Desinfetantes',
        unit: 'frasco',
        min_quantity: 1,
        quantity_increment: 1,
      },
      {
        key: 'sabao-po',
        name: 'Sabão em pó 1kg',
        category: 'Lavanderia',
        unit: 'pacote',
        min_quantity: 1,
        quantity_increment: 1,
      },
      {
        key: 'esponja',
        name: 'Esponja multiuso',
        category: 'Panos e esponjas',
        unit: 'pacote',
        min_quantity: 1,
        quantity_increment: 1,
      },
    ],
  },
  {
    code: 'water_ice',
    name: 'Água e gelo',
    description: 'Água mineral e gelo para revenda e eventos.',
    version: 1,
    items: [
      {
        key: 'agua-5l',
        name: 'Água mineral 5L',
        category: 'Água',
        unit: 'galão',
        min_quantity: 1,
        quantity_increment: 1,
      },
      {
        key: 'agua-20l',
        name: 'Água mineral 20L',
        category: 'Água',
        unit: 'galão',
        min_quantity: 1,
        quantity_increment: 1,
      },
      {
        key: 'gelo-cubos-5kg',
        name: 'Gelo em cubos 5kg',
        category: 'Gelo',
        unit: 'saco',
        min_quantity: 1,
        quantity_increment: 1,
      },
      {
        key: 'gelo-escamas-10kg',
        name: 'Gelo em escamas 10kg',
        category: 'Gelo',
        unit: 'saco',
        min_quantity: 1,
        quantity_increment: 1,
      },
    ],
  },
  {
    code: 'groceries',
    name: 'Mercearia e insumos',
    description: 'Itens secos e insumos básicos para cozinha e revenda.',
    version: 1,
    items: [
      {
        key: 'arroz-5kg',
        name: 'Arroz tipo 1 5kg',
        category: 'Mercearia seca',
        unit: 'pacote',
        min_quantity: 1,
        quantity_increment: 1,
      },
      {
        key: 'feijao-1kg',
        name: 'Feijão carioca 1kg',
        category: 'Mercearia seca',
        unit: 'pacote',
        min_quantity: 1,
        quantity_increment: 1,
      },
      {
        key: 'acucar-5kg',
        name: 'Açúcar refinado 5kg',
        category: 'Mercearia seca',
        unit: 'pacote',
        min_quantity: 1,
        quantity_increment: 1,
      },
      {
        key: 'oleo-900ml',
        name: 'Óleo vegetal 900ml',
        category: 'Mercearia seca',
        unit: 'garrafa',
        min_quantity: 1,
        quantity_increment: 1,
      },
      {
        key: 'cafe-500g',
        name: 'Café torrado 500g',
        category: 'Bebidas',
        unit: 'pacote',
        min_quantity: 1,
        quantity_increment: 1,
      },
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
