'use strict';
// Rule-based stand-in for the AI step. No key, no network.
// Turns a messy job chat into a clean invoice object.

const MAX_LINES = 50;

function money(n) {
  return Math.round(n * 100) / 100;
}

function parseNumber(s) {
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function detectCurrency(text) {
  if (/\bUSD\b|\$/i.test(text)) return 'USD';
  return 'MYR';
}

function parseJobChat(text) {
  const raw = String(text || '').slice(0, 5000);
  const currency = detectCurrency(raw);
  const items = [];
  const lines = raw.split(/\r?\n/).slice(0, MAX_LINES);
  const num = '(\\d+(?:[.,]\\d+)?)';
  const cur = '(?:RM|MYR|USD|\\$)?\\s*';

  // client + due-date clauses (also inside a sentence of a one-line chat message)
  let client = '';
  let dueDaysFound = null;
  const cleanedLines = lines.map((l) => {
    let x = l;
    const cm = x.match(/\bclients?\s*[:=-]\s*(.+?)(?=\s*(?:[.;]\s|[.;]$|$|\bdue\b))/i);
    if (cm && !client) { client = cm[1].trim().replace(/[.;,]+$/, '').slice(0, 80); x = x.replace(cm[0], ' '); }
    const dm = x.match(/\bdue\s+(?:in\s+)?(\d{1,3})\s*(day|week|month)s?\b/i);
    if (dm && dueDaysFound === null) {
      dueDaysFound = Number(dm[1]) * ({ day: 1, week: 7, month: 30 }[dm[2].toLowerCase()]);
      x = x.replace(dm[0], ' ');
    }
    return x;
  });

  const segments = [];
  for (const line0 of cleanedLines) {
    let line = line0.trim();
    if (!line) continue;
    // strip chat prefixes like "[10:32] Ali:" or "10:32 - Ali:" and bullets/numbering
    line = line.replace(/^\[?\d{1,2}[:.]\d{2}(?:\s*[ap]m)?[^\]:]*\]?\s*[-,]?\s*[\w .]{1,30}:\s*/i, '');
    line = line.replace(/^(?:[-*•]+|\d{1,2}[.)])\s+/, '');
    // split "logo RM300, banner RM620" into separate items (not thousands commas)
    for (const sent of line.split(/(?<=[.!?])\s+/)) {
      for (const part of sent.split(/\s*[;,]\s*(?=[A-Za-z])|\s*,?\s+also\s+|\s*\band\s+(?=\d+\s*x\b)/i)) {
        if (part && part.trim()) segments.push(part.trim().replace(/[.]+$/, '').replace(/^(?:also|and|plus)\s+/i, ''));
      }
    }
  }

  const amountRe = /(?:RM|MYR|USD|\$)\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:RM|MYR)\b/i;
  for (const line of segments) {
    if (/deposit/i.test(line)) continue; // deposits are not billable lines
    if (/^\s*(?:grand\s+)?(?:sub\s*)?total\b|^\s*balance\b/i.test(line)) continue; // avoid double counting

    let m;
    // "3 x banner @ 25" / "2x banner @ RM50 each"
    if ((m = line.match(new RegExp('^' + num + '\\s*x\\s*(.+?)\\s*(?:@|\\bat\\b)\\s*' + cur + num + '(?:\\s*(?:each|ea|/\\s*(?:pc|unit)))?\\s*$', 'i')))) {
      const qty = parseNumber(m[1]);
      const unit = parseNumber(m[3]);
      if (qty && unit !== null) items.push({ desc: m[2].trim(), qty, unit: money(unit) });
      continue;
    }
    // "banner x2 @ 50"
    if ((m = line.match(new RegExp('^(.+?)\\s*x\\s*' + num + '\\s*@\\s*' + cur + num + '(?:\\s*(?:each|ea))?\\s*$', 'i')))) {
      const qty = parseNumber(m[2]);
      const unit = parseNumber(m[3]);
      if (qty && unit !== null) items.push({ desc: m[1].trim(), qty, unit: money(unit) });
      continue;
    }
    // "2 hours @ 40/hr" or "2 hrs logo work @ 40"
    if ((m = line.match(new RegExp('^' + num + '\\s*(?:hours?|hrs?)\\s*(.*?)\\s*@\\s*' + cur + num + '(?:\\s*/\\s*h(?:ou)?r)?\\s*$', 'i')))) {
      const qty = parseNumber(m[1]);
      const unit = parseNumber(m[3]);
      const label = (m[2] || 'Work').trim() || 'Work';
      if (qty && unit !== null) items.push({ desc: label + ' (hours)', qty, unit: money(unit) });
      continue;
    }
    // "logo design - RM150" / "logo design: 150"
    if ((m = line.match(new RegExp('^(.+?)\\s*[-:=]\\s*' + cur + num + '\\s*$', 'i')))) {
      const unit = parseNumber(m[2]);
      if (unit !== null) items.push({ desc: m[1].trim(), qty: 1, unit: money(unit) });
      continue;
    }
    if ((m = line.match(new RegExp('^(.+?)\\s+' + cur + num + '\\s*$', 'i')))) {
      const unit = parseNumber(m[2]);
      if (unit !== null && /[a-z]/i.test(m[1])) items.push({ desc: m[1].trim(), qty: 1, unit: money(unit) });
      continue;
    }
    // Fallback: one clear money amount anywhere in the line ("Logo RM300 done", "RM300 for logo", "poster = RM1,020 (rush)")
    const all = line.match(new RegExp(amountRe.source, 'gi')) || [];
    if (all.length === 1 && (m = line.match(amountRe))) {
      const unit = parseNumber(m[1] || m[2]);
      const desc = line.replace(amountRe, ' ').replace(/\([^)]*\)/g, ' ').replace(/^\s*(?:for|-|:|=)\s+|\s+(?:for|done|paid|only)\s*$|[-:=]\s*$/gi, ' ').replace(/\s+/g, ' ').trim();
      if (unit !== null && /[a-z]/i.test(desc)) items.push({ desc, qty: 1, unit: money(unit) });
    }
  }

  const lineItems = items.map((it) => ({ ...it, total: money(it.qty * it.unit) }));
  const total = money(lineItems.reduce((s, it) => s + it.total, 0));
  const dueDays = dueDaysFound !== null ? dueDaysFound : 7;
  const due = new Date(Date.now() + dueDays * 86400000).toISOString().slice(0, 10);

  return {
    currency,
    client,
    items: lineItems,
    total,
    due,
    note: 'Thank you for your business. A quick payment by the due date is much appreciated.',
  };
}

module.exports = { parseJobChat };
