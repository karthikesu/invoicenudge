'use strict';
// InvoiceNudge private local prototype. Zero dependencies. Node 18+.
// Every value that goes into HTML is passed through escapeHtml (see below).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseJobChat } = require('./ai');
const { parseInvoice } = require('./groq');
const mockPaypal = require('./paypal');
const livePaypal = require('./paypal-live');
const { loadEnv } = require('./groq');
loadEnv();
// Sandbox mode only when explicitly requested AND credentials exist; otherwise the mock.
const SANDBOX = process.env.PAYPAL_MODE === 'sandbox' && !!process.env.PAYPAL_CLIENT_ID && !!process.env.PAYPAL_CLIENT_SECRET;
const paypal = SANDBOX ? livePaypal : mockPaypal;
const MODE_LABEL = SANDBOX ? 'PayPal SANDBOX' : 'mock';

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'",
};

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS });
  res.end(body);
}
function sendJson(res, status, obj) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj));
}

function readBody(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function currencyLabel(c) { return c === 'USD' ? 'USD' : 'RM'; }

function mockApprovalPage(order, id) {
  const inv = order.invoice;
  const rows = inv.items
    .map((it) => `<tr><td>${escapeHtml(it.desc)}</td><td>${escapeHtml(it.qty)}</td><td>${escapeHtml(it.total.toFixed(2))}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MOCK PayPal</title></head><body style="font-family:sans-serif;max-width:480px;margin:2rem auto;padding:0 1rem">
<p style="background:#fff3cd;padding:.5rem">MOCK PayPal page. No real payment. Nothing leaves this computer.</p>
<h2>Pay ${escapeHtml(currencyLabel(inv.currency))} ${escapeHtml(inv.total.toFixed(2))}</h2>
<p>Order ${escapeHtml(id)}</p>
<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%"><tr><th>Item</th><th>Qty</th><th>Amount</th></tr>${rows}</table>
<form method="get" action="/return"><input type="hidden" name="token" value="${escapeHtml(id)}">
<p><button type="submit" style="padding:.7rem 1rem">Approve (mock)</button></p></form></body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(path.join(PUBLIC_DIR, 'index.html')));
    }
    if (req.method === 'GET' && url.pathname === '/app.js') {
      return send(res, 200, 'application/javascript; charset=utf-8', fs.readFileSync(path.join(PUBLIC_DIR, 'app.js')));
    }

    if (req.method === 'POST' && url.pathname === '/api/invoice') {
      const body = JSON.parse((await readBody(req)) || '{}');
      return sendJson(res, 200, { ...(await parseInvoice(body.text)), mode: MODE_LABEL });
    }

    if (req.method === 'POST' && url.pathname === '/api/pay') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const inv = body.invoice;
      if (!inv || !Array.isArray(inv.items) || !inv.items.length) return sendJson(res, 400, { error: 'No invoice items' });
      // Re-derive the invoice server-side from the text if provided, never trust client totals blindly.
      const safe = body.text ? await parseInvoice(body.text) : inv;
      let order;
      try { order = await paypal.createOrder(safe, 'http://127.0.0.1:' + (server.address() ? server.address().port : 3000)); }
      catch (_) { return sendJson(res, 502, { error: 'Payment provider unavailable' }); }
      return sendJson(res, 200, { id: order.id, approveUrl: order.links[0].href });
    }

    if (req.method === 'GET' && url.pathname === '/mock-paypal/approve') {
      const id = url.searchParams.get('token') || '';
      const order = paypal.getOrder(id);
      if (!order) return send(res, 404, 'text/html; charset=utf-8', '<p>Unknown order.</p>');
      return send(res, 200, 'text/html; charset=utf-8', mockApprovalPage(order, id));
    }

    if (req.method === 'GET' && url.pathname === '/return') {
      const id = url.searchParams.get('token') || '';
      if (!paypal.approveOrder(id)) return send(res, 404, 'text/html; charset=utf-8', '<p>Unknown order.</p>');
      const cap = await paypal.captureOrder(id);
      const status = cap ? cap.status : 'FAILED';
      return send(res, 200, 'text/html; charset=utf-8',
        `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;max-width:480px;margin:2rem auto"><h2>Payment ${escapeHtml(status)} (${escapeHtml(MODE_LABEL)})</h2><p>Order ${escapeHtml(id)}</p><p><a href="/">Back</a></p></body>`);
    }

    return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
  } catch (e) {
    return sendJson(res, 400, { error: 'Bad request' });
  }
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '127.0.0.1', () => console.log('InvoiceNudge (' + MODE_LABEL + ') on http://127.0.0.1:' + port));
}

module.exports = { server, escapeHtml, mockApprovalPage };
