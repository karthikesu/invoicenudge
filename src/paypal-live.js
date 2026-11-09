'use strict';
// PayPal SANDBOX client (Orders v2). Hard-wired to api-m.sandbox.paypal.com: there is
// no switch to the live API in this file. Credentials come from env / local .env only.
// Same function names as the mock (src/paypal.js), but async.

const BASE = 'https://api-m.sandbox.paypal.com';
const orders = new Map(); // id -> { status, invoice }, only orders this server created

function money(n) { return (Math.round(Number(n) * 100) / 100).toFixed(2); }

async function accessToken(fetchImpl) {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PayPal sandbox credentials missing');
  const res = await (fetchImpl || fetch)(BASE + '/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error('PayPal auth failed: ' + res.status);
  return (await res.json()).access_token;
}

async function createOrder(invoice, returnBase, fetchImpl) {
  const token = await accessToken(fetchImpl);
  const currency = invoice.currency === 'USD' ? 'USD' : 'MYR';
  const res = await (fetchImpl || fetch)(BASE + '/v2/checkout/orders', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        description: ('Invoice' + (invoice.client ? ' for ' + invoice.client : '')).slice(0, 120),
        amount: { currency_code: currency, value: money(invoice.total) },
      }],
      application_context: {
        user_action: 'PAY_NOW',
        return_url: returnBase + '/return',
        cancel_url: returnBase + '/',
      },
    }),
  });
  if (!res.ok) throw new Error('PayPal create order failed: ' + res.status);
  const data = await res.json();
  const approve = (data.links || []).find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  if (!data.id || !approve || !/^https:\/\/(www\.)?sandbox\.paypal\.com\//.test(approve.href)) throw new Error('Unexpected PayPal response');
  orders.set(data.id, { status: 'CREATED', invoice });
  return { id: data.id, status: 'CREATED', links: [{ rel: 'approve', href: approve.href }] };
}

function getOrder(id) { return orders.get(String(id)) || null; }

function approveOrder(id) {
  const o = orders.get(String(id));
  if (!o) return null; // only capture orders this server created
  o.status = 'APPROVED';
  return o;
}

async function captureOrder(id, fetchImpl) {
  const o = orders.get(String(id));
  if (!o || o.status !== 'APPROVED') return null;
  const token = await accessToken(fetchImpl);
  const res = await (fetchImpl || fetch)(BASE + '/v2/checkout/orders/' + encodeURIComponent(id) + '/capture', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) return { id: String(id), status: 'FAILED' };
  const data = await res.json();
  o.status = data.status === 'COMPLETED' ? 'COMPLETED' : 'APPROVED';
  return { id: String(id), status: String(data.status || 'FAILED') };
}

module.exports = { createOrder, getOrder, approveOrder, captureOrder, BASE };
