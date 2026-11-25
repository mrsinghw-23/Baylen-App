"use strict";

const { requireRole } = require("./session");

function requireRoleMiddleware(role) {
  return (req, res, next) => {
    try {
      req.auth = requireRole(req, role);
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  requireRoleMiddleware,
};
