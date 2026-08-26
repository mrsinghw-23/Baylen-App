const crypto = require("crypto");
const { asId, optionalText, rowOf, rowsOf, num, sendOk } = require("../lib/http");
const { requireUser } = require("../lib/session");

const REFERENCE_TABLES = {
  ORDER: {
    table: "Orders",
    totalField: "grand_total",
    userField: "user_id",
  },
  APPOINTMENT: {
    table: "Appointments",
    totalField: "grand_total",
    userField: "user_id",
  },
  JOB: {
    table: "Service_Jobs",
    totalField: "grand_total",
    userField: "user_id",
  },
};

function normalizeReferenceType(value) {
  const type = String(value || "").trim().toUpperCase();
  if (!REFERENCE_TABLES[type]) {
    const error = new Error("reference_type must be ORDER, APPOINTMENT, or JOB");
    error.status = 400;
    throw error;
  }
  return type;
}

function mapPayment(row) {
  return {
    id: String(row.ROWID),
    reference_type: row.reference_type || "",
    reference_id: row.reference_id ? String(row.reference_id) : "",
    provider: row.provider || "",
    provider_order_id: row.provider_order_id || "",
    provider_payment_id: row.provider_payment_id || "",
    amount: num(row.amount),
    currency: row.currency || "INR",
    status: row.status || "PENDING",
    metadata: row.metadata || "",
  };
}

function providerStatus() {
  return {
    manual: { enabled: true },
    razorpay: {
      enabled: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
      public_key: process.env.RAZORPAY_KEY_ID || "",
    },
    cashfree: {
      enabled: Boolean(process.env.CASHFREE_CLIENT_ID && process.env.CASHFREE_CLIENT_SECRET),
      public_key: process.env.CASHFREE_CLIENT_ID || "",
    },
  };
}

async function loadReference(req, user, referenceType, referenceId) {
  const meta = REFERENCE_TABLES[referenceType];
  const zcql = req.catalystApp.zcql();
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, " +
        meta.userField +
        ", " +
        meta.totalField +
        ", currency, payment_status FROM " +
        meta.table +
        " WHERE ROWID = " +
        referenceId +
        " AND " +
        meta.userField +
        " = " +
        user.user_id
    ),
    meta.table
  );
  if (!row) {
    const error = new Error("Payment reference not found");
    error.status = 404;
    throw error;
  }
  return row;
}

async function loadPaymentCustomer(req, user) {
  try {
    const row = rowOf(
      await req.catalystApp
        .zcql()
        .executeZCQLQuery(
          "SELECT full_name, mobile, email FROM User_Profiles WHERE user_id = " +
            user.user_id +
            " AND is_active = true"
        ),
      "User_Profiles"
    );
    return {
      id: String(user.user_id),
      name: row?.full_name || [user.first_name, user.last_name].filter(Boolean).join(" "),
      email: row?.email || user.email || "customer@baylen.app",
      phone: row?.mobile || "9999999999",
    };
  } catch (_) {
    return {
      id: String(user.user_id),
      name: [user.first_name, user.last_name].filter(Boolean).join(" "),
      email: user.email || "customer@baylen.app",
      phone: "9999999999",
    };
  }
}

async function createRazorpayOrder(amount, currency, receipt, notes) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    const error = new Error("RAZORPAY payment provider is not configured");
    error.status = 503;
    throw error;
  }
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(keyId + ":" + keySecret).toString("base64"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: Math.round(amount * 100),
      currency,
      receipt: receipt.slice(0, 40),
      notes,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.description || "Razorpay order creation failed");
    error.status = 502;
    throw error;
  }
  return {
    provider_order_id: data.id || "",
    metadata: JSON.stringify({ razorpay_order: data }),
  };
}

