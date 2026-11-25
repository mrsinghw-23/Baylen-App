"use strict";

const { asId, rowOf, rowsOf, num, sendOk } = require("../lib/http");
const { requireUser } = require("../lib/session");
const { reserveStock, releaseReservation, commitReservation } = require("../lib/inventory-ops");
const { evaluateFulfillment } = require("../lib/fulfillment-engine");
const {
  resolveCheckoutPlan,
  apportionTotals,
  groupTotals,
  moneySafe,
} = require("../lib/hybrid-checkout");
const {
  validateCheckoutCart,
  normalizePaymentMethod,
  gatewayProviderFor,
  nextOrderNumber,
  findIdempotentOrder,
  clearCheckedOutCart,
} = require("../lib/checkout-engine");
const { requireServiceablePincode, lookupServiceablePincode, normalizePincode } = require("../lib/pincode");
const { notifyOrderWhatsapp, recordOrderNotification, orderMessage } = require("../lib/order-notify");
const {
  resolveCustomerWhatsappMobile,
  formatIndianMobileForStorage,
} = require("../lib/whatsapp-user-mobile");
const {
  ensureProductDeliveryJobsForCheckout,
} = require("../lib/professional-job-engine");

function money(value) {
  return moneySafe(value);
}

function optionalText(value, field, max) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  if (text.length > max) {
    const error = new Error(`${field} must be at most ${max} characters`);
    error.status = 400;
    throw error;
  }
  return text.replace(/'/g, "");
}

function mapOrder(row, items, children) {
  const subtotal = money(row.subtotal);
  const status = row.status || "";
  const paymentStatus = row.payment_status || "";
  const fulfillmentMode = String(row.fulfillment_mode || "").toUpperCase();
  const parentOrderId = row.parent_order_id ? String(row.parent_order_id) : "";
  const childList = children || [];
  let trackingOrderId = String(row.ROWID);
  if (fulfillmentMode === "SPLIT" && childList.length) {
    const qc = childList.find(
      (c) => String(c.fulfillment_mode || "").toUpperCase() === "QUICK_COMMERCE"
    );
    if (qc) trackingOrderId = qc.id;
  } else if (fulfillmentMode === "QUICK_COMMERCE") {
    trackingOrderId = String(row.ROWID);
  }
  return {
    id: String(row.ROWID),
    order_number: row.order_number,
    status,
    payment_status: paymentStatus,
    currency: row.currency || "INR",
    subtotal,
    discount_amount: money(row.discount_amount),
    coupon_code: row.coupon_code || "",
    tax_amount: money(row.tax_amount),
    shipping_amount: money(row.shipping_amount),
    grand_total: money(row.grand_total),
    shipping_name: row.shipping_name || "",
    shipping_phone: row.shipping_phone || "",
    shipping_line1: row.shipping_line1 || "",
    shipping_city: row.shipping_city || "",
    shipping_state: row.shipping_state || "",
    shipping_postal_code: row.shipping_postal_code || "",
    fulfillment_mode: fulfillmentMode,
    parent_order_id: parentOrderId,
    fulfillment_store_id: row.fulfillment_store_id
      ? String(row.fulfillment_store_id)
      : "",
    fulfillment_warehouse_id: row.fulfillment_warehouse_id
      ? String(row.fulfillment_warehouse_id)
      : "",
    payment_method: row.payment_method || "",
    tracking_order_id: trackingOrderId,
    can_cancel: ["PENDING_PAYMENT", "PLACED", "CONFIRMED", "PROCESSING", "STORE_ASSIGNED"].includes(
      status
    ),
    can_return:
      ["DELIVERED", "COMPLETED"].includes(status) && paymentStatus === "PAID",
    items: items || [],
    children: childList,
  };
}

async function loadOrderItems(zcql, orderId) {
  let rows = [];
  try {
    rows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, product_id, variant_id, product_name, sku, quantity, unit_price, unit_mrp, tax_percent, line_total, fulfillment_type FROM Order_Items WHERE order_id = " +
          orderId
      ),
      "Order_Items"
    );
  } catch (_) {
    rows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, product_id, product_name, sku, quantity, unit_price, line_total FROM Order_Items WHERE order_id = " +
          orderId
      ),
      "Order_Items"
    );
  }
  return rows.map((row) => ({
    id: String(row.ROWID),
    product_id: String(row.product_id),
    variant_id: row.variant_id ? String(row.variant_id) : "",
    name: row.product_name,
    sku: row.sku || "",
    quantity: num(row.quantity),
    unit_price: money(row.unit_price),
    unit_mrp: money(row.unit_mrp),
    tax_percent: money(row.tax_percent),
    line_total: money(row.line_total),
    fulfillment_type: row.fulfillment_type || "",
  }));
}

