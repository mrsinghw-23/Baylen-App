"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_PROJECT_ID = "36851000000230006";
const ALLOWED_ENVIRONMENTS = ["Development", "Production"];

function normalizeEnvironment(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const lower = raw.toLowerCase();
  if (lower === "development" || lower === "dev") {
    return "Development";
  }
  if (lower === "production" || lower === "prod") {
    return "Production";
  }
  return raw;
}

function readCatalystRc(catalystRcPath) {
  const resolved = path.resolve(catalystRcPath);
  if (!fs.existsSync(resolved)) {
    const error = new Error("Catalyst config not found: " + resolved);
    error.code = "CATALYST_RC_MISSING";
    throw error;
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function resolveProjectFromRc(catalystRc, projectId) {
  const projects = Array.isArray(catalystRc.projects) ? catalystRc.projects : [];
  const match = projects.find((project) => String(project.id) === String(projectId));
  if (!match) {
    const error = new Error(
      "Project " + projectId + " not found in .catalystrc — fail closed"
    );
    error.code = "PROJECT_NOT_FOUND";
    throw error;
  }
  return match;
}

function resolveEnvironmentTarget(options = {}) {
  const requested = normalizeEnvironment(options.env);
  if (!requested) {
    const error = new Error("--env is mandatory (Development or Production)");
    error.code = "ENV_REQUIRED";
    throw error;
  }
  if (!ALLOWED_ENVIRONMENTS.includes(requested)) {
    const error = new Error(
      "Invalid environment: " +
        options.env +
        ". Allowed: " +
        ALLOWED_ENVIRONMENTS.join(", ")
    );
    error.code = "ENV_INVALID";
    throw error;
  }

  const projectId =
    String(options.projectId || process.env.BAYLEN_BACKUP_PROJECT_ID || DEFAULT_PROJECT_ID).trim();
  const catalystRcPath =
    options.catalystRcPath ||
    process.env.BAYLEN_CATALYST_RC ||
    path.resolve(__dirname, "../../../.catalystrc");

  const catalystRc = readCatalystRc(catalystRcPath);
  const project = resolveProjectFromRc(catalystRc, projectId);
  const environments = Array.isArray(project.env) ? project.env : [];
  const envRecord = environments.find(
    (item) => String(item.name).toLowerCase() === requested.toLowerCase()
  );

  if (!envRecord) {
    const available = environments.map((item) => item.name).join(", ") || "(none)";
    const error = new Error(
      "Requested environment " +
        requested +
        " is not provisioned for project " +
        projectId +
        ". Available: " +
        available
    );
    error.code = "ENV_NOT_PROVISIONED";
    error.requestedEnvironment = requested;
    error.availableEnvironments = environments.map((item) => item.name);
    throw error;
  }

  return {
    projectId: String(project.id),
    projectName: String(project.name || "Baylen-App"),
    environment: requested,
    environmentId: String(envRecord.id || ""),
    domain: project.domain && project.domain.name ? String(project.domain.name) : "",
    catalystRcPath: path.resolve(catalystRcPath),
  };
}

function assertEnvironmentMatch(resolved, expectedEnvironment) {
  const expected = normalizeEnvironment(expectedEnvironment);
  if (resolved.environment !== expected) {
    const error = new Error(
      "Environment guard tripped: expected " + expected + " got " + resolved.environment
    );
    error.code = "ENV_GUARD_MISMATCH";
    throw error;
  }
}

module.exports = {
  ALLOWED_ENVIRONMENTS,
  DEFAULT_PROJECT_ID,
  normalizeEnvironment,
  resolveEnvironmentTarget,
  assertEnvironmentMatch,
  readCatalystRc,
};