async function createCashfreeOrder(amount, currency, receipt, customer) {
  const clientId = process.env.CASHFREE_CLIENT_ID;
  const clientSecret = process.env.CASHFREE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const error = new Error("CASHFREE payment provider is not configured");
    error.status = 503;
    throw error;
  }
  const production = String(process.env.CASHFREE_ENV || "").toUpperCase() === "PRODUCTION";
  const baseUrl = production ? "https://api.cashfree.com/pg/orders" : "https://sandbox.cashfree.com/pg/orders";
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-version": process.env.CASHFREE_API_VERSION || "2023-08-01",
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
    },
    body: JSON.stringify({
      order_id: receipt.slice(0, 45),
      order_amount: amount,
      order_currency: currency,
      customer_details: {
        customer_id: customer.id,
        customer_name: customer.name || "Baylen Customer",
        customer_email: customer.email,
        customer_phone: customer.phone,
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "Cashfree order creation failed");
    error.status = 502;
    throw error;
  }
  return {
    provider_order_id: data.order_id || receipt,
    metadata: JSON.stringify({
      cashfree_order: data,
      payment_session_id: data.payment_session_id || "",
    }),
  };
}

async function createProviderOrder(req, user, provider, referenceType, referenceId, amount, currency) {
  const receipt = ("baylen_" + referenceType.toLowerCase() + "_" + referenceId + "_" + Date.now()).slice(0, 45);
  if (provider === "RAZORPAY") {
    return createRazorpayOrder(amount, currency, receipt, {
      reference_type: referenceType,
      reference_id: String(referenceId),
      user_id: String(user.user_id),
    });
  }
  if (provider === "CASHFREE") {
    return createCashfreeOrder(amount, currency, receipt, await loadPaymentCustomer(req, user));
  }
  return { provider_order_id: null, metadata: null };
}

async function updateReferencePayment(req, referenceType, referenceId, paymentStatus) {
  const meta = REFERENCE_TABLES[referenceType];
  await req.catalystApp.datastore().table(meta.table).updateRow({
    ROWID: referenceId,
    payment_status: paymentStatus,
  });
}

