"use strict";

const CUSTOMER_LABELS = {
  REQUESTED: "Booking received",
  CONFIRMED: "Booking confirmed",
  ASSIGNED: "Professional assigned",
  ACCEPTED: "Professional confirmed",
  EN_ROUTE: "Professional on the way",
  ARRIVED: "Professional has arrived",
  STARTED: "Service in progress",
  COMPLETED: "Service completed",
  CANCELLED: "Booking cancelled",
  RESCHEDULED: "Booking rescheduled",
};

const PROVIDER_TRANSITIONS = {
  CONFIRMED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["EN_ROUTE", "CANCELLED"],
  EN_ROUTE: ["ARRIVED", "CANCELLED"],
  ARRIVED: ["STARTED", "CANCELLED"],
  STARTED: ["COMPLETED", "CANCELLED"],
};

const PROVIDER_STATUS_ACTIONS = ["ACCEPTED", "EN_ROUTE", "ARRIVED", "STARTED", "COMPLETED", "CANCELLED"];

const CUSTOMER_CANCEL_FROM = new Set(["REQUESTED", "CONFIRMED", "ASSIGNED", "ACCEPTED"]);
const RESCHEDULE_FROM = new Set(["REQUESTED", "CONFIRMED", "ASSIGNED"]);

function customerStatusLabel(status) {
  const key = String(status || "").trim().toUpperCase();
  return CUSTOMER_LABELS[key] || "Processing your booking";
}

function canCustomerCancel(status) {
  return CUSTOMER_CANCEL_FROM.has(String(status || "").trim().toUpperCase());
}

function canReschedule(status) {
  return RESCHEDULE_FROM.has(String(status || "").trim().toUpperCase());
}

function canShowLiveTracking(status) {
  const key = String(status || "").trim().toUpperCase();
  return ["EN_ROUTE", "ARRIVED", "STARTED"].includes(key);
}

function assertProviderTransition(current, next) {
  const from = String(current || "").trim().toUpperCase();
  const to = String(next || "").trim().toUpperCase();
  const allowed = PROVIDER_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    const error = new Error("Invalid status transition from " + from + " to " + to);
    error.status = 409;
    error.code = "INVALID_TRANSITION";
    throw error;
  }
}

function assertCustomerTransition(current, next) {
  const from = String(current || "").trim().toUpperCase();
  const to = String(next || "").trim().toUpperCase();
  if (to === "CANCELLED" && canCustomerCancel(from)) {
    return;
  }
  if (to === "RESCHEDULED" && canReschedule(from)) {
    return;
  }
  const error = new Error("This booking cannot move to " + to);
  error.status = 409;
  error.code = "INVALID_TRANSITION";
  throw error;
}

function canAcceptLocationPing(status) {
  return String(status || "").trim().toUpperCase() === "EN_ROUTE";
}

function requiresArrivalOtp(status, next) {
  const from = String(status || "").trim().toUpperCase();
  const to = String(next || "").trim().toUpperCase();
  return from === "ARRIVED" && to === "STARTED";
}

module.exports = {
  CUSTOMER_LABELS,
  PROVIDER_STATUS_ACTIONS,
  customerStatusLabel,
  canCustomerCancel,
  canReschedule,
  canShowLiveTracking,
  canAcceptLocationPing,
  requiresArrivalOtp,
  assertProviderTransition,
  assertCustomerTransition,
};
