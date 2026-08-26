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
const accountRoutes = require("./routes/account");
const engagementRoutes = require("./routes/engagement");
const paymentsRoutes = require("./routes/payments");
const homeRoutes = require("./routes/home");
const notificationsRoutes = require("./routes/notifications");
const searchRoutes = require("./routes/search");
const galleryRoutes = require("./routes/gallery");
const adminRoutes = require("./routes/admin");
const { sendError } = require("./lib/http");

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
app.use(express.json({ limit: "8mb" }));

app.use((req, res, next) => {
  try {
    req.catalystApp = catalyst.initialize(req);
    next();
  } catch (error) {
    next(error);
  }
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    data: { service: "baylen-api", status: "up" },
  });
});

authRoutes(app);
homeRoutes(app);
accountRoutes(app);
catalogRoutes(app);
cartRoutes(app);
checkoutRoutes(app);
salonRoutes(app);
engagementRoutes(app);
paymentsRoutes(app);
notificationsRoutes(app);
searchRoutes(app);
galleryRoutes(app);
inventoryRoutes(app);
slotRoutes(app);
dispatchRoutes(app);
adminRoutes(app);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Route not found" });
});

app.use((error, req, res, next) => {
  sendError(res, error);
});

module.exports = app;
