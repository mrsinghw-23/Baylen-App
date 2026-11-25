"use strict";

const path = require("path");
const { resolveEnvironmentTarget, readCatalystRc } = require("./backup-env");
const {
  createVerifiedCatalystApp: createVerifiedCliApp,
} = require("./backup-catalyst-cli");

function getActiveEnvironmentName(catalystRcPath, projectId) {
  const catalystRc = readCatalystRc(catalystRcPath);
  const project = (catalystRc.projects || []).find(
    (item) => String(item.id) === String(projectId)
  );
  if (!project) {
    return "";
  }
  const activeIdx = catalystRc.actives && catalystRc.actives.env;
  const active = (project.env || []).find((item) => item.idx === activeIdx);
  return active ? String(active.name) : "";
}

function assertCliActiveEnvironment(resolvedTarget) {
  const activeEnvironment = getActiveEnvironmentName(
    resolvedTarget.catalystRcPath,
    resolvedTarget.projectId
  );
  if (!activeEnvironment) {
    const error = new Error("Unable to determine Catalyst CLI active environment");
    error.code = "CATALYST_ACTIVE_ENV_UNKNOWN";
    throw error;
  }
  if (activeEnvironment !== resolvedTarget.environment) {
    const error = new Error(
      "Requested backup environment " +
        resolvedTarget.environment +
        " does not match Catalyst CLI active environment " +
        activeEnvironment +
        ". Run `catalyst env:use " +
        resolvedTarget.environment +
        "` before backup — fail closed."
    );
    error.code = "ENV_TARGET_MISMATCH";
    error.requestedEnvironment = resolvedTarget.environment;
    error.activeEnvironment = activeEnvironment;
    throw error;
  }
}

async function createVerifiedCatalystApp(options = {}) {
  const resolved = resolveEnvironmentTarget(options);
  assertCliActiveEnvironment(resolved);
  return createVerifiedCliApp({ ...options, resolved });
}

function initializeCatalystApp(resolvedTarget) {
  assertCliActiveEnvironment(resolvedTarget);
  const { createCliCatalystApp } = require("./backup-catalyst-cli");
  return createCliCatalystApp(resolvedTarget);
}

module.exports = {
  getActiveEnvironmentName,
  initializeCatalystApp,
  createVerifiedCatalystApp,
};
