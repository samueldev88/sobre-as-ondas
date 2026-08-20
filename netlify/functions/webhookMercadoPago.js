// netlify/functions/webhookMercadoPago.js
//
// O Mercado Pago chama essa URL sozinho (servidor a servidor, sem passar
// pelo navegador do cliente) toda vez que o status de um pagamento muda.
// Aqui a gente confere o pagamento direto na API do Mercado Pago (nunca
// confia só no que chega na notificação) e, se estiver aprovado, libera
// o pedido pra cozinha no Firestore. Isso fecha a brecha de alguém dizer
// que pagou sem ter pago: quem manda aqui é o Mercado Pago, não o cliente.

const mercadopago = require('mercadopago');
const admin = require('firebase-admin');

// Evita inicializar o Firebase Admin mais de uma vez (a function pode
// ser reaproveitada entre chamadas pelo Netlify)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // no painel do Netlify a chave privada vem com \n escapado, aqui
      // a gente devolve as quebras de linha de verdade
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}
const db = admin.firestore();

exports.handler = async function (event) {
  // o Mercado Pago pode chamar via GET ou POST dependendo do tipo de notificação
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN,
  });

  try {
    const params = event.queryStringParameters || {};
    let body = {};
    try { body = event.body ? JSON.parse(event.body) : {}; } catch (e) { /* corpo vazio ou não-JSON, ignora */ }

    // o Mercado Pago manda o aviso de formas um pouco diferentes
    // dependendo da integração (?type=payment&data.id=123 ou {type, data:{id}})
    const tipo = params.type || params.topic || body.type || body.topic;
    const paymentId = params['data.id'] || params.id || (body.data && body.data.id) || body.id;

    // só nos interessa notificação de pagamento; outros tipos (ex: merchant_order)
    // a gente simplesmente ignora, respondendo 200 pro Mercado Pago não ficar retentando
    if (tipo !== 'payment' || !paymentId) {
      return { statusCode: 200, body: 'ignorado' };
    }

    // busca o pagamento DIRETO na API do Mercado Pago, com o nosso access token —
    // é isso que garante que a informação é real e não pode ser forjada
    const pagamento = await mercadopago.payment.findById(paymentId);
    const dados = pagamento.body;
    const pedidoId = dados.external_reference;
    const status = dados.status; // approved | pending | rejected | cancelled | in_process ...

    if (!pedidoId) {
      return { statusCode: 200, body: 'sem pedidoId associado' };
    }

    const pedidoRef = db.collection('pedidos').doc(pedidoId);

    if (status === 'approved') {
      await pedidoRef.update({
        status: 'recebido',
        paymentStatus: 'aprovado',
      });
    } else if (status === 'rejected' || status === 'cancelled') {
      await pedidoRef.update({
        paymentStatus: status,
      });
    }
    // se for 'pending' ou 'in_process' não faz nada — o pedido continua
    // "aguardando pagamento" até vir uma notificação de aprovado ou rejeitado

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('Erro no webhook do Mercado Pago:', err);
    // devolve 200 mesmo em erro interno pra evitar que o Mercado Pago
    // fique retentando infinitamente por causa de um bug pontual;
    // o erro fica registrado no log da function pra você investigar
    return { statusCode: 200, body: 'erro registrado' };
  }
};