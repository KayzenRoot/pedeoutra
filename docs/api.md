# API B2B v1 (Profissional)

Status: leitura somente, sujeita a quota e escopos. Não é gateway de pagamento
dos pedidos e não cria cobranças.

## Autenticação

1. O proprietário ativa MFA TOTP (AAL2) e cria uma chave em
   `Configurações > API B2B`.
2. A chave `po_live_...` aparece uma única vez. Guarde-a em um cofre de segredos;
   nunca no navegador, em logs ou no repositório.
3. Envie `Authorization: Bearer <chave>` ou `x-api-key: <chave>`.

Chaves são armazenadas como SHA-256 e podem ser revogadas imediatamente. A API
exige plano Profissional ativo e os escopos:

- `catalog:read` — `/v1/products`
- `customers:read` — `/v1/customers`
- `orders:read` — `/v1/orders`

`/v1/me` retorna organização, plano, escopos e prefixo da chave.

## Base URL

`https://waygtbclkxklexnabwvj.supabase.co/functions/v1/api-v1`

Contrato: [`/openapi.json`](../public/openapi.json).

## Limites

- 60 requisições/minuto por chave.
- 10.000 requisições/mês por organização (`api_access`).
- Paginação `limit` 1–100 e `offset` até 100.000.
- Respostas `429` para limite/quota; `401` para chave inválida/revogada; `403`
  para escopo/plano; `503` para indisponibilidade interna.

## Exemplos

```bash
curl -H "Authorization: Bearer $PEDEOUTRA_API_KEY" \
  "https://waygtbclkxklexnabwvj.supabase.co/functions/v1/api-v1/v1/products?limit=50"

curl -H "Authorization: Bearer $PEDEOUTRA_API_KEY" \
  "https://waygtbclkxklexnabwvj.supabase.co/functions/v1/api-v1/v1/orders?status=new"
```

## Fora do escopo desta versão

- escrita de produtos/clientes/pedidos;
- webhooks de eventos B2B (#66), que ficam para a próxima entrega;
- cobrança de pedidos dos compradores, nota fiscal e ERP.
