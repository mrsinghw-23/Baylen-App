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
const { sendError } = require("./lib/http");

const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));

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
catalogRoutes(app);
cartRoutes(app);
checkoutRoutes(app);
inventoryRoutes(app);
slotRoutes(app);
dispatchRoutes(app);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Route not found" });
});

app.use((error, req, res, next) => {
  sendError(res, error);
});

module.exports = app;
