// netlify/functions/criarPagamento.js
//
// Essa função recebe o pedido do site (itens, mesa, forma de pagamento)
// e cria uma cobrança no Mercado Pago, devolvendo o link de checkout
// (init_point) pro navegador redirecionar o cliente.

const mercadopago = require('mercadopago');

exports.handler = async function (event) {
  // só aceita chamadas via POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // pega o Access Token de uma variável de ambiente (nunca deixe fixo no código)
  mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN,
  });

  try {
    const { items, mesa, pedidoId, metodo } = JSON.parse(event.body);

    if (!items || items.length === 0 || !pedidoId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Dados do pedido incompletos' }) };
    }

    const baseUrl = process.env.URL || 'http://localhost:8888';

    const preference = {
      items: items.map((it) => ({
        title: it.name,
        quantity: it.qty,
        currency_id: 'BRL',
        unit_price: Number(it.price),
      })),
      back_urls: {
        success: `${baseUrl}/pedidos.html?pago=1&pedido=${pedidoId}`,
        pending: `${baseUrl}/pedidos.html?pago=pendente&pedido=${pedidoId}`,
        failure: `${baseUrl}/pedidos.html?pago=0&pedido=${pedidoId}`,
      },
      auto_return: 'approved',
      external_reference: pedidoId,
      metadata: { mesa, metodo, pedidoId },
      // avisa o Mercado Pago pra chamar nosso webhook (servidor a servidor)
      // sempre que o status desse pagamento mudar — é isso que confirma
      // o pedido de forma automática, sem depender do cliente voltar pro site
      notification_url: `${baseUrl}/.netlify/functions/webhookMercadoPago`,
    };

    const response = await mercadopago.preferences.create(preference);

    return {
      statusCode: 200,
      body: JSON.stringify({ init_point: response.body.init_point }),
    };
  } catch (err) {
    console.error('Erro ao criar pagamento:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erro ao criar pagamento' }),
    };
  }
};