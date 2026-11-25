"use strict";

/** Default execution checklist when Salon_Services has no configured checklist. */
const DEFAULT_CHECKLIST = [
  { id: "consultation", label: "Consultation", mandatory: true },
  { id: "assessment", label: "Hair/scalp assessment", mandatory: true },
  { id: "preparation", label: "Product preparation", mandatory: false },
  { id: "application", label: "Application", mandatory: true },
  { id: "massage", label: "Massage", mandatory: false },
  { id: "rinse", label: "Rinse", mandatory: true },
  { id: "styling", label: "Final styling", mandatory: true },
  { id: "confirmation", label: "Customer confirmation", mandatory: true },
];

const SERVICE_CHECKLIST_OVERRIDES = {
  spa: [
    { id: "consultation", label: "Consultation", mandatory: true },
    { id: "assessment", label: "Scalp assessment", mandatory: true },
    { id: "preparation", label: "Product preparation", mandatory: true },
    { id: "application", label: "Application", mandatory: true },
    { id: "massage", label: "Massage", mandatory: true },
    { id: "rinse", label: "Rinse", mandatory: true },
    { id: "styling", label: "Final styling", mandatory: true },
    { id: "confirmation", label: "Customer confirmation", mandatory: true },
  ],
  haircut: [
    { id: "consultation", label: "Consultation", mandatory: true },
    { id: "wash", label: "Hair wash", mandatory: false },
    { id: "cut", label: "Cut & shape", mandatory: true },
    { id: "styling", label: "Final styling", mandatory: true },
    { id: "confirmation", label: "Customer confirmation", mandatory: true },
  ],
};

const EXECUTION_CACHE_TTL_MINUTES = 24 * 60;

function executionCacheKey(professionalJobRowId) {
  return "professional_job_exec:" + String(professionalJobRowId);
}

function resolveChecklistTemplate(serviceName) {
  const name = String(serviceName || "").trim().toLowerCase();
  if (name.includes("spa")) {
    return SERVICE_CHECKLIST_OVERRIDES.spa;
  }
  if (name.includes("haircut") || name.includes("cut")) {
    return SERVICE_CHECKLIST_OVERRIDES.haircut;
  }
  return DEFAULT_CHECKLIST;
}

function proofRequiredForService(_serviceName) {
  return false;
}

module.exports = {
  DEFAULT_CHECKLIST,
  EXECUTION_CACHE_TTL_MINUTES,
  executionCacheKey,
  resolveChecklistTemplate,
  proofRequiredForService,
};