function paymentsRoutes(app) {
  app.get("/v1/payments/providers", async (req, res, next) => {
    try {
      sendOk(res, { providers: providerStatus() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/payments/intent", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const referenceType = normalizeReferenceType(req.body.reference_type);
      const referenceId = asId(req.body.reference_id, "reference_id");
      const provider = (optionalText(req.body.provider, "provider", 40) || "MANUAL").toUpperCase();
      const providers = providerStatus();
      if (provider !== "MANUAL" && !providers[provider.toLowerCase()]?.enabled) {
        const error = new Error(provider + " payment provider is not configured");
        error.status = 503;
        throw error;
      }
      const reference = await loadReference(req, user, referenceType, referenceId);
      const amount = num(reference.grand_total);
      if (amount <= 0) {
        const error = new Error("Payment amount must be greater than zero");
        error.status = 400;
        throw error;
      }
      const currency = reference.currency || "INR";
      const providerOrder = await createProviderOrder(
        req,
        user,
        provider,
        referenceType,
        referenceId,
        amount,
        currency
      );

      const inserted = await req.catalystApp.datastore().table("Payments").insertRow({
        user_id: user.user_id,
        reference_type: referenceType,
        reference_id: referenceId,
        provider,
        provider_order_id: providerOrder.provider_order_id,
        provider_payment_id: null,
        amount,
        currency,
        status: "PENDING",
        metadata:
          providerOrder.metadata || optionalText(req.body.metadata, "metadata", 1000) || null,
      });

      await updateReferencePayment(req, referenceType, referenceId, "PENDING");
      sendOk(res, {
        payment: mapPayment({
          ...inserted,
          reference_type: referenceType,
          reference_id: referenceId,
          provider,
          provider_order_id: providerOrder.provider_order_id,
          amount,
          currency,
          status: "PENDING",
          metadata: providerOrder.metadata || "",
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/payments/verify", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const paymentId = asId(req.body.payment_id, "payment_id");
      const providerPaymentId = optionalText(
        req.body.provider_payment_id,
        "provider_payment_id",
        200
      );
      const providerSignature = optionalText(
        req.body.provider_signature,
        "provider_signature",
        500
      );
      const status = String(req.body.status || "").trim().toUpperCase();
      const allowed = ["SUCCESS", "FAILED", "PENDING", "REFUNDED"];
      if (!allowed.includes(status)) {
        const error = new Error("status must be SUCCESS, FAILED, PENDING, or REFUNDED");
        error.status = 400;
        throw error;
      }
      const zcql = req.catalystApp.zcql();
      const row = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, reference_type, reference_id, provider, provider_order_id, amount, currency, status, metadata FROM Payments WHERE ROWID = " +
            paymentId +
            " AND user_id = " +
            user.user_id
        ),
        "Payments"
      );
      if (!row) {
        const error = new Error("Payment not found");
        error.status = 404;
        throw error;
      }
      if (row.provider === "RAZORPAY" && status === "SUCCESS") {
        const expected = crypto
          .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
          .update(String(row.provider_order_id || "") + "|" + providerPaymentId)
          .digest("hex");
        const valid =
          providerSignature &&
          expected.length === providerSignature.length &&
          crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(providerSignature));
        if (!valid) {
          const error = new Error("Razorpay payment signature verification failed");
          error.status = 400;
          throw error;
        }
      }

      await req.catalystApp.datastore().table("Payments").updateRow({
        ROWID: row.ROWID,
        provider_payment_id: providerPaymentId || null,
        status,
      });
      const paymentStatus = status === "SUCCESS" ? "PAID" : status;
      await updateReferencePayment(
        req,
        normalizeReferenceType(row.reference_type),
        asId(row.reference_id, "reference_id"),
        paymentStatus
      );

      sendOk(res, {
        payment: mapPayment({
          ...row,
          provider_payment_id: providerPaymentId,
          status,
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/payments", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const zcql = req.catalystApp.zcql();
      if (req.query.id) {
        const paymentId = asId(req.query.id, "id");
        const row = rowOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, reference_type, reference_id, provider, provider_order_id, provider_payment_id, amount, currency, status FROM Payments WHERE ROWID = " +
              paymentId +
              " AND user_id = " +
              user.user_id
          ),
          "Payments"
        );
        if (!row) {
          const error = new Error("Payment not found");
          error.status = 404;
          throw error;
        }
        sendOk(res, { payment: mapPayment(row) });
        return;
      }
      const rows = await zcql.executeZCQLQuery(
        "SELECT ROWID, reference_type, reference_id, provider, provider_order_id, provider_payment_id, amount, currency, status FROM Payments WHERE user_id = " +
          user.user_id
      );
      sendOk(res, {
        payments: (Array.isArray(rows) ? rows : []).map((item) =>
          mapPayment(item.Payments || item)
        ),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/payments/refund-request", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const paymentId = asId(req.body.payment_id, "payment_id");
      const reason = optionalText(req.body.reason, "reason", 255);
      if (!reason) {
        const error = new Error("reason is required");
        error.status = 400;
        throw error;
      }
      const zcql = req.catalystApp.zcql();
      const payment = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, reference_type, reference_id, provider, amount, currency, status FROM Payments WHERE ROWID = " +
            paymentId +
            " AND user_id = " +
            user.user_id
        ),
        "Payments"
      );
      if (!payment) {
        const error = new Error("Payment not found");
        error.status = 404;
        throw error;
      }
      if (payment.status !== "SUCCESS") {
        const error = new Error("Refund can be requested only for successful payments");
        error.status = 409;
        throw error;
      }
      const existing = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID FROM Refunds WHERE user_id = " +
            user.user_id +
            " AND reference_type = " +
            "'" +
            String(payment.reference_type || "").replace(/'/g, "''") +
            "'" +
            " AND reference_id = " +
            asId(payment.reference_id, "reference_id") +
            " AND status IN ('REQUESTED','PROCESSING')"
        ),
        "Refunds"
      );
      if (existing.length > 0) {
        const error = new Error("A refund request is already open");
        error.status = 409;
        throw error;
      }
      await req.catalystApp.datastore().table("Refunds").insertRow({
        user_id: user.user_id,
        reference_type: payment.reference_type,
        reference_id: payment.reference_id,
        payment_id: payment.ROWID,
        amount: num(payment.amount),
        currency: payment.currency || "INR",
        reason,
        status: "REQUESTED",
      });
      await req.catalystApp.datastore().table("Payments").updateRow({
        ROWID: payment.ROWID,
        status: "REFUND_REQUESTED",
      });
      await updateReferencePayment(
        req,
        normalizeReferenceType(payment.reference_type),
        asId(payment.reference_id, "reference_id"),
        "REFUND_PENDING"
      );
      sendOk(res, { requested: true });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = paymentsRoutes;
