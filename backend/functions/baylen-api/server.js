const app = require("./index");

const port = process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || 9000;

app.listen(port, () => {
  console.log(`Baylen AppSail API listening on port ${port}`);
});
