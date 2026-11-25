"use strict";

const DEFAULT_API_BASE = "https://salesiq.zoho.in";
const DEFAULT_SCREEN_NAME = "baylendlouis";
const DEFAULT_APP_ID = "206226000000002121";
const DEFAULT_CONNECTION_LINK = "salesiiq";
const DEFAULT_ANDROID_BUNDLE = "com.example.baylen_app";
const DEFAULT_IOS_BUNDLE = "com.example.baylenApp";
const DEFAULT_MOBILE_APP_KEY =
  "uQqOepuLOQ8grqV35I9k/UjQaL8DzT9ZO+UJUEFLRAeWDdB5VqcYP07w+gWdkdjCE8IA0L0udBo=_in";

function salesIqConfig(env = process.env) {
  return {
    apiBase: String(env.SALESIQ_API_BASE || DEFAULT_API_BASE).replace(/\/$/, ""),
    screenName: String(env.SALESIQ_SCREEN_NAME || DEFAULT_SCREEN_NAME).trim(),
    appId: String(env.SALESIQ_APP_ID || DEFAULT_APP_ID).trim(),
    connectionLinkName: String(
      env.SALESIQ_CONNECTION_LINK_NAME || DEFAULT_CONNECTION_LINK
    ).trim(),
    androidBundleId: String(
      env.SALESIQ_ANDROID_BUNDLE_ID || DEFAULT_ANDROID_BUNDLE
    ).trim(),
    iosBundleId: String(env.SALESIQ_IOS_BUNDLE_ID || DEFAULT_IOS_BUNDLE).trim(),
    mobileAppKey: String(
      env.SALESIQ_MOBILE_APP_KEY || DEFAULT_MOBILE_APP_KEY
    ).trim(),
  };
}

async function getAccessToken(req, config = salesIqConfig()) {
  if (!req?.catalystApp?.connections) {
    const error = new Error("Catalyst connections API unavailable");
    error.status = 503;
    throw error;
  }

  let credentials;
  try {
    credentials = await req.catalystApp
      .connections()
      .getConnectionCredentials(config.connectionLinkName);
  } catch (error) {
    const err = new Error(
      "SalesIQ Catalyst connection not available: " + config.connectionLinkName
    );
    err.status = 503;
    err.cause = error;
    throw err;
  }

  const headers = credentials?.headers || {};
  let token =
    headers.Authorization ||
    headers.authorization ||
    headers.AUTHORIZATION ||
    "";
  if (token && !/^Zoho-oauthtoken\s/i.test(token)) {
    token = "Zoho-oauthtoken " + token.replace(/^Bearer\s+/i, "");
  }
  if (!token && credentials?.parameters?.access_token) {
    token = "Zoho-oauthtoken " + credentials.parameters.access_token;
  }
  if (!token) {
    const error = new Error("SalesIQ connection did not return an access token");
    error.status = 503;
    throw error;
  }
  return token;
}

