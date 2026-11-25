"use strict";

const JOB_STATUS = {
  CREATED: "CREATED",
  ASSIGNMENT_PENDING: "ASSIGNMENT_PENDING",
  ASSIGNED: "ASSIGNED",
  ACCEPTED: "ACCEPTED",
  GOING_TO_PICKUP: "GOING_TO_PICKUP",
  ARRIVED_PICKUP: "ARRIVED_PICKUP",
  PICKUP_VERIFIED: "PICKUP_VERIFIED",
  PICKED_UP: "PICKED_UP",
  EN_ROUTE: "EN_ROUTE",
  ARRIVED: "ARRIVED",
  DELIVERY_VERIFIED: "DELIVERY_VERIFIED",
  DELIVERED: "DELIVERED",
  OTP_VERIFIED: "OTP_VERIFIED",
  STARTED: "STARTED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  REASSIGNMENT_REQUIRED: "REASSIGNMENT_REQUIRED",
  CANCELLED: "CANCELLED",
};

const SHARED_TRANSITIONS = {
  CREATED: new Set(["ASSIGNMENT_PENDING"]),
  ASSIGNMENT_PENDING: new Set(["ASSIGNED", "CANCELLED"]),
  ASSIGNED: new Set(["ACCEPTED", "REASSIGNMENT_REQUIRED", "CANCELLED"]),
  REASSIGNMENT_REQUIRED: new Set(["ASSIGNMENT_PENDING", "CANCELLED"]),
  CANCELLED: new Set([]),
};

const HOME_SERVICE_TRANSITIONS = {
  ...SHARED_TRANSITIONS,
  ACCEPTED: new Set(["EN_ROUTE", "REASSIGNMENT_REQUIRED", "CANCELLED"]),
  EN_ROUTE: new Set(["ARRIVED", "CANCELLED"]),
  ARRIVED: new Set(["OTP_VERIFIED", "CANCELLED"]),
  OTP_VERIFIED: new Set(["STARTED", "CANCELLED"]),
  STARTED: new Set(["IN_PROGRESS", "CANCELLED"]),
  IN_PROGRESS: new Set(["COMPLETED", "CANCELLED"]),
};

const PRODUCT_DELIVERY_TRANSITIONS = {
  ...SHARED_TRANSITIONS,
  ACCEPTED: new Set(["GOING_TO_PICKUP", "REASSIGNMENT_REQUIRED", "CANCELLED"]),
  GOING_TO_PICKUP: new Set(["ARRIVED_PICKUP", "REASSIGNMENT_REQUIRED", "CANCELLED"]),
  ARRIVED_PICKUP: new Set(["PICKUP_VERIFIED", "REASSIGNMENT_REQUIRED", "CANCELLED"]),
  PICKUP_VERIFIED: new Set(["PICKED_UP", "REASSIGNMENT_REQUIRED", "CANCELLED"]),
  PICKED_UP: new Set(["EN_ROUTE", "REASSIGNMENT_REQUIRED", "CANCELLED"]),
  EN_ROUTE: new Set(["ARRIVED", "REASSIGNMENT_REQUIRED", "CANCELLED"]),
  ARRIVED: new Set(["DELIVERY_VERIFIED", "REASSIGNMENT_REQUIRED", "CANCELLED"]),
  DELIVERY_VERIFIED: new Set(["DELIVERED", "REASSIGNMENT_REQUIRED", "CANCELLED"]),
  DELIVERED: new Set(["COMPLETED"]),
};

/** @deprecated use HOME_SERVICE_TRANSITIONS */
const PP002_ALLOWED_TRANSITIONS = HOME_SERVICE_TRANSITIONS;

function normalizeJobStatus(status) {
  return String(status || "")
    .trim()
    .toUpperCase();
}

function transitionMapForJobType(jobType) {
  return String(jobType || "").toUpperCase() === "PRODUCT_DELIVERY"
    ? PRODUCT_DELIVERY_TRANSITIONS
    : HOME_SERVICE_TRANSITIONS;
}

function canTransitionJob(from, to, jobType) {
  const fromStatus = normalizeJobStatus(from);
  const toStatus = normalizeJobStatus(to);
  if (fromStatus === toStatus) {
    return true;
  }
  const allowed = transitionMapForJobType(jobType)[fromStatus];
  return Boolean(allowed && allowed.has(toStatus));
}

function assertJobTransition(from, to, jobType) {
  if (!canTransitionJob(from, to, jobType)) {
    const error = new Error("Invalid professional job transition from " + from + " to " + to);
    error.status = 409;
    error.code = "INVALID_STATUS_TRANSITION";
    throw error;
  }
}

module.exports = {
  JOB_STATUS,
  PP002_ALLOWED_TRANSITIONS,
  HOME_SERVICE_TRANSITIONS,
  PRODUCT_DELIVERY_TRANSITIONS,
  normalizeJobStatus,
  transitionMapForJobType,
  canTransitionJob,
  assertJobTransition,
};
