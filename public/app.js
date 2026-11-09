'use strict';
// All user-derived text is written with textContent, never innerHTML.
(function () {
  var out = document.getElementById('out');
  var current = null;
  var lastText = '';

  function el(tag, text) {
    var e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function render(inv) {
    out.textContent = '';
    if (!inv.items.length) { out.appendChild(el('p', 'No billable lines found.')); return; }
    var label = inv.currency === 'USD' ? 'USD' : 'RM';
    var t = el('table');
    var head = el('tr');
    ['Item', 'Qty', 'Price', 'Amount'].forEach(function (h) { head.appendChild(el('th', h)); });
    t.appendChild(head);
    inv.items.forEach(function (it) {
      var r = el('tr');
      [it.desc, String(it.qty), it.unit.toFixed(2), it.total.toFixed(2)].forEach(function (c) { r.appendChild(el('td', c)); });
      t.appendChild(r);
    });
    out.appendChild(t);
    if (inv.client) out.appendChild(el('p', 'Client: ' + inv.client));
    out.appendChild(el('p', 'Total: ' + label + ' ' + inv.total.toFixed(2) + '   Due: ' + inv.due));
    out.appendChild(el('p', inv.note));
    out.appendChild(el('p', 'Parsed by: ' + (inv.source === 'ai' ? 'AI (Groq)' : 'rules (fallback)') + '  |  Payments: ' + (inv.mode || 'mock')));
    var pay = el('button', 'Pay with PayPal (' + (inv.mode === 'PayPal SANDBOX' ? 'sandbox test' : 'mock') + ')');
    pay.addEventListener('click', function () {
      fetch('/api/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice: current, text: lastText }) })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d.approveUrl) window.location.href = d.approveUrl; });
    });
    out.appendChild(pay);
  }

  document.getElementById('make').addEventListener('click', function () {
    lastText = document.getElementById('chat').value;
    fetch('/api/invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: lastText }) })
      .then(function (r) { return r.json(); })
      .then(function (inv) { current = inv; render(inv); });
  });
})();
