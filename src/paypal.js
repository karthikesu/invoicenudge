'use strict';
// MOCK PayPal client. Same response SHAPE as Orders v2 (id, status, links[approve]),
// but nothing leaves this machine. No account, no key, no network.
// Swapping in the real sandbox later means replacing this one file.

const crypto = require('crypto');

const orders = new Map(); // id -> { status, invoice }

function createOrder(invoice) {
  const id = 'MOCK-' + crypto.randomBytes(6).toString('hex').toUpperCase();
  orders.set(id, { status: 'CREATED', invoice });
  return {
    id,
    status: 'CREATED',
    links: [{ rel: 'approve', href: '/mock-paypal/approve?token=' + id }],
  };
}

function getOrder(id) {
  return orders.get(String(id)) || null;
}

function approveOrder(id) {
  const o = orders.get(String(id));
  if (!o) return null;
  o.status = 'APPROVED';
  return o;
}

function captureOrder(id) {
  const o = orders.get(String(id));
  if (!o || o.status !== 'APPROVED') return null;
  o.status = 'COMPLETED';
  return { id: String(id), status: 'COMPLETED' };
}

module.exports = { createOrder, getOrder, approveOrder, captureOrder };
