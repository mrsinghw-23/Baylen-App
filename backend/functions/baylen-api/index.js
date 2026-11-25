const express = require("express");
const cors = require("cors");
const catalyst = require("zcatalyst-sdk-node");
const inventoryRoutes = require("./routes/inventory");
const slotRoutes = require("./routes/slots");
const dispatchRoutes = require("./routes/dispatch");
const authRoutes = require("./routes/auth");
const catalogRoutes = require("./routes/catalog");
const cartRoutes = require("./routes/cart");
const checkoutRoutes = require("./routes/checkout");
const salonRoutes = require("./routes/salon");
const salonImportRoutes = require("./routes/salon-imports");
const accountRoutes = require("./routes/account");
const engagementRoutes = require("./routes/engagement");
const paymentsRoutes = require("./routes/payments");
const homeRoutes = require("./routes/home");
const notificationsRoutes = require("./routes/notifications");
const searchRoutes = require("./routes/search");
const galleryRoutes = require("./routes/gallery");
const adminRoutes = require("./routes/admin");
const importRoutes = require("./routes/imports");
const fulfillmentRoutes = require("./routes/fulfillment");
const lowStockRoutes = require("./routes/low-stock");
const serviceabilityRoutes = require("./routes/serviceability");
const atHomeBeautyRoutes = require("./routes/at-home-beauty");
const pickerRoutes = require("./routes/picker");
const riderRoutes = require("./routes/rider");
const { deliveryPartnerRoutes } = require("./routes/delivery-partner");
const { professionalJobRoutes } = require("./routes/professional-jobs");
const { orderIntegrationRoutes } = require("./routes/order-integrations");
const { sendError } = require("./lib/http");
const { assertRuntimeSecrets, isProductionRuntime } = require("./lib/runtime-config");
const { getWhatsappOtpStatus } = require("./lib/whatsapp-otp");
const { getBookingWhatsappStatus } = require("./lib/booking-notify");
const { getOrderWhatsappStatus } = require("./lib/order-notify");
const { professionalRateLimitMiddleware } = require("./lib/professional-rate-limit");

try {
  assertRuntimeSecrets();
} catch (error) {
  console.error("[baylen-api] FATAL runtime configuration:", error.message);
  if (isProductionRuntime()) {
    throw error;
  }
}

const app = express();
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Baylen-Token, X-Baylen-Guest-Session, x-device-id, *");
  res.header("Access-Control-Expose-Headers", "*");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});
app.use(cors());
app.use(express.json({
  limit: "32mb",
  verify(req, res, buffer) {
    if (req.path === "/v1/payments/webhooks/razorpay") req.rawPaymentBody = Buffer.from(buffer);
  },
}));
app.use(
  express.raw({
    type: (contentType) => {
      const value = String(contentType || "").toLowerCase();
      return (
        value.includes("application/octet-stream") ||
        value.includes("application/x-baylen-backup")
      );
    },
    limit: "64mb",
  })
);

app.use((req, res, next) => {
  try {
    req.catalystUserApp = catalyst.initialize(req);
    req.catalystApp = catalyst.initialize(req, { scope: "admin" });
    next();
  } catch (error) {
    next(error);
  }
});

app.use(professionalRateLimitMiddleware);

app.get("/health", (req, res) => {
  const otpStatus = getWhatsappOtpStatus();
  const bookingStatus = getBookingWhatsappStatus();
  const orderStatus = getOrderWhatsappStatus();
  if (!otpStatus.ready) {
    console.error(
      "[health] WhatsApp OTP is not configured on baylen-api:",
      otpStatus.missing.join(", ")
    );
  }
  if (!bookingStatus.ready) {
    console.error(
      "[health] WhatsApp booking template is not configured:",
      bookingStatus.missing.join(", ")
    );
  }
  if (!orderStatus.ready) {
    console.error(
      "[health] WhatsApp order template is not configured:",
      orderStatus.missing.join(", ")
    );
  }
  res.status(200).json({
    ok: true,
    data: {
      service: "baylen-api",
      status: "up",
      auth: {
        otp_whatsapp_ready: otpStatus.ready,
        missing: otpStatus.missing,
        template: otpStatus.template,
        sender_configured: otpStatus.sender_configured,
        dev_otp_fallback_enabled: otpStatus.dev_fallback_enabled,
        dev_otp_fallback_disabled: !otpStatus.dev_fallback_enabled,
      },
      booking_whatsapp: bookingStatus,
      order_whatsapp: orderStatus,
    },
  });
});

authRoutes(app);
homeRoutes(app);
accountRoutes(app);
catalogRoutes(app);
cartRoutes(app);
checkoutRoutes(app);
salonRoutes(app);
salonImportRoutes(app);
engagementRoutes(app);
paymentsRoutes(app);
notificationsRoutes(app);
searchRoutes(app);
galleryRoutes(app);
inventoryRoutes(app);
slotRoutes(app);
dispatchRoutes(app);
adminRoutes(app);
importRoutes(app);
fulfillmentRoutes(app);
lowStockRoutes(app);
serviceabilityRoutes(app);
atHomeBeautyRoutes(app);
deliveryPartnerRoutes(app);
professionalJobRoutes(app);
orderIntegrationRoutes(app);
pickerRoutes(app);
riderRoutes(app);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Route not found" });
});

app.use((error, req, res, next) => {
  sendError(res, error);
});

module.exports = app;