async function salesIqRequest(req, method, path, { body, config } = {}) {
  const resolved = config || salesIqConfig();
  const token = await getAccessToken(req, resolved);
  const url = resolved.apiBase + path;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: token,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_) {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    const error = new Error(
      "SalesIQ API " +
        method +
        " " +
        path +
        " failed: " +
        formatApiError(payload, response.statusText)
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function decodeAccessKey(value) {
  if (!value) {
    return "";
  }
  try {
    return decodeURIComponent(String(value));
  } catch (_) {
    return String(value);
  }
}

function formatApiError(payload, fallback) {
  if (!payload) {
    return fallback;
  }
  if (typeof payload === "string") {
    return payload;
  }
  if (typeof payload.message === "string") {
    return payload.message;
  }
  if (typeof payload.error === "string") {
    return payload.error;
  }
  try {
    return JSON.stringify(payload);
  } catch (_) {
    return fallback;
  }
}

function channelPath(platform, suffix = "") {
  const channel = platform === "ios" ? "ios" : "android";
  return "/channels/" + channel + suffix;
}

function accessKeysGetPath(platform, config) {
  const channel = platform === "ios" ? "ios" : "android";
  if (channel === "android") {
    return (
      "/api/v2/" +
      config.screenName +
      "/apps/" +
      config.appId +
      "/android/channels/accesskeys"
    );
  }
  return (
    "/api/v2/" +
    config.screenName +
    "/apps/" +
    config.appId +
    channelPath(platform, "/accesskeys")
  );
}

function pickLatestAccessKey(payload) {
  const data = payload?.data || payload;
  const keys = Array.isArray(data?.access_keys)
    ? data.access_keys
    : Array.isArray(data)
      ? data
      : [];
  if (!keys.length) {
    return { appKey: decodeAccessKey(data?.app_key || ""), accessKey: "" };
  }
  const sorted = [...keys].sort(
    (a, b) => Number(b.version || 0) - Number(a.version || 0)
  );
  const latest =
    sorted.find((item) => String(item.enabled) === "true" || item.enabled === true) ||
    sorted[0];
  return {
    appKey: decodeAccessKey(data?.app_key || ""),
    accessKey: decodeAccessKey(latest?.key || ""),
    version: latest?.version || "",
  };
}

async function listApps(req, config = salesIqConfig()) {
  const payload = await salesIqRequest(
    req,
    "GET",
    "/api/v2/" + config.screenName + "/apps",
    { config }
  );
  return payload?.data || [];
}

function isMissingChannelError(error) {
  const code = error?.payload?.error?.code;
  return (
    error?.status === 404 ||
    code === 1409 ||
    code === 1006 ||
    String(error?.message || "").includes("Invalid URL") ||
    String(error?.message || "").includes("Channel does not exist")
  );
}

function channelGetPaths(platform, config) {
  const channel = platform === "ios" ? "ios" : "android";
  if (channel === "android") {
    return [
      "/api/v2/" + config.screenName + "/apps/" + config.appId + "/android",
      "/api/v2/" +
        config.screenName +
        "/apps/" +
        config.appId +
        "/channels/android",
    ];
  }
  return [
    "/api/v2/" + config.screenName + "/apps/" + config.appId + "/channels/ios",
    "/api/v2/" + config.screenName + "/apps/" + config.appId + "/ios",
  ];
}

function summarizeChannelPayload(payload, path) {
  const data = payload?.data || payload || {};
  const keys = pickLatestAccessKey(payload);
  return {
    path,
    object: payload?.object || "",
    bundleName: String(data.bundle_name || "").trim(),
    bundleId: String(data.bundle_id || "").trim(),
    appName: String(data.app_name || "").trim(),
    enabled: data.enabled,
    appKey: keys.appKey,
    accessKey: keys.accessKey,
    version: keys.version,
    accessKeyCount: Array.isArray(data.access_keys)
      ? data.access_keys.length
      : Array.isArray(data)
        ? data.length
        : 0,
  };
}

async function getMobileChannel(req, platform, config = salesIqConfig()) {
  const paths = channelGetPaths(platform, config);
  let lastError = null;
  for (const path of paths) {
    try {
      const payload = await salesIqRequest(req, "GET", path, { config });
      const summary = summarizeChannelPayload(payload, path);
      if (summary.appKey || summary.accessKey || summary.bundleName) {
        return summary;
      }
    } catch (error) {
      lastError = error;
      if (!isMissingChannelError(error)) {
        throw error;
      }
    }
  }
  if (lastError) {
    throw lastError;
  }
  return {
    appKey: "",
    accessKey: "",
    version: "",
    bundleName: "",
    bundleId: "",
    appName: "",
  };
}

async function tryChannelWrite(req, method, path, body, config) {
  try {
    const payload = await salesIqRequest(req, method, path, { config, body });
    return { ok: true, method, path, ...summarizeChannelPayload(payload, path) };
  } catch (error) {
    return {
      ok: false,
      method,
      path,
      status: error.status || 0,
      message: error.message || String(error),
      payload: error.payload || null,
    };
  }
}

async function enableMobileChannels(req, config = salesIqConfig()) {
  const attempts = [];
  const components = ["chat", "faq", "proactive"];

  for (const platform of ["android", "ios"]) {
    const bundle =
      platform === "ios" ? config.iosBundleId : config.androidBundleId;
    const base =
      "/api/v2/" +
      config.screenName +
      "/apps/" +
      config.appId +
      "/channels/" +
      platform;

    attempts.push(
      await tryChannelWrite(
        req,
        "PUT",
        base,
        {
          enabled: true,
          bundle_name: bundle,
        },
        config
      )
    );
    attempts.push(
      await tryChannelWrite(
        req,
        "PUT",
        base,
        {
          enabled: true,
        },
        config
      )
    );
    attempts.push(
      await tryChannelWrite(
        req,
        "POST",
        base + "/components",
        { components },
        config
      )
    );
    attempts.push(
      await tryChannelWrite(
        req,
        "PATCH",
        base,
        {
          enabled: true,
          bundle_name: bundle,
          components,
        },
        config
      )
    );
    attempts.push(
      await tryChannelWrite(
        req,
        "PUT",
        base + "/components",
        { components },
        config
      )
    );
    attempts.push(
      await tryChannelWrite(
        req,
        "PATCH",
        base + "/components",
        { components },
        config
      )
    );
  }

  attempts.push(
    await tryChannelWrite(
      req,
      "PUT",
      "/api/v2/" + config.screenName + "/apps/" + config.appId,
      {
        channels: {
          android: { enabled: true, chat: 1, faq: 1, proactive: 1 },
          ios: { enabled: true, chat: 1, faq: 1, proactive: 1 },
        },
      },
      config
    )
  );
  attempts.push(
    await tryChannelWrite(
      req,
      "PATCH",
      "/api/v2/" + config.screenName + "/apps/" + config.appId,
      {
        channels: {
          android: { enabled: true, chat: 1, faq: 1, proactive: 1 },
          ios: { enabled: true, chat: 1, faq: 1, proactive: 1 },
        },
      },
      config
    )
  );

  const after = await dumpMobileChannels(req, config, { skipCreate: true });
  return { attempts, after };
}

async function dumpMobileChannels(req, config = salesIqConfig(), options = {}) {
  const result = {
    expectedAndroidBundle: config.androidBundleId,
    expectedIosBundle: config.iosBundleId,
    appId: config.appId,
    screenName: config.screenName,
    app: null,
    probes: [],
    createAndroid: null,
    createIos: null,
  };

  try {
    const payload = await salesIqRequest(
      req,
      "GET",
      "/api/v2/" + config.screenName + "/apps/" + config.appId,
      { config }
    );
    const data = payload?.data || payload || {};
    result.app = {
      keys: Object.keys(data),
      name: data.name || data.app_name || "",
      id: String(data.id || ""),
      enabled: data.enabled,
      platforms: data.platforms || data.channels || data.mobile || null,
      bundle_name: data.bundle_name || "",
      android: data.android || null,
      ios: data.ios || null,
    };
  } catch (error) {
    result.app = { error: error.message };
  }

  const probes = [
    "/api/v2/" + config.screenName + "/apps/" + config.appId + "/android",
    "/api/v2/" +
      config.screenName +
      "/apps/" +
      config.appId +
      "/channels/android",
    "/api/v2/" +
      config.screenName +
      "/apps/" +
      config.appId +
      "/channels/android/accesskeys",
    "/api/v2/" +
      config.screenName +
      "/apps/" +
      config.appId +
      "/channels/ios",
    "/api/v2/" +
      config.screenName +
      "/apps/" +
      config.appId +
      "/channels/ios/accesskeys",
  ];

  for (const path of probes) {
    try {
      const payload = await salesIqRequest(req, "GET", path, { config });
      result.probes.push({
        ok: true,
        ...summarizeChannelPayload(payload, path),
        dataKeys: Object.keys((payload && payload.data) || payload || {}),
      });
    } catch (error) {
      result.probes.push({
        ok: false,
        path,
        status: error.status || 0,
        message: error.message || String(error),
        payload: error.payload || null,
      });
    }
  }

  if (!options.skipCreate) {
    try {
      result.createAndroid = await createAndroidChannel(req, config);
    } catch (error) {
      result.createAndroid = {
        error: error.message,
        status: error.status || 0,
        payload: error.payload || null,
      };
    }

    try {
      result.createIos = await createIosChannel(req, config);
    } catch (error) {
      result.createIos = {
        error: error.message,
        status: error.status || 0,
        payload: error.payload || null,
      };
    }
  }

  return result;
}

async function getChannelDetails(req, platform, config = salesIqConfig()) {
  const paths =
    platform === "android"
      ? [
          "/api/v2/" +
            config.screenName +
            "/apps/" +
            config.appId +
            "/channels/android",
          "/api/v2/" +
            config.screenName +
            "/apps/" +
            config.appId +
            "/android",
        ]
      : [
          "/api/v2/" +
            config.screenName +
            "/apps/" +
            config.appId +
            channelPath(platform),
        ];

  let lastError = null;
  for (const path of paths) {
    try {
      const payload = await salesIqRequest(req, "GET", path, { config });
      return pickLatestAccessKey(payload);
    } catch (error) {
      lastError = error;
      if (!isMissingChannelError(error)) {
        throw error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
  return { appKey: "", accessKey: "" };
}

async function getChannelAccessKeys(req, platform, config = salesIqConfig()) {
  const paths =
    platform === "android"
      ? [
          accessKeysGetPath(platform, config),
          "/api/v2/" +
            config.screenName +
            "/apps/" +
            config.appId +
            "/channels/android/accesskeys",
        ]
      : [accessKeysGetPath(platform, config)];

  let lastError = null;
  for (const path of paths) {
    try {
      const payload = await salesIqRequest(req, "GET", path, { config });
      const keys = pickLatestAccessKey(payload);
      if (keys.appKey && keys.accessKey) {
        return keys;
      }
      if (keys.accessKey) {
        try {
          const channel = await getChannelDetails(req, platform, config);
          if (channel.appKey) {
            return { ...keys, appKey: channel.appKey };
          }
        } catch (_) {
          // Fall through with partial keys.
        }
      }
      if (keys.accessKey || keys.appKey) {
        return keys;
      }
    } catch (error) {
      lastError = error;
      if (!isMissingChannelError(error)) {
        throw error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
  return { appKey: "", accessKey: "" };
}

async function createAndroidChannel(req, config = salesIqConfig()) {
  const payload = await salesIqRequest(
    req,
    "POST",
    "/api/v2/" +
      config.screenName +
      "/apps/" +
      config.appId +
      channelPath("android"),
    {
      config,
      body: {
        bundle_name: config.androidBundleId,
      },
    }
  );
  return pickLatestAccessKey(payload);
}

async function createIosChannel(req, config = salesIqConfig()) {
  const payload = await salesIqRequest(
    req,
    "POST",
    "/api/v2/" +
      config.screenName +
      "/apps/" +
      config.appId +
      channelPath("ios"),
    {
      config,
      body: {
        bundle_name: config.iosBundleId,
      },
    }
  );
  return pickLatestAccessKey(payload);
}

async function createChannelAccessKeys(req, platform, config = salesIqConfig()) {
  const channel = platform === "ios" ? "ios" : "android";
  const payload = await salesIqRequest(
    req,
    "POST",
    "/api/v2/" +
      config.screenName +
      "/apps/" +
      config.appId +
      "/channels/" +
      channel +
      "/accesskeys",
    {
      config,
      body: {},
    }
  );
  return pickLatestAccessKey(payload);
}

function extractAccessKeyList(payload) {
  const data = payload?.data || payload;
  if (Array.isArray(data?.access_keys)) {
    return {
      appKey: decodeAccessKey(data?.app_key || ""),
      keys: data.access_keys,
    };
  }
  if (Array.isArray(data)) {
    return { appKey: "", keys: data };
  }
  return { appKey: decodeAccessKey(data?.app_key || ""), keys: [] };
}

function pickLatestFromList(appKey, keys) {
  if (!Array.isArray(keys) || !keys.length) {
    return { appKey: appKey || "", accessKey: "", version: "" };
  }
  const sorted = [...keys].sort(
    (a, b) => Number(b.version || 0) - Number(a.version || 0)
  );
  const latest =
    sorted.find(
      (item) => String(item.enabled) === "true" || item.enabled === true
    ) || sorted[0];
  return {
    appKey: appKey || "",
    accessKey: decodeAccessKey(latest?.key || ""),
    version: latest?.version || "",
  };
}

async function getAccessKeyListRaw(req, platform, config = salesIqConfig()) {
  const channel = platform === "ios" ? "ios" : "android";
  const paths =
    platform === "android"
      ? [
          accessKeysGetPath(platform, config),
          "/api/v2/" +
            config.screenName +
            "/apps/" +
            config.appId +
            "/channels/android/accesskeys",
        ]
      : [
          accessKeysGetPath(platform, config),
          "/api/v2/" +
            config.screenName +
            "/apps/" +
            config.appId +
            "/channels/ios/accesskeys",
        ];

  let lastError = null;
  for (const path of paths) {
    try {
      const payload = await salesIqRequest(req, "GET", path, { config });
      const parsed = extractAccessKeyList(payload);
      if (parsed.keys.length) {
        return parsed;
      }
    } catch (error) {
      lastError = error;
      if (!isMissingChannelError(error)) {
        throw error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
  return { appKey: "", keys: [] };
}

async function deleteAccessKeyVersion(req, platform, version, config = salesIqConfig()) {
  const channel = platform === "ios" ? "ios" : "android";
  await salesIqRequest(
    req,
    "DELETE",
    "/api/v2/" +
      config.screenName +
      "/apps/" +
      config.appId +
      "/channels/" +
      channel +
      "/accesskeys/" +
      encodeURIComponent(String(version)),
    { config }
  );
}

async function rotateAccessKey(req, platform, config = salesIqConfig()) {
  const listing = await getAccessKeyListRaw(req, platform, config);
  if (listing.keys.length >= 3) {
    const oldest = [...listing.keys].sort(
      (a, b) => Number(a.version || 0) - Number(b.version || 0)
    )[0];
    if (oldest?.version) {
      await deleteAccessKeyVersion(req, platform, oldest.version, config);
    }
  }
  return createChannelAccessKeys(req, platform, config);
}
async function getBrandAppKey(req, config = salesIqConfig()) {
  if (config.mobileAppKey) {
    return decodeAccessKey(config.mobileAppKey);
  }

  try {
    const apps = await listApps(req, config);
    const match = apps.find(
      (app) => String(app.id || app.app_id || app.appId) === config.appId
    );
    const appKey = decodeAccessKey(match?.app_key || match?.appKey || "");
    if (appKey) {
      return appKey;
    }
  } catch (_) {
    // Fall through to channel-level lookups.
  }

  const paths = [
    "/api/v2/" + config.screenName + "/apps/" + config.appId,
    "/api/v2/" +
      config.screenName +
      "/apps/" +
      config.appId +
      "/channels/android",
    "/api/v2/" + config.screenName + "/apps/" + config.appId + "/android",
    "/api/v2/" +
      config.screenName +
      "/apps/" +
      config.appId +
      "/channels/ios",
  ];

  for (const path of paths) {
    try {
      const payload = await salesIqRequest(req, "GET", path, { config });
      const data = payload?.data || payload;
      const appKey = decodeAccessKey(
        data?.app_key || data?.android?.app_key || data?.ios?.app_key || ""
      );
      if (appKey) {
        return appKey;
      }
    } catch (error) {
      if (!isMissingChannelError(error)) {
        throw error;
      }
    }
  }

  return "";
}

async function fetchExistingMobileKeys(req, platform, config = salesIqConfig()) {
  try {
    const channel = await getMobileChannel(req, platform, config);
    if (channel.appKey && channel.accessKey) {
      return {
        appKey: channel.appKey,
        accessKey: channel.accessKey,
        version: channel.version || "",
        bundleName: channel.bundleName,
      };
    }
    if (channel.accessKey || channel.appKey) {
      return {
        appKey: channel.appKey || "",
        accessKey: channel.accessKey || "",
        version: channel.version || "",
        bundleName: channel.bundleName,
      };
    }
  } catch (error) {
    if (!isMissingChannelError(error)) {
      throw error;
    }
  }

  let appKey = "";
  let accessKey = "";
  let version = "";

  try {
    const listing = await getAccessKeyListRaw(req, platform, config);
    appKey = listing.appKey || appKey;
    const picked = pickLatestFromList(appKey, listing.keys);
    appKey = picked.appKey || appKey;
    accessKey = picked.accessKey || accessKey;
    version = picked.version || version;
  } catch (error) {
    if (!isMissingChannelError(error)) {
      throw error;
    }
  }

  if (appKey && accessKey) {
    return { appKey, accessKey, version };
  }

  if (accessKey && !appKey) {
    try {
      const channel = await getChannelDetails(req, platform, config);
      if (channel.appKey) {
        return { appKey: channel.appKey, accessKey, version };
      }
    } catch (error) {
      if (!isMissingChannelError(error)) {
        throw error;
      }
    }
  }

  const attempts = [
    () => getChannelDetails(req, platform, config),
    () => getChannelAccessKeys(req, platform, config),
  ];

  let partial = { appKey, accessKey, version };
  for (const attempt of attempts) {
    try {
      const keys = await attempt();
      if (keys.appKey && !partial.appKey) {
        partial.appKey = keys.appKey;
      }
      if (keys.accessKey && !partial.accessKey) {
        partial.accessKey = keys.accessKey;
      }
      if (keys.version && !partial.version) {
        partial.version = keys.version;
      }
      if (partial.appKey && partial.accessKey) {
        return partial;
      }
    } catch (error) {
      if (!isMissingChannelError(error)) {
        throw error;
      }
    }
  }

  if (partial.appKey && partial.accessKey) {
    return partial;
  }

  if (partial.accessKey && !partial.appKey) {
    const brandAppKey = await getBrandAppKey(req, config);
    if (brandAppKey) {
      return { ...partial, appKey: brandAppKey };
    }
  }

  return partial;
}

async function inspectChannelBundle(req, platform, config = salesIqConfig()) {
  try {
    const channel = await getMobileChannel(req, platform, config);
    if (channel.bundleName) {
      return { registered: true, bundleName: channel.bundleName };
    }
  } catch (error) {
    if (!isMissingChannelError(error)) {
      throw error;
    }
  }

  return { registered: false, bundleName: "" };
}

async function readMobileKeys(req, config = salesIqConfig()) {
  const result = {
    screenName: config.screenName,
    appId: config.appId,
    expectedAndroidBundle: config.androidBundleId,
    expectedIosBundle: config.iosBundleId,
    android: { appKey: "", accessKey: "", version: "", source: "missing" },
    ios: { appKey: "", accessKey: "", version: "", source: "missing" },
  };

  for (const platform of ["android", "ios"]) {
    const keys = await fetchExistingMobileKeys(req, platform, config);
    const bundleInfo = await inspectChannelBundle(req, platform, config);
    const expectedBundle =
      platform === "ios" ? config.iosBundleId : config.androidBundleId;
    const bundleFields = {
      registeredBundle: bundleInfo.bundleName,
      bundleMatch:
        Boolean(bundleInfo.bundleName) &&
        bundleInfo.bundleName === expectedBundle,
    };

    if (keys.appKey && keys.accessKey) {
      result[platform] = { ...keys, source: "existing", ...bundleFields };
    } else if (keys.accessKey || keys.appKey) {
      result[platform] = { ...keys, source: "partial", ...bundleFields };
    } else {
      result[platform] = {
        appKey: "",
        accessKey: "",
        version: "",
        source: "missing",
        ...bundleFields,
      };
    }
  }

  for (const platform of ["android", "ios"]) {
    if (result[platform].accessKey && !result[platform].appKey) {
      const brandAppKey = await getBrandAppKey(req, config);
      if (brandAppKey) {
        result[platform].appKey = brandAppKey;
        if (result[platform].source === "partial") {
          result[platform].source = "existing";
        }
      }
    }
  }

  return result;
}

async function fixMobileInstallation(req, config = salesIqConfig()) {
  const result = {
    screenName: config.screenName,
    appId: config.appId,
    androidBundle: config.androidBundleId,
    iosBundle: config.iosBundleId,
    android: { appKey: "", accessKey: "", source: "" },
    ios: { appKey: "", accessKey: "", source: "" },
  };

  for (const platform of ["android", "ios"]) {
    const expectedBundle =
      platform === "ios" ? config.iosBundleId : config.androidBundleId;
    let channel = null;

    try {
      channel = await getMobileChannel(req, platform, config);
    } catch (error) {
      if (!isMissingChannelError(error)) {
        throw error;
      }
    }

    if (channel?.bundleName && channel.bundleName !== expectedBundle) {
      const mismatch = new Error(
        "SalesIQ " +
          platform +
          " channel bundle is '" +
          channel.bundleName +
          "' but app expects '" +
          expectedBundle +
          "'. Update it in SalesIQ Console -> Brands -> Installation -> " +
          platform +
          "."
      );
      mismatch.status = 409;
      mismatch.payload = {
        platform,
        registered: channel.bundleName,
        expected: expectedBundle,
      };
      throw mismatch;
    }

    if (!channel?.appKey || !channel?.accessKey) {
      try {
        const created =
          platform === "ios"
            ? await createIosChannel(req, config)
            : await createAndroidChannel(req, config);
        result[platform] = {
          ...created,
          source: "created",
          registeredBundle: expectedBundle,
          bundleMatch: true,
        };
        continue;
      } catch (error) {
        const channelExists =
          error.status === 400 ||
          error.payload?.error?.code === 1408 ||
          String(error.message || "").includes("Channel already exists");
        if (!channelExists) {
          throw error;
        }
      }
    }

    let keys = await rotateAccessKey(req, platform, config);
    try {
      const refreshed = await getMobileChannel(req, platform, config);
      keys = {
        appKey: refreshed.appKey || keys.appKey,
        accessKey: refreshed.accessKey || keys.accessKey,
        version: refreshed.version || keys.version,
      };
      result[platform] = {
        ...keys,
        source: "rotated",
        registeredBundle: refreshed.bundleName || expectedBundle,
        bundleMatch: (refreshed.bundleName || expectedBundle) === expectedBundle,
      };
    } catch (error) {
      result[platform] = {
        ...keys,
        source: "rotated",
        registeredBundle: channel?.bundleName || expectedBundle,
        bundleMatch: (channel?.bundleName || expectedBundle) === expectedBundle,
      };
    }
  }

  return result;
}

async function ensureMobileKeys(req, config = salesIqConfig(), options = {}) {
  const rotate = Boolean(options?.rotate);
  const result = {
    screenName: config.screenName,
    appId: config.appId,
    androidBundle: config.androidBundleId,
    iosBundle: config.iosBundleId,
    android: { appKey: "", accessKey: "", source: "" },
    ios: { appKey: "", accessKey: "", source: "" },
  };

  for (const platform of ["android", "ios"]) {
    let keys = await fetchExistingMobileKeys(req, platform, config);
    if (keys.appKey && keys.accessKey) {
      result[platform] = { ...keys, source: "existing" };
      continue;
    }

    if (!rotate) {
      result[platform] = {
        appKey: keys.appKey || "",
        accessKey: keys.accessKey || "",
        version: keys.version || "",
        source: keys.appKey || keys.accessKey ? "partial" : "missing",
      };
      continue;
    }

    try {
      keys = await createChannelAccessKeys(req, platform, config);
      if (keys.appKey && keys.accessKey) {
        result[platform] = { ...keys, source: "rotated" };
        continue;
      }
    } catch (error) {
      const limitReached =
        error.payload?.error?.code === 1407 ||
        String(error.message || "").includes("Access keys limit reached");
      if (limitReached) {
        keys = await rotateAccessKey(req, platform, config);
        result[platform] = { ...keys, source: "rotated" };
        continue;
      }
      const channelExists =
        error.status === 400 ||
        error.payload?.error?.code === 1408 ||
        String(error.message || "").includes("Channel already exists");
      if (!channelExists) {
        throw error;
      }
    }

    try {
      keys =
        platform === "ios"
          ? await createIosChannel(req, config)
          : await createAndroidChannel(req, config);
      result[platform] = { ...keys, source: "created" };
      continue;
    } catch (error) {
      const channelExists =
        error.status === 400 ||
        error.payload?.error?.code === 1408 ||
        String(error.message || "").includes("Channel already exists");
      if (channelExists) {
        keys = await fetchExistingMobileKeys(req, platform, config);
        if (!keys.appKey || !keys.accessKey) {
          keys = await createChannelAccessKeys(req, platform, config);
          result[platform] = { ...keys, source: "rotated" };
        } else {
          result[platform] = { ...keys, source: "existing" };
        }
        continue;
      }
      throw error;
    }
  }

  return result;
}

module.exports = {
  salesIqConfig,
  getAccessToken,
  salesIqRequest,
  listApps,
  getMobileChannel,
  dumpMobileChannels,
  enableMobileChannels,
  getChannelDetails,
  getChannelAccessKeys,
  fetchExistingMobileKeys,
  createAndroidChannel,
  createIosChannel,
  createChannelAccessKeys,
  getAccessKeyListRaw,
  rotateAccessKey,
  getBrandAppKey,
  inspectChannelBundle,
  readMobileKeys,
  fixMobileInstallation,
  ensureMobileKeys,
};
