"use strict";

const { isTruthy } = require("./http");
const { parseLocation } = require("./geo-coords");

function mapProductModeFlags(product) {
  if (!product) {
    return {
      quick_commerce_enabled: true,
      ecommerce_enabled: true,
      quick_commerce_restriction_reason: "",
    };
  }
  const qcUnset =
    product.quick_commerce_enabled === undefined ||
    product.quick_commerce_enabled === null ||
    product.quick_commerce_enabled === "";
  const ecUnset =
    product.ecommerce_enabled === undefined ||
    product.ecommerce_enabled === null ||
    product.ecommerce_enabled === "";
  return {
    quick_commerce_enabled: qcUnset ? true : isTruthy(product.quick_commerce_enabled),
    ecommerce_enabled: ecUnset ? true : isTruthy(product.ecommerce_enabled),
    quick_commerce_restriction_reason: product.quick_commerce_restriction_reason || "",
  };
}

module.exports = {
  parseLocation,
  mapProductModeFlags,
};
