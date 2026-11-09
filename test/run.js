'use strict';
const assert = require('assert');
const http = require('http');
const { parseJobChat } = require('../src/ai');
const { server, escapeHtml } = require('../src/server');

let passed = 0;
function t(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed++; console.log('ok  - ' + name); });
}

function req(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port, method, path, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  await t('parses qty x item @ price', () => {
    const inv = parseJobChat('3 x banner @ 25');
    assert.strictEqual(inv.items.length, 1);
    assert.strictEqual(inv.total, 75);
  });
  await t('parses hourly lines', () => {
    const inv = parseJobChat('2 hours @ 40/hr');
    assert.strictEqual(inv.total, 80);
  });
  await t('parses dash price lines and RM', () => {
    const inv = parseJobChat('logo design - RM150');
    assert.strictEqual(inv.total, 150);
    assert.strictEqual(inv.currency, 'MYR');
  });
  await t('detects USD', () => {
    assert.strictEqual(parseJobChat('logo - $200').currency, 'USD');
  });
  await t('ignores deposit lines', () => {
    const inv = parseJobChat('logo - RM150\ndeposit RM100 paid');
    assert.strictEqual(inv.items.length, 1);
    assert.strictEqual(inv.total, 150);
  });
  await t('REGRESSION: messy chat formats still total correctly (v0.2 lost these)', () => {
    const cases = [
      ['Logo RM300 done\nRM620 for banner', 920],
      ['[10:32] Ali: logo RM300\n[10:35] Ali: banner RM620', 920],
      ['2x banner @ RM50 each\nlogo RM820', 920],
      ['Logo (3 revisions) RM300, banner RM620', 920],
      ['hosting 1 year RM 120\nsite RM800', 920],
      ['poster design = RM1,020 (rush)', 1020],
      ['Total RM920\nlogo RM920', 920],
    ];
    for (const [text, total] of cases) assert.strictEqual(parseJobChat(text).total, total, text);
  });
  await t('REGRESSION (Tara, exact): one-line chat with qty "at", client and due in weeks', () => {
    const text = 'ok bro confirm ya. wedding video edit = RM 800, also 2 x reels for insta at RM 60 each. client: Arun and Priya. due in 2 weeks';
    const inv = parseJobChat(text);
    assert.strictEqual(inv.total, 920);
    assert.strictEqual(inv.items.length, 2);
    assert.strictEqual(inv.items[1].qty, 2);
    assert.strictEqual(inv.items[1].unit, 60);
    assert.strictEqual(inv.client, 'Arun and Priya');
    const days = Math.round((new Date(inv.due) - Date.now()) / 86400000);
    assert.ok(days >= 13 && days <= 14, 'due should be ~14 days, got ' + days);
    assert.ok(!/client|due/i.test(inv.items.map((i) => i.desc).join(' ')), 'descriptions swallowed client/due');
  });
  await t('AI: valid model JSON is accepted and totals recomputed server-side', async () => {
    const { parseInvoice } = require('../src/groq');
    process.env.GROQ_API_KEY = 'test-key';
    const fake = async (url) => url.endsWith('/models') ? { ok: true, json: async () => ({ data: [{ id: 'whisper-large-v3' }, { id: 'openai/gpt-oss-20b' }] }) } : ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ currency: 'MYR', client: 'Arun and Priya', dueDays: 14, total: 999999, items: [{ desc: 'wedding video edit', qty: 1, unit: 800 }, { desc: 'reels', qty: 2, unit: 60 }] }) } }] }) });
    const inv = await parseInvoice('x', fake);
    assert.strictEqual(inv.source, 'ai');
    assert.strictEqual(inv.total, 920);
    assert.strictEqual(inv.client, 'Arun and Priya');
    delete process.env.GROQ_API_KEY;
  });
  await t('AI: garbage, errors, negative or absurd values fall back to rules', async () => {
    const { parseInvoice, sanitizeAiResult } = require('../src/groq');
    process.env.GROQ_API_KEY = 'test-key';
    const bad = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'not json <script>' } }] }) });
    const down = async () => { throw new Error('network'); };
    const http500 = async () => ({ ok: false });
    for (const f of [bad, down, http500]) {
      const inv = await parseInvoice('logo - RM150', f);
      assert.strictEqual(inv.source, 'rules');
      assert.strictEqual(inv.total, 150);
    }
    assert.strictEqual(sanitizeAiResult({ items: [{ desc: 'x', qty: -1, unit: 5 }, { desc: 'y', qty: 1, unit: 1e9 }, { desc: '', qty: 1, unit: 5 }] }), null);
    delete process.env.GROQ_API_KEY;
  });
  await t('PayPal sandbox client: token, create, approve, capture (mocked network, sandbox host only)', async () => {
    const live = require('../src/paypal-live');
    process.env.PAYPAL_CLIENT_ID = 'id'; process.env.PAYPAL_CLIENT_SECRET = 'secret';
    const calls = [];
    const fake = async (url, opts) => {
      calls.push(url);
      if (url.endsWith('/v1/oauth2/token')) return { ok: true, json: async () => ({ access_token: 'tok' }) };
      if (url.endsWith('/v2/checkout/orders')) {
        const body = JSON.parse(opts.body);
        assert.strictEqual(body.purchase_units[0].amount.value, '920.00');
        assert.strictEqual(body.purchase_units[0].amount.currency_code, 'MYR');
        return { ok: true, json: async () => ({ id: 'ORD1', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORD1' }] }) };
      }
      if (url.endsWith('/capture')) return { ok: true, json: async () => ({ status: 'COMPLETED' }) };
      throw new Error('unexpected url ' + url);
    };
    const inv = { currency: 'MYR', total: 920, client: 'Arun and Priya', items: [] };
    const o = await live.createOrder(inv, 'http://127.0.0.1:1', fake);
    assert.strictEqual(o.id, 'ORD1');
    assert.strictEqual(await live.captureOrder('ORD1', fake), null, 'must not capture before approve');
    assert.strictEqual(live.approveOrder('NOPE'), null, 'unknown order id must be refused');
    live.approveOrder('ORD1');
    assert.strictEqual((await live.captureOrder('ORD1', fake)).status, 'COMPLETED');
    assert.ok(calls.every((u) => u.startsWith('https://api-m.sandbox.paypal.com/')), 'only sandbox host may be called');
    delete process.env.PAYPAL_CLIENT_ID; delete process.env.PAYPAL_CLIENT_SECRET;
  });
  await t('PayPal sandbox client: refuses a non-PayPal approve URL', async () => {
    const live = require('../src/paypal-live');
    process.env.PAYPAL_CLIENT_ID = 'id'; process.env.PAYPAL_CLIENT_SECRET = 'secret';
    const evil = async (url) => url.endsWith('/token') || url.endsWith('/oauth2/token')
      ? { ok: true, json: async () => ({ access_token: 't' }) }
      : { ok: true, json: async () => ({ id: 'X', links: [{ rel: 'approve', href: 'https://evil.example/pay' }] }) };
    await assert.rejects(() => live.createOrder({ currency: 'MYR', total: 1 }, 'http://127.0.0.1:1', evil));
    delete process.env.PAYPAL_CLIENT_ID; delete process.env.PAYPAL_CLIENT_SECRET;
  });
  await t('AI: picks a currently available model instead of a hard-coded retired one', async () => {
    const { pickModel } = require('../src/groq');
    delete process.env.GROQ_MODEL;
    const fake = async () => ({ ok: true, json: async () => ({ data: [{ id: 'whisper-large-v3' }, { id: 'meta-llama/llama-guard-4-12b' }, { id: 'openai/gpt-oss-20b' }, { id: 'llama-3.1-8b-instant' }] }) });
    assert.strictEqual(await pickModel('k', fake), 'openai/gpt-oss-20b');
  });
  await t('escapeHtml escapes all five characters', () => {
    assert.strictEqual(escapeHtml('<>&"\''), '&lt;&gt;&amp;&quot;&#39;');
  });
  await t('REGRESSION: script payload in job text is escaped on the mock approval page', async () => {
    const payload = '<script>alert(1)</script> banner - RM10';
    const text = '2 x <img src=x onerror=alert(2)> @ 5\n' + payload;
    const inv = parseJobChat(text);
    const pay = await req(port, 'POST', '/api/pay', { invoice: inv, text });
    assert.strictEqual(pay.status, 200);
    const { approveUrl } = JSON.parse(pay.body);
    const page = await req(port, 'GET', approveUrl);
    assert.strictEqual(page.status, 200);
    assert.ok(!/<script>alert\(1\)/i.test(page.body), 'raw <script> found');
    assert.ok(!/<img src=x/i.test(page.body), 'raw <img> found');
    assert.ok(page.body.includes('&lt;script&gt;'), 'escaped script not present');
  });
  await t('REGRESSION: hostile order id is escaped on approval and return pages', async () => {
    const evil = encodeURIComponent('"><script>alert(3)</script>');
    const a = await req(port, 'GET', '/mock-paypal/approve?token=' + evil);
    assert.ok(!a.body.includes('<script>alert(3)'));
    const r = await req(port, 'GET', '/return?token=' + evil);
    assert.ok(!r.body.includes('<script>alert(3)'));
  });
  await t('full mock flow ends COMPLETED', async () => {
    const text = '3 x banner @ 25';
    const inv = parseJobChat(text);
    const pay = JSON.parse((await req(port, 'POST', '/api/pay', { invoice: inv, text })).body);
    const id = pay.id;
    const done = await req(port, 'GET', '/return?token=' + encodeURIComponent(id));
    assert.ok(done.body.includes('COMPLETED'));
  });
  await t('security headers present', async () => {
    const r = await req(port, 'GET', '/');
    assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
    assert.ok(r.headers['content-security-policy']);
  });

  server.close();
  console.log('\n' + passed + ' tests passed');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