async function safeNotification(req, userId, type, title, body, referenceType, referenceId) {
  try {
    await req.catalystApp.datastore().table("Notifications").insertRow({
      user_id: userId,
      type,
      title,
      body,
      reference_type: referenceType,
      reference_id: referenceId,
      delivery_status: "PENDING",
    });
  } catch (_) {}
}

async function addTimeline(req, orderId, status, note, actorType) {
  try {
    await req.catalystApp.datastore().table("Order_Timeline").insertRow({
      order_id: orderId,
      status,
      note,
      actor_type: actorType || "CUSTOMER",
      happened_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    });
  } catch (_) {}
}

async function loadAddress(zcql, userId, addressId) {
  if (!addressId) {
    return null;
  }
  try {
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, full_name, phone, line1, line2, city, state, postal_code, landmark, latitude, longitude, recipient_name, recipient_phone, address_line1 FROM Addresses WHERE ROWID = " +
          addressId +
          " AND user_id = " +
          userId +
          " AND is_active = true"
      ),
      "Addresses"
    );
  } catch (_) {
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, full_name, phone, line1, city, state, postal_code FROM Addresses WHERE ROWID = " +
          addressId +
          " AND user_id = " +
          userId +
          " AND is_active = true"
      ),
      "Addresses"
    );
  }
}

const ORDER_SELECT =
  "ROWID, user_id, order_number, status, payment_status, payment_method, currency, subtotal, discount_amount, coupon_code, tax_amount, shipping_amount, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city, shipping_state, shipping_postal_code, fulfillment_mode, parent_order_id, fulfillment_store_id, fulfillment_warehouse_id, idempotency_key";
const ORDER_SELECT_LEGACY =
  "ROWID, user_id, order_number, status, payment_status, currency, subtotal, discount_amount, coupon_code, tax_amount, shipping_amount, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city, shipping_state, shipping_postal_code";

async function loadOrderForUser(zcql, userId, orderId) {
  let row = null;
  try {
    row = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT " +
          ORDER_SELECT +
          " FROM Orders WHERE ROWID = " +
          orderId +
          " AND user_id = " +
          userId
      ),
      "Orders"
    );
  } catch (_) {
    row = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT " +
          ORDER_SELECT_LEGACY +
          " FROM Orders WHERE ROWID = " +
          orderId +
          " AND user_id = " +
          userId
      ),
      "Orders"
    );
  }
  if (!row) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }
  return row;
}

async function loadChildOrders(zcql, parentId) {
  try {
    const rows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT " +
          ORDER_SELECT +
          " FROM Orders WHERE parent_order_id = " +
          sqlId(parentId)
      ),
      "Orders"
    );
    const children = [];
    for (const row of rows) {
      children.push(mapOrder(row, await loadOrderItems(zcql, row.ROWID), []));
    }
    return children;
  } catch (_) {
    return [];
  }
}

function sqlId(value) {
  return asId(value, "id");
}

async function insertOrderRow(app, payload) {
  try {
    return await app.datastore().table("Orders").insertRow(payload);
  } catch (error) {
    const fallback = { ...payload };
    delete fallback.fulfillment_mode;
    delete fallback.parent_order_id;
    delete fallback.fulfillment_store_id;
    delete fallback.fulfillment_warehouse_id;
    delete fallback.payment_method;
    delete fallback.idempotency_key;
    return await app.datastore().table("Orders").insertRow(fallback);
  }
}

async function insertOrderItemRow(app, payload) {
  try {
    return await app.datastore().table("Order_Items").insertRow(payload);
  } catch (_) {
    const fallback = { ...payload };
    delete fallback.fulfillment_type;
    delete fallback.fulfillment_store_id;
    delete fallback.fulfillment_warehouse_id;
    delete fallback.pick_status;
    return await app.datastore().table("Order_Items").insertRow(fallback);
  }
}

async function deleteOrderCascade(app, orderId) {
  try {
    await releaseReservation(app, orderId, "Rollback failed checkout");
  } catch (_) {}
  try {
    const items = rowsOf(
      await app.zcql().executeZCQLQuery(
        "SELECT ROWID FROM Order_Items WHERE order_id = " + asId(orderId, "order_id")
      ),
      "Order_Items"
    );
    for (const item of items) {
      try {
        await app.datastore().table("Order_Items").deleteRow(item.ROWID);
      } catch (_) {
        try {
          await app.datastore().table("Order_Items").updateRow({
            ROWID: item.ROWID,
            status: "CANCELLED",
          });
        } catch (__) {}
      }
    }
  } catch (_) {}
  try {
    await app.datastore().table("Orders").updateRow({
      ROWID: orderId,
      status: "CANCELLED",
      notes: "Rolled back after checkout failure",
    });
  } catch (_) {}
}

