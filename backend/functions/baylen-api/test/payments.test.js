"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const razorpay = require("../lib/razorpay");
const { createPaymentEngine, metadata } = require("../lib/payment-engine");
const { withPaymentLock } = require("../lib/payment-lock");

function fixture() {
  let seq = 100;
  const tables = { Payments: [], Refunds: [], Payment_Locks: [],
    Orders: [{ ROWID: "1", user_id: "7", grand_total: 100, currency: "INR", status: "PENDING_PAYMENT", payment_status: "PENDING" }],
    Appointments: [], Service_Jobs: [] };
  const app = {
    datastore: () => ({ table: name => ({
      insertRow: async values => {
        if (name === "Payment_Locks" && tables[name].some(r => r.lock_key === values.lock_key)) throw new Error("DUPLICATE_VALUE");
        const row = { ...values, ROWID: String(seq++) }; tables[name].push(row); return { ...row };
      },
      updateRow: async values => {
        const row = tables[name].find(r => String(r.ROWID) === String(values.ROWID));
        assert.ok(row, "row to update exists: " + name);
        Object.assign(row, values); return { ...row };
      },
      deleteRow: async id => { tables[name] = tables[name].filter(r => r.ROWID !== String(id)); },
    }) }),
    zcql: () => ({ executeZCQLQuery: async sql => {
      const table = sql.match(/FROM (\w+)/)[1];
      let result = [...(tables[table] || [])];
      const where = sql.split(' WHERE ')[1]?.split(' ORDER BY ')[0]?.split(' LIMIT ')[0] || '';
      for (const term of where.split(' AND ')) {
        let match = term.match(/^(\w+) = (?:'([^']*)'|(\d+))$/);
        if (match) result = result.filter(r => String(r[match[1]]) === (match[2] ?? match[3]));
        match = term.match(/^(\w+) IN \((.+)\)$/);
        if (match) result = result.filter(r => match[2].split(',').map(v => v.replaceAll("'", '')).includes(r[match[1]]));
      }
      if (sql.includes('ORDER BY ROWID DESC')) result.reverse();
      return result.map(row => ({ [table]: { ...row } }));
    } }),
  };
  const orders = [], attempts = [], refunds = [], calls = [];
  let finalizations = 0, failFinalize = false, uncertainOrder = false, uncertainRefund = false;
  const gateway = {
    ...razorpay,
    credentials: () => ({ key: 'rzp_test_Audit', secret: 'audit-only', mode: 'test' }),
    verifyCheckout: (order, id, signature) => {
      if (!razorpay.checkSignature(order + '|' + id, signature, 'audit-only')) throw razorpay.fail('Bad signature');
    },
    verifyWebhook: (raw, signature) => {
      if (!razorpay.checkSignature(raw, signature, 'webhook-audit')) throw razorpay.fail('Bad webhook');
    },
    request: async (path, options = {}) => {
      calls.push({path, ...options});
      if (path === '/orders') {
        const order = { ...options.body, id: 'order_' + orders.length }; orders.push(order);
        if (uncertainOrder) throw razorpay.fail('timeout', 504);
        return order;
      }
      if (path.startsWith('/orders?receipt=')) return {items:orders};
      if (path.startsWith('/orders/') && path.endsWith('/payments')) return {items:attempts};
      if (path.endsWith('/refunds')) return {items:refunds};
      if (path.endsWith('/refund')) {
        const refund = { ...options.body, id: 'rfnd_' + refunds.length, payment_id: 'pay_1', status: 'processed' };
        refunds.push(refund); attempts[0].amount_refunded = refund.amount; attempts[0].status = 'refunded';
        if (uncertainRefund) throw razorpay.fail('timeout', 504);
        return refund;
      }
      if (path.startsWith('/refunds/')) return refunds.find(r => r.id === path.split('/').pop());
      if (path.startsWith('/payments/')) return attempts[0];
      throw new Error('Unexpected gateway request: ' + path);
    },
  };
  const engine = createPaymentEngine({ gateway, lock: withPaymentLock, finalize: async (_, row) => {
    finalizations++;
    if (failFinalize) throw new Error('Simulated database unavailable');
    const ref = tables[row.reference_type === 'JOB' ? 'Service_Jobs' : 'Orders'].find(r => r.ROWID === row.reference_id);
    Object.assign(ref, {payment_status:'PAID',status:'CONFIRMED'});
  } });
  return {app,tables,engine,calls,attempts,orders,refunds,
    get finalizations(){return finalizations;},
    set failFinalize(v){failFinalize=v;}, set uncertainOrder(v){uncertainOrder=v;}, set uncertainRefund(v){uncertainRefund=v;},
    capture(row) {attempts.push({id:'pay_1',order_id:row.provider_order_id,amount:10000,currency:'INR',status:'captured',amount_refunded:0});}
  };
}

