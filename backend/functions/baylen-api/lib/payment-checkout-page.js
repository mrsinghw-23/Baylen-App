"use strict";

const crypto = require("node:crypto");
const gateway = require("./razorpay");

function checkoutPage(req, res, payment) {
  const options = JSON.stringify({ key: gateway.credentials().key, order_id: payment.provider_order_id,
    amount: gateway.minorUnits(payment.amount), currency: payment.currency, name: "Baylen",
    description: "Baylen " + payment.reference_type.toLowerCase(), timeout: 900,
    retry: { enabled: false }, theme: { color: "#E82F79" } }).replace(/</g, "\\u003c");
  const ticket = JSON.stringify(req.query.pay_link).replace(/</g, "\\u003c");
  const nonce = crypto.randomBytes(18).toString("base64");
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; script-src 'nonce-" + nonce + "' https://checkout.razorpay.com https://*.razorpay.com; style-src 'unsafe-inline' https:; img-src https: data:; frame-src https:; connect-src 'self' https://*.razorpay.com https://*.razorpay.in; frame-ancestors 'none'" });
  res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baylen Payment</title>
<style>body{margin:0;background:#101014;color:#fff;font:16px system-ui;display:grid;min-height:100dvh;place-items:center}main{max-width:420px;padding:24px;text-align:center}h1{font-size:28px}button{background:#e82f79;color:#fff;border:0;border-radius:8px;padding:16px 28px;font:inherit;cursor:pointer}button:disabled{opacity:.6}p{line-height:1.6}#state{min-height:76px}</style></head>
<body><main><h1>Baylen</h1><p>INR ${Number(payment.amount).toFixed(2)}</p><p id="state" role="status" aria-live="polite">Ready for payment</p><button id="pay">Pay securely</button><p>You can return to Baylen to check payment status.</p></main>
<script nonce="${nonce}" src="https://checkout.razorpay.com/v1/checkout.js"></script><script nonce="${nonce}">
const button=document.getElementById('pay'), state=document.getElementById('state');
button.onclick=()=>{if(typeof Razorpay!=='function'){state.textContent='Payment checkout could not load. Check your connection and reload.';return;}
button.disabled=true;const options=${options};
options.handler=async result=>{state.textContent='Verifying payment...';try{const response=await fetch('/v1/payments/checkout-complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:${ticket},provider_payment_id:result.razorpay_payment_id,provider_signature:result.razorpay_signature})});const data=await response.json();if(!response.ok)throw new Error();state.textContent=data.data.payment.status==='SUCCESS'?'Payment received. Return to Baylen.':'Payment is being confirmed. Return to Baylen to check its status.';}catch(_){state.textContent='Confirmation is pending. Return to Baylen and check payment status before paying again.';}};
options.modal={ondismiss:()=>{state.textContent='Checkout closed. Check payment status in Baylen before retrying.';button.disabled=false;}};
const checkout=new Razorpay(options);checkout.on('payment.failed',()=>{state.textContent='Payment attempt failed. Return to Baylen to check status or retry.';button.disabled=false;});checkout.open();};
</script></body></html>`);
}

module.exports = { checkoutPage };