async function createFulfillmentOrder(req, {
  userId,
  orderNumber,
  currency,
  totals,
  couponCode,
  shipping,
  notes,
  fulfillmentMode,
  parentOrderId,
  storeId,
  warehouseId,
  lines,
  status,
  paymentMethod,
  paymentStatus,
  idempotencyKey,
}) {
  const payload = {
    user_id: userId,
    order_number: orderNumber,
    status: status || "PLACED",
    payment_status: paymentStatus || "PENDING",
    payment_method: paymentMethod || "COD",
    idempotency_key: idempotencyKey || null,
    currency: currency || "INR",
    subtotal: totals.subtotal,
    discount_amount: totals.discount,
    tax_amount: totals.tax,
    shipping_amount: totals.shipping,
    grand_total: totals.grand,
    coupon_code: couponCode || null,
    shipping_name: shipping.name || null,
    shipping_phone: shipping.phone || null,
    shipping_line1: shipping.line1 || null,
    shipping_city: shipping.city || null,
    shipping_state: shipping.state || null,
    shipping_postal_code: shipping.postal || null,
    shipping_country: "India",
    notes: notes || null,
    fulfillment_mode: fulfillmentMode || null,
    parent_order_id: parentOrderId || null,
    fulfillment_store_id: storeId || null,
    fulfillment_warehouse_id: warehouseId || null,
  };
  const inserted = await insertOrderRow(req.catalystApp, payload);
  const orderId = inserted.ROWID || inserted.rowid;
  if (!orderId) {
    const error = new Error("Could not create order");
    error.status = 500;
    throw error;
  }

  for (const line of lines) {
    const warehouseForReserve =
      line.fulfillment_warehouse_id || warehouseId || null;

    await reserveStock(req.catalystApp, {
      productId: line.product_id,
      variantId: line.variant_id,
      quantity: line.quantity,
      referenceType: "ORDER",
      referenceId: asId(orderId, "order_id"),
      warehouseId: warehouseForReserve || undefined,
    });

    await insertOrderItemRow(req.catalystApp, {
      order_id: orderId,
      product_id: line.product_id,
      variant_id: line.variant_id,
      product_name: line.product_name,
      sku: line.sku || null,
      quantity: line.quantity,
      unit_mrp: line.unit_mrp,
      unit_price: line.unit_price,
      tax_percent: line.tax_percent,
      line_total: line.line_total,
      status: "CONFIRMED",
      fulfillment_type: line.fulfillment_type || fulfillmentMode || null,
      fulfillment_store_id: line.fulfillment_store_id || storeId || null,
      fulfillment_warehouse_id:
        line.fulfillment_warehouse_id || warehouseId || null,
      pick_status:
        String(line.fulfillment_type || fulfillmentMode || "").toUpperCase() ===
        "QUICK_COMMERCE"
          ? "PENDING"
          : null,
    });
  }

  await addTimeline(
    req,
    asId(orderId, "order_id"),
    status || "PLACED",
    (fulfillmentMode || "ORDER") + " placed",
    "SYSTEM"
  );
  return asId(orderId, "order_id");
}