test('gateway signature rejects missing secret, bad encoding and tampering', () => {
  assert.equal(razorpay.checkSignature('a', '0'.repeat(64), ''), false);
  assert.equal(razorpay.checkSignature('a', 'x'.repeat(64), 'secret'), false);
  const sig = crypto.createHmac('sha256', 'secret').update('a').digest('hex');
  assert.equal(razorpay.checkSignature('a', sig, 'secret'), true);
  assert.equal(razorpay.checkSignature('b', sig, 'secret'), false);
});
test('credentials fail closed instead of accepting empty-key signatures', () => {
  const before = process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_KEY_SECRET;
  try { assert.throws(() => razorpay.verifyCheckout('order_1','pay_1','0'.repeat(64)), /unavailable/); }
  finally { if (before !== undefined) process.env.RAZORPAY_KEY_SECRET = before; }
});
test('repeated creation reuses the same gateway order and payment record', async () => {
  const f=fixture(); const a=await f.engine.create(f.app,'7','ORDER','1');
  const b=await f.engine.create(f.app,'7','ORDER','1');
  assert.equal(a.ROWID,b.ROWID); assert.equal(f.orders.length,1);
  assert.equal(f.tables.Payments[0].source_id,'1');
  assert.equal(f.tables.Payments[0].source_type,'ORDER');
});
test('concurrent creations serialize through a unique persistent lock', async () => {
  const f=fixture(); const results=await Promise.allSettled([f.engine.create(f.app,'7','ORDER','1'),f.engine.create(f.app,'7','ORDER','1')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1); assert.equal(f.orders.length,1);
  assert.equal(f.tables.Payment_Locks.length,0);
});
test('timed-out order creation is recovered by receipt, never blindly recreated', async () => {
  const f=fixture(); f.uncertainOrder=true;
  await assert.rejects(f.engine.create(f.app,'7','ORDER','1'),/timeout/);
  const row=await f.engine.create(f.app,'7','ORDER','1');
  assert.equal(row.provider_order_id,'order_0'); assert.equal(f.orders.length,1);
});
test('another customer cannot create or read the payment', async () => {
  const f=fixture(); await assert.rejects(f.engine.create(f.app,'8','ORDER','1'),/not found/);
  const row=await f.engine.create(f.app,'7','ORDER','1');
  await assert.rejects(f.engine.load(f.app,row.ROWID,'8'),/not found/);
});
test('authorized, failed and empty attempts do not confirm a purchase', async () => {
  const f=fixture(); const row=await f.engine.create(f.app,'7','ORDER','1');
  for (const status of ['authorized','failed']) {
    f.attempts.splice(0, f.attempts.length, {id:'pay_1',order_id:row.provider_order_id,amount:10000,currency:'INR',status});
    const result=await f.engine.reconcile(f.app,row.ROWID,'7');
    assert.equal(result.status,status==='failed'?'FAILED':'PENDING');
  }
  assert.equal(f.finalizations,0);
});
test('captured payment validates amount, currency and provider order', async () => {
  for (const override of [{amount:1},{currency:'USD'},{order_id:'order_other'}]) {
    const f=fixture(); const row=await f.engine.create(f.app,'7','ORDER','1'); f.capture(row);
    Object.assign(f.attempts[0],override);
    await assert.rejects(f.engine.reconcile(f.app,row.ROWID,'7'),/does not match/);
    assert.equal(f.finalizations,0);
  }
});
test('captured payments finalize once on repeat status checks', async () => {
  const f=fixture(); const row=await f.engine.create(f.app,'7','ORDER','1'); f.capture(row);
  const a=await f.engine.reconcile(f.app,row.ROWID,'7');
  await f.engine.reconcile(f.app,row.ROWID,'7');
  assert.equal(a.status,'SUCCESS'); assert.equal(metadata(a).finalized,true); assert.equal(f.finalizations,1);
});
test('a crash during finalization is retried without a second charge', async () => {
  const f=fixture(); const row=await f.engine.create(f.app,'7','ORDER','1'); f.capture(row); f.failFinalize=true;
  await assert.rejects(f.engine.reconcile(f.app,row.ROWID,'7'),/database/);
  f.failFinalize=false; const result=await f.engine.reconcile(f.app,row.ROWID,'7');
  assert.equal(metadata(result).finalized,true); assert.equal(f.orders.length,1); assert.equal(f.finalizations,2);
});
test('late payment after cancellation requests refund and never reopens the purchase', async () => {
  const f=fixture(); const row=await f.engine.create(f.app,'7','ORDER','1'); f.capture(row);
  f.tables.Orders[0].status='CANCELLED';
  const result=await f.engine.reconcile(f.app,row.ROWID,'7');
  assert.equal(result.status,'REFUND_REQUESTED'); assert.equal(f.finalizations,0); assert.equal(f.tables.Refunds.length,1);
});
test('refund request, approval and gateway completion persist distinct states', async () => {
  const f=fixture(); const row=await f.engine.create(f.app,'7','ORDER','1'); f.capture(row);
  await f.engine.reconcile(f.app,row.ROWID,'7');
  const refund=await f.engine.requestRefund(f.app,row.ROWID,'7','Changed my mind');
  assert.equal(refund.status,'REQUESTED'); assert.equal(f.refunds.length,0);
  const done=await f.engine.processRefund(f.app,refund.ROWID);
  assert.equal(done.status,'PROCESSED'); assert.equal(f.tables.Payments[0].status,'REFUNDED');
  assert.equal(f.calls.find(c=>c.path.endsWith('/refund')).headers['X-Refund-Idempotency'],'baylen-refund-'+refund.ROWID);
});
test('lost refund response is recovered without issuing another refund', async () => {
  const f=fixture(); const row=await f.engine.create(f.app,'7','ORDER','1'); f.capture(row);
  await f.engine.reconcile(f.app,row.ROWID,'7');
  const refund=await f.engine.requestRefund(f.app,row.ROWID,'7','Cancel'); f.uncertainRefund=true;
  await assert.rejects(f.engine.processRefund(f.app,refund.ROWID),/timeout/);
  await f.engine.processRefund(f.app,refund.ROWID);
  assert.equal(f.refunds.length,1); assert.equal(f.tables.Refunds[0].status,'PROCESSED');
});
test('invalid webhook is rejected before datastore writes', async () => {
  const f=fixture();
  await assert.rejects(f.engine.webhook(f.app,{},{},'bad'),/webhook/);
  assert.equal(f.tables.Payments.length,0);
});
test('duplicate signed webhooks do not finalize twice', async () => {
  const f=fixture(); const row=await f.engine.create(f.app,'7','ORDER','1'); f.capture(row);
  const body={event:'payment.captured',payload:{payment:{entity:f.attempts[0]}}};
  const raw=Buffer.from(JSON.stringify(body));
  const signature=crypto.createHmac('sha256','webhook-audit').update(raw).digest('hex');
  await f.engine.webhook(f.app,body,raw,signature); await f.engine.webhook(f.app,body,raw,signature);
  assert.equal(f.finalizations,1);
});
test('home service confirmation rejects a booking without verified payment', async () => {
  const f=fixture(); f.tables.Service_Jobs.push({ROWID:'2',user_id:'7',status:'REQUESTED',grand_total:100,currency:'INR'});
  const { confirmPaidBooking }=require('../lib/at-home-beauty-engine');
  await assert.rejects(confirmPaidBooking(f.app,'2',{user_id:'7'}),/not yet verified/);
  assert.equal(f.tables.Service_Jobs[0].status,'REQUESTED');
});

test('split delivery children cannot be paid independently of their parent', async () => {
  const f=fixture(); f.tables.Orders[0].parent_order_id='9';
  await assert.rejects(f.engine.create(f.app,'7','ORDER','1'),/main order/);
  assert.equal(f.orders.length,0);
});

test('cancelled home service queues one refund without transferring money', async () => {
  const f=fixture();
  f.tables.Service_Jobs.push({ROWID:'2',user_id:'7',status:'REQUESTED',grand_total:100,currency:'INR'});
  const row=await f.engine.create(f.app,'7','JOB','2'); f.capture(row);
  await f.engine.reconcile(f.app,row.ROWID,'7');
  f.tables.Service_Jobs[0].status='CANCELLED';
  await f.engine.queueCancelledRefunds(f.app,'7','JOB','2','Cancel');
  await f.engine.queueCancelledRefunds(f.app,'7','JOB','2','Cancel');
  assert.equal(f.tables.Refunds.length,1); assert.equal(f.refunds.length,0);
  assert.equal(f.tables.Payments[0].status,'REFUND_REQUESTED');
});

test('a refunded duplicate never marks the fulfilled original order refunded', async () => {
  const f=fixture(); const row=await f.engine.create(f.app,'7','ORDER','1'); f.capture(row);
  await f.engine.reconcile(f.app,row.ROWID,'7');
  f.tables.Payments.push({...f.tables.Payments[0],ROWID:'999',provider_order_id:'order_duplicate',
    provider_payment_id:'pay_2',metadata:JSON.stringify({verified:true,key:'rzp_test_Audit'})});
  f.attempts.splice(0,1,{id:'pay_2',order_id:'order_duplicate',amount:10000,currency:'INR',status:'refunded',amount_refunded:10000});
  const duplicate=await f.engine.reconcile(f.app,'999','7');
  assert.equal(duplicate.status,'REFUNDED'); assert.equal(f.tables.Orders[0].payment_status,'PAID');
  assert.equal(f.tables.Payments[0].status,'SUCCESS');
});

test('partial refund updates the parent without inventing a child refund allocation', async () => {
  const f=fixture(); const row=await f.engine.create(f.app,'7','ORDER','1'); f.capture(row);
  await f.engine.reconcile(f.app,row.ROWID,'7');
  f.tables.Orders.push({ROWID:'2',parent_order_id:'1',payment_status:'PAID',status:'DELIVERED'});
  f.attempts[0].amount_refunded=2000;
  const result=await f.engine.reconcile(f.app,row.ROWID,'7');
  assert.equal(result.status,'PARTIALLY_REFUNDED');
  assert.equal(f.tables.Orders[0].payment_status,'PARTIALLY_REFUNDED');
  assert.equal(f.tables.Orders[1].payment_status,'PAID');
  assert.equal(f.tables.Orders[1].status,'DELIVERED');
});

test('checkout tickets reject tampering and expiration', () => {
  const key=process.env.RAZORPAY_KEY_ID, secret=process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_KEY_ID='rzp_test_Audit'; process.env.RAZORPAY_KEY_SECRET='ticket-only';
  try {
    const value=razorpay.ticket({ROWID:'123'});
    assert.equal(razorpay.readTicket(value),'123');
    assert.throws(()=>razorpay.readTicket(value+'x'),/invalid|expired/);
    const payload=Buffer.from(JSON.stringify({payment_id:'123',purpose:'baylen-checkout',exp:1})).toString('base64url');
    const sig=crypto.createHmac('sha256','ticket-only').update(payload).digest('hex');
    assert.throws(()=>razorpay.readTicket(payload+'.'+sig),/expired/);
  } finally {
    if (key===undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID=key;
    if (secret===undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET=secret;
  }
});