function checkoutRoutes(app) {
  app.post("/v1/checkout/check-pincode", async (req, res, next) => {
    try {
      const pin =
        (req.body && (req.body.pincode || req.body.postal_code)) ||
        req.query.pincode;
      try {
        const result = await lookupServiceablePincode(req.catalystApp, pin);
        sendOk(res, result);
      } catch (error) {
        if (error.code === "INVALID_PINCODE") {
          sendOk(res, {
            pincode: String(pin || "").trim(),
            serviceable: false,
            city: "",
            state: "",
            country: "India",
            estimated_delivery_days: 0,
            delivery_zone: "",
            eta_label: "",
            message: error.message || "Enter a valid 6-digit PIN code",
          });
          return;
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/checkout/validate", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const body = req.body || {};
      const priced = await validateCheckoutCart(req, user);
      const pin = normalizePincode(
        body.pincode || body.shipping_postal_code || ""
      );
      const service = await lookupServiceablePincode(req.catalystApp, pin, {
        skipCache: true,
      });
      sendOk(res, {
        cart_id: String(priced.cart.ROWID),
        currency: priced.cart.currency || "INR",
        items: priced.lines.map((line) => ({
          product_id: line.product_id,
          variant_id: line.variant_id || "",
          name: line.product_name,
          sku: line.sku,
          quantity: line.quantity,
          unit_price: line.unit_price,
          unit_mrp: line.unit_mrp,
          line_total: line.line_total,
        })),
        totals: {
          subtotal: priced.totals.subtotal,
          discount_amount: priced.totals.discount,
          tax_amount: priced.totals.tax,
          shipping_amount: priced.totals.shipping,
          grand_total: priced.totals.grand,
          coupon_code: priced.couponCode,
        },
        pincode: service,
        can_place: service.serviceable,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/checkout/verify-payment", (req, res, next) => {
    return require("./payments").handleVerify(req, res, next);
  });

  app.post("/v1/checkout/place-cod-order", (req, res, next) => {
    req.body = Object.assign({}, req.body || {}, { payment_method: "COD" });
    return handlePlaceOrder(req, res, next);
  });

  app.post("/v1/checkout/create-payment", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const body = req.body || {};
      const method = normalizePaymentMethod(body.payment_method || "RAZORPAY");
      if (method === "COD") {
        const error = new Error("Use place-cod-order for cash on delivery");
        error.status = 400;
        throw error;
      }
      req.body = Object.assign({}, body, { payment_method: method });
      req._onlineCheckout = true;
      return handlePlaceOrder(req, res, next);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/checkout", handlePlaceOrder);


async function handlePlaceOrder(req, res, next) {
  const createdOrderIds = [];
  let retainCreatedOrders = false;
  try {
    const user = requireUser(req);
    const body = req.body || {};
    const zcql = req.catalystApp.zcql();
    const paymentMethod = normalizePaymentMethod(body.payment_method || "COD");
    const isCod = paymentMethod === "COD";
    if (!isCod && !require("./payments").providerStatus().razorpay.enabled) {
      const error = new Error("Online payments are currently unavailable. Please try again later.");
      error.status = 503;
      throw error;
    }
    const idempotencyKey = optionalText(
      body.idempotency_key || req.headers["x-idempotency-key"],
      "idempotency_key",
      80
    );

      if (idempotencyKey) {
        const existing = await findIdempotentOrder(zcql, user.user_id, idempotencyKey);
        if (existing) {
          const children = await loadChildOrders(zcql, existing.ROWID);
          sendOk(res, {
            order: mapOrder(
              await loadOrderForUser(zcql, user.user_id, existing.ROWID),
              await loadOrderItems(zcql, existing.ROWID),
              children
            ),
            idempotent: true,
          });
          return;
        }
      }

      const priced = await validateCheckoutCart(req, user);
      const cart = priced.cart;
      const lines = priced.lines;
      const couponCode = priced.couponCode;
      const subtotal = priced.totals.subtotal;
      const discountAmount = priced.totals.discount;
      const taxAmount = priced.totals.tax;
      const shippingAmount = priced.totals.shipping;
      const grandTotal = priced.totals.grand;

      const addressId = body.address_id ? asId(body.address_id, "address_id") : null;
      const savedAddress = await loadAddress(zcql, user.user_id, addressId);
      const registeredMobile = await resolveCustomerWhatsappMobile(req, user);
      const shippingName =
        optionalText(body.shipping_name, "shipping_name", 100) ||
        (savedAddress ? savedAddress.full_name || savedAddress.recipient_name || "" : "");
      let shippingPhone =
        optionalText(body.shipping_phone, "shipping_phone", 20) ||
        (savedAddress ? savedAddress.phone || savedAddress.recipient_phone || "" : "") ||
        registeredMobile;
      shippingPhone = formatIndianMobileForStorage(shippingPhone) || shippingPhone;
      const shippingLine1 =
        optionalText(body.shipping_line1, "shipping_line1", 255) ||
        (savedAddress ? savedAddress.line1 || savedAddress.address_line1 || "" : "");
      const shippingCity =
        optionalText(body.shipping_city, "shipping_city", 100) ||
        (savedAddress ? savedAddress.city || "" : "");
      const shippingState =
        optionalText(body.shipping_state, "shipping_state", 100) ||
        (savedAddress ? savedAddress.state || "" : "");
      const shippingPostal =
        optionalText(body.shipping_postal_code, "shipping_postal_code", 20) ||
        (savedAddress ? savedAddress.postal_code || "" : "");
      if (
        !shippingName ||
        !shippingPhone ||
        !shippingLine1 ||
        !shippingCity ||
        !shippingState ||
        !shippingPostal
      ) {
        const error = new Error(
          "Delivery name, phone, address, city, state and PIN code are required"
        );
        error.status = 400;
        throw error;
      }

      const pincodeInfo = await requireServiceablePincode(
        req.catalystApp,
        shippingPostal
      );
      if (pincodeInfo.city && !shippingCity) {
        // keep user-entered city; pincode only gates serviceability
      }

      const latitude =
        body.latitude != null
          ? Number(body.latitude)
          : savedAddress && savedAddress.latitude != null
            ? Number(savedAddress.latitude)
            : null;
      const longitude =
        body.longitude != null
          ? Number(body.longitude)
          : savedAddress && savedAddress.longitude != null
            ? Number(savedAddress.longitude)
            : null;

      // Server-side authority: re-evaluate fulfillment at checkout time.
      const evaluation = await evaluateFulfillment(req.catalystApp, {
        latitude: Number.isFinite(latitude) ? latitude : null,
        longitude: Number.isFinite(longitude) ? longitude : null,
        items: lines.map((line) => ({
          product_id: line.product_id,
          variant_id: line.variant_id,
          quantity: line.quantity,
        })),
      });
      const plan = resolveCheckoutPlan(
        evaluation,
        optionalText(body.fulfillment_mode, "fulfillment_mode", 30) || null,
        lines
      );

      if (isCod && plan.mode === "QUICK_COMMERCE") {
        const hints = evaluation.payment_hints || {};
        if (hints.cod_allowed_for_quick_commerce === false) {
          const error = new Error(
            hints.cod_blocked_reason ||
              "COD is not available for Quick Commerce orders above the configured limit"
          );
          error.status = 409;
          error.code = "QC_COD_LIMIT_EXCEEDED";
          throw error;
        }
      }
      if (
        isCod &&
        plan.mode === "SPLIT" &&
        plan.groups.some((group) => group.mode === "QUICK_COMMERCE")
      ) {
        const hints = evaluation.payment_hints || {};
        if (hints.cod_allowed_for_quick_commerce === false) {
          const error = new Error(
            hints.cod_blocked_reason ||
              "COD is not available for Quick Commerce orders above the configured limit"
          );
          error.status = 409;
          error.code = "QC_COD_LIMIT_EXCEEDED";
          throw error;
        }
      }

      const shipping = {
        name: shippingName,
        phone: shippingPhone,
        line1: shippingLine1,
        city: shippingCity,
        state: shippingState,
        postal: shippingPostal,
      };
      const notes = optionalText(body.notes, "notes", 255) || null;
      const masterNumber = await nextOrderNumber(zcql);
      const orderStatus = isCod
        ? plan.mode === "QUICK_COMMERCE"
          ? "CONFIRMED"
          : "PLACED"
        : "PENDING_PAYMENT";
      const paymentStatus = "PENDING";
      const apportioned = apportionTotals(lines, {
        discountAmount,
        taxAmount,
        shippingAmount,
      });

      let masterOrderId = null;

      if (plan.mode === "SPLIT") {
        const masterInserted = await insertOrderRow(req.catalystApp, {
          user_id: user.user_id,
          order_number: masterNumber,
          status: orderStatus,
          payment_status: paymentStatus,
          payment_method: paymentMethod,
          idempotency_key: idempotencyKey || null,
          currency: cart.currency || "INR",
          subtotal,
          discount_amount: discountAmount,
          tax_amount: taxAmount,
          shipping_amount: shippingAmount,
          grand_total: grandTotal,
          coupon_code: couponCode || null,
          shipping_name: shippingName,
          shipping_phone: shippingPhone,
          shipping_line1: shippingLine1,
          shipping_city: shippingCity,
          shipping_state: shippingState,
          shipping_postal_code: shippingPostal,
          shipping_country: "India",
          notes: notes,
          fulfillment_mode: "SPLIT",
          parent_order_id: null,
        });
        masterOrderId = asId(masterInserted.ROWID || masterInserted.rowid, "order_id");
        createdOrderIds.push(masterOrderId);
        await addTimeline(
          req,
          masterOrderId,
          "PLACED",
          "Master order placed — split Quick Commerce + Standard Delivery",
          "SYSTEM"
        );

        let childIndex = 0;
        for (const group of plan.groups) {
          childIndex += 1;
          const keyed = group.lines.map((gLine) => {
            const key =
              String(gLine.product_id) +
              ":" +
              (gLine.variant_id ? String(gLine.variant_id) : "");
            return apportioned.find(
              (a) =>
                String(a.product_id) +
                  ":" +
                  (a.variant_id ? String(a.variant_id) : "") ===
                key
            );
          }).filter(Boolean);
          const withType = keyed.map((line) => ({
            ...line,
            fulfillment_type: group.mode,
            fulfillment_store_id: group.store_id || "",
            fulfillment_warehouse_id: group.warehouse_id || "",
          }));
          const totals = groupTotals(withType);
          const childId = await createFulfillmentOrder(req, {
            userId: user.user_id,
            orderNumber: (masterNumber + "-" + childIndex).slice(0, 30),
            currency: cart.currency || "INR",
            totals,
            couponCode: childIndex === 1 ? couponCode : "",
            shipping,
            notes: group.label + (group.eta_label ? " · " + group.eta_label : ""),
            fulfillmentMode: group.mode,
            parentOrderId: masterOrderId,
            storeId: group.store_id || null,
            warehouseId: group.warehouse_id || null,
            lines: withType,
            status: group.mode === "QUICK_COMMERCE" && isCod ? "CONFIRMED" : orderStatus,
            paymentMethod,
            paymentStatus,
            idempotencyKey: idempotencyKey ? idempotencyKey + "-" + childIndex : null,
          });
          createdOrderIds.push(childId);
        }
      } else {
        const group = plan.groups[0];
        const withType = apportioned.map((line) => {
          const match = group.lines.find(
            (g) =>
              String(g.product_id) === String(line.product_id) &&
              String(g.variant_id || "") === String(line.variant_id || "")
          );
          return {
            ...line,
            fulfillment_type: group.mode,
            fulfillment_store_id: (match && match.fulfillment_store_id) || group.store_id || "",
            fulfillment_warehouse_id:
              (match && match.fulfillment_warehouse_id) || group.warehouse_id || "",
          };
        });
        const orderId = await createFulfillmentOrder(req, {
          userId: user.user_id,
          orderNumber: masterNumber.slice(0, 30),
          currency: cart.currency || "INR",
          totals: {
            subtotal,
            discount: discountAmount,
            tax: taxAmount,
            shipping: shippingAmount,
            grand: grandTotal,
          },
          couponCode,
          shipping,
          notes,
          fulfillmentMode: plan.mode,
          parentOrderId: null,
          storeId: group.store_id || null,
          warehouseId: group.warehouse_id || null,
          lines: withType,
          status: isCod && plan.mode === "QUICK_COMMERCE" ? "CONFIRMED" : orderStatus,
          paymentMethod,
          paymentStatus,
          idempotencyKey,
        });
        createdOrderIds.push(orderId);
        masterOrderId = orderId;
      }

      if (isCod) {
        await clearCheckedOutCart(req.catalystApp, cart, lines);
        const commitTargets =
          plan.mode === "SPLIT"
            ? createdOrderIds.filter((id) => String(id) !== String(masterOrderId))
            : createdOrderIds;
        for (const orderId of commitTargets) {
          try {
            await commitReservation(req.catalystApp, orderId);
          } catch (commitError) {
            console.error("[checkout] COD commitReservation", orderId, commitError.message);
          }
        }
      }

      const notifyBody =
        plan.mode === "SPLIT"
          ? "Your Baylen order was split into Quick Commerce and Standard Delivery."
          : plan.mode === "QUICK_COMMERCE"
            ? "Your Quick Commerce order has been placed."
            : "Your Baylen order has been placed.";
      await safeNotification(
        req,
        user.user_id,
        "ORDER",
        "Order placed",
        notifyBody,
        "ORDER",
        masterOrderId
      );

      const children = await loadChildOrders(zcql, masterOrderId);
      const orderRow = await loadOrderForUser(zcql, user.user_id, masterOrderId);
      const pincodeEta = pincodeInfo.eta_label || plan.option.eta_label || "";
      if (isCod) {
        const wa = await notifyOrderWhatsapp(req, user, orderRow, {
          eta: pincodeEta,
          paymentMethod,
          total: grandTotal,
          name: shippingName,
          city: shippingCity,
          pincode: shippingPostal,
        });
        await recordOrderNotification(
          req,
          user.user_id,
          masterOrderId,
          wa,
          "Order confirmation",
          orderMessage({
            name: shippingName,
            orderNumber: orderRow.order_number,
            total: grandTotal,
            paymentMethod,
            city: shippingCity,
            pincode: shippingPostal,
            eta: pincodeEta,
          }).slice(0, 500)
        );
      }

      let payment = null;
      if (!isCod) {
        // From this point an external order may exist, even if the request times out.
        retainCreatedOrders = true;
        try {
          const payments = require("./payments");
          const provider = gatewayProviderFor(paymentMethod) || "RAZORPAY";
          const providers = payments.providerStatus();
          if (provider === "RAZORPAY" && !providers.razorpay.enabled) {
            const error = new Error(
              "Online payments are currently unavailable. Please try again later."
            );
            error.status = 503;
            throw error;
          }
          payment = await payments.createIntentForOrder(req, user, masterOrderId, provider);
        } catch (payError) {
          console.error("[checkout] payment intent failed", payError.message);
        }
        // Archive the checkout snapshot, not whatever cart is active when payment returns.
        await req.catalystApp.datastore().table("Carts").updateRow({
          ROWID: cart.ROWID, status: "CHECKED_OUT", is_active: false,
        });
      }

      if (isCod) {
        try {
          await ensureProductDeliveryJobsForCheckout(req.catalystApp, {
            createdOrderIds,
            masterOrderId,
            planMode: plan.mode,
            actorId: user.user_id,
            actorRole: "customer",
            userId: user.user_id,
          });
        } catch (jobError) {
          console.error("[checkout] professional job hook failed", jobError.message);
        }
      }

      sendOk(res, {
        order: mapOrder(
          orderRow,
          await loadOrderItems(zcql, masterOrderId),
          children
        ),
        payment,
        pincode: pincodeInfo,
        providers: !isCod ? require("./payments").providerStatus() : undefined,
        fulfillment: {
          mode: plan.mode,
          label: plan.option.label || plan.mode,
          eta_label: plan.option.eta_label || "",
          groups: plan.groups.map((g) => ({
            mode: g.mode,
            label: g.label,
            eta_label: g.eta_label,
            item_count: g.lines.length,
            store_id: g.store_id || "",
            warehouse_id: g.warehouse_id || "",
          })),
          warnings: evaluation.warnings || [],
        },
      });
    } catch (error) {
      for (const id of retainCreatedOrders ? [] : createdOrderIds.reverse()) {
        try {
          await deleteOrderCascade(req.catalystApp, id);
        } catch (_) {}
      }
      next(error);
    }
  }

  async function handleCancelOrder(req, res, next) {
    try {
      requireUser(req);
      const id = asId(req.body.order_id, "order_id");
      await require("../lib/payment-lock").withPaymentLock(req.catalystApp, "ORDER:" + id,
        () => handleCancelOrderLocked(req, res, next));
    } catch (error) { next(error); }
  }

  async function handleCancelOrderLocked(req, res, next) {
    try {
      const user = requireUser(req);
      const orderId = asId(req.body.order_id, "order_id");
      const reason = optionalText(req.body.reason, "reason", 255) || "Cancelled by customer";
      const zcql = req.catalystApp.zcql();
      const order = await loadOrderForUser(zcql, user.user_id, orderId);
      if (
        !["PENDING_PAYMENT", "PLACED", "CONFIRMED", "PROCESSING", "STORE_ASSIGNED"].includes(order.status)
      ) {
        const error = new Error("This order cannot be cancelled now");
        error.status = 409;
        throw error;
      }

      const children = await loadChildOrders(zcql, orderId);
      const targets = children.length
        ? children.map((c) => c.id).concat([orderId])
        : [orderId];

      for (const targetId of targets) {
        try {
          await releaseReservation(req.catalystApp, targetId, reason);
        } catch (_) {}
        try {
          await req.catalystApp.datastore().table("Orders").updateRow({
            ROWID: targetId,
            status: "CANCELLED",
            payment_status:
              order.payment_status === "PAID" ? "REFUND_PENDING" : order.payment_status,
            notes: reason,
          });
        } catch (_) {}
        try {
          const items = await loadOrderItems(zcql, targetId);
          for (const item of items) {
            await req.catalystApp.datastore().table("Order_Items").updateRow({
              ROWID: item.id,
              status: "CANCELLED",
            });
          }
        } catch (_) {}
        await addTimeline(req, targetId, "CANCELLED", reason, "CUSTOMER");
        try {
          const { cancelProfessionalJobForReference } = require("../lib/professional-job-lifecycle");
          await cancelProfessionalJobForReference(req.catalystApp, "ORDER", targetId, {
            actorRole: "CUSTOMER",
            actorId: user.user_id,
            reason,
            reasonCode: "CUSTOMER_REQUEST",
            req,
          });
        } catch (_) {}
      }

      if (order.payment_status === "PAID") {
        await req.catalystApp.datastore().table("Refunds").insertRow({
          user_id: user.user_id,
          reference_type: "ORDER",
          reference_id: orderId,
          amount: money(order.grand_total),
          currency: order.currency || "INR",
          reason,
          status: "REQUESTED",
        });
      }
      await safeNotification(
        req,
        user.user_id,
        "ORDER",
        "Order cancelled",
        "Your Baylen order has been cancelled.",
        "ORDER",
        orderId
      );
      const updated = await loadOrderForUser(zcql, user.user_id, orderId);
      sendOk(res, {
        order: mapOrder(
          updated,
          await loadOrderItems(zcql, orderId),
          await loadChildOrders(zcql, orderId)
        ),
      });
    } catch (error) {
      next(error);
    }
  }

  app.get("/v1/orders/:id", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const zcql = req.catalystApp.zcql();
      const orderId = asId(req.params.id, "id");
      const row = await loadOrderForUser(zcql, user.user_id, orderId);
      const children = await loadChildOrders(zcql, orderId);
      sendOk(res, {
        order: mapOrder(row, await loadOrderItems(zcql, orderId), children),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/orders", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const zcql = req.catalystApp.zcql();
      if (req.query.id) {
        const orderId = asId(req.query.id, "id");
        const row = await loadOrderForUser(zcql, user.user_id, orderId);
        const children = await loadChildOrders(zcql, orderId);
        sendOk(res, {
          order: mapOrder(row, await loadOrderItems(zcql, orderId), children),
        });
        return;
      }

      let rows = [];
      try {
        rows = rowsOf(
          await zcql.executeZCQLQuery(
            "SELECT " +
              ORDER_SELECT +
              " FROM Orders WHERE user_id = " +
              user.user_id
          ),
          "Orders"
        );
        rows = rows.filter((row) => !row.parent_order_id);
      } catch (_) {
        rows = rowsOf(
          await zcql.executeZCQLQuery(
            "SELECT " +
              ORDER_SELECT_LEGACY +
              " FROM Orders WHERE user_id = " +
              user.user_id
          ),
          "Orders"
        );
      }
      rows.sort((a, b) => String(b.ROWID).localeCompare(String(a.ROWID)));
      sendOk(res, { orders: rows.map((row) => mapOrder(row, [], [])) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/order/timeline", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const orderId = asId(req.query.id, "id");
      const zcql = req.catalystApp.zcql();
      const order = await loadOrderForUser(zcql, user.user_id, orderId);
      let timeline = [];
      try {
        timeline = rowsOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, status, note, actor_type, happened_at FROM Order_Timeline WHERE order_id = " +
              orderId
          ),
          "Order_Timeline"
        ).map((row) => ({
          id: String(row.ROWID),
          status: row.status || "",
          note: row.note || "",
          actor_type: row.actor_type || "",
          happened_at: row.happened_at || "",
        }));
      } catch (_) {
        timeline = [];
      }
      if (timeline.length === 0) {
        timeline.push({
          id: "current",
          status: order.status,
          note: "Current order status",
          actor_type: "SYSTEM",
          happened_at: "",
        });
      }
      sendOk(res, { timeline });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/orders/:id/cancel", async (req, res, next) => {
    req.body = Object.assign({}, req.body || {}, { order_id: req.params.id });
    return handleCancelOrder(req, res, next);
  });

  app.post("/v1/order/cancel", handleCancelOrder);

  app.post("/v1/order/return", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const orderId = asId(req.body.order_id, "order_id");
      const orderItemId = req.body.order_item_id
        ? asId(req.body.order_item_id, "order_item_id")
        : null;
      const reason = optionalText(req.body.reason, "reason", 255);
      if (!reason) {
        const error = new Error("reason is required");
        error.status = 400;
        throw error;
      }
      const zcql = req.catalystApp.zcql();
      const order = await loadOrderForUser(zcql, user.user_id, orderId);
      if (!["DELIVERED", "COMPLETED"].includes(order.status)) {
        const error = new Error("Return is available only after delivery");
        error.status = 409;
        throw error;
      }
      if (order.payment_status !== "PAID") {
        const error = new Error("Return requires a paid order");
        error.status = 409;
        throw error;
      }
      if (orderItemId) {
        const item = rowOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID FROM Order_Items WHERE ROWID = " +
              orderItemId +
              " AND order_id = " +
              orderId
          ),
          "Order_Items"
        );
        if (!item) {
          const error = new Error("Order item not found");
          error.status = 404;
          throw error;
        }
      }
      await req.catalystApp.datastore().table("Returns").insertRow({
        user_id: user.user_id,
        order_id: orderId,
        order_item_id: orderItemId,
        reason,
        status: "REQUESTED",
      });
      await req.catalystApp.datastore().table("Orders").updateRow({
        ROWID: order.ROWID,
        status: "RETURN_REQUESTED",
      });
      await addTimeline(req, orderId, "RETURN_REQUESTED", reason, "CUSTOMER");
      await safeNotification(
        req,
        user.user_id,
        "ORDER",
        "Return requested",
        "Your Baylen return request has been received.",
        "ORDER",
        orderId
      );
      const updated = await loadOrderForUser(zcql, user.user_id, orderId);
      sendOk(res, {
        order: mapOrder(updated, await loadOrderItems(zcql, orderId), []),
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = checkoutRoutes;
