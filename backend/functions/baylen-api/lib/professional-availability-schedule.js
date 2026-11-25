"use strict";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validationError(message, field) {
  const error = new Error(message);
  error.status = 422;
  error.code = "VALIDATION_ERROR";
  if (field) {
    error.details = [{ field, message }];
  }
  throw error;
}

function parseScheduleJson(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function minutesFromTime(value) {
  const match = TIME_RE.exec(String(value || "").trim());
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeInterval(raw, dayKey) {
  if (!raw || typeof raw !== "object") {
    validationError("Each interval must be an object with start and end", dayKey);
  }
  const start = String(raw.start || "").trim();
  const end = String(raw.end || "").trim();
  if (!TIME_RE.test(start)) {
    validationError("Use HH:MM format for start time on " + dayKey, dayKey + ".start");
  }
  if (!TIME_RE.test(end)) {
    validationError("Use HH:MM format for end time on " + dayKey, dayKey + ".end");
  }
  const startMin = minutesFromTime(start);
  const endMin = minutesFromTime(end);
  if (endMin <= startMin) {
    validationError("End time must be after start time on " + dayKey, dayKey);
  }
  return { start, end };
}

function normalizeAvailabilitySchedule(input) {
  if (input == null || input === "") {
    return "";
  }
  const source = parseScheduleJson(input);
  if (!source) {
    validationError("availability_schedule must be a JSON object");
  }
  const normalized = {};
  for (const day of DAY_KEYS) {
    const rawDay = source[day];
    if (rawDay == null || rawDay === "") {
      continue;
    }
    if (!Array.isArray(rawDay)) {
      validationError("Each day must be an array of intervals", day);
    }
    const intervals = rawDay
      .map((interval) => normalizeInterval(interval, day))
      .filter(Boolean);
    if (intervals.length) {
      normalized[day] = intervals;
    }
  }
  return Object.keys(normalized).length ? JSON.stringify(normalized) : "";
}

function dayKeyFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  return DAY_KEYS[date.getDay()] || "";
}

function jobWindowMinutes(scheduledAt, durationMinutes) {
  const startMin = scheduledAt.getHours() * 60 + scheduledAt.getMinutes();
  const duration = Number(durationMinutes) > 0 ? Number(durationMinutes) : 60;
  return {
    start: startMin,
    end: startMin + duration,
  };
}

function intervalContainsJob(interval, jobWindow) {
  const startMin = minutesFromTime(interval.start);
  const endMin = minutesFromTime(interval.end);
  if (startMin == null || endMin == null) {
    return false;
  }
  return jobWindow.start >= startMin && jobWindow.end <= endMin;
}

/**
 * Returns whether a scheduled job fits the partner's stored weekly availability.
 * Empty/missing schedule = no restriction (backward compatible).
 */
function jobFitsPartnerSchedule(scheduleValue, scheduledAt, durationMinutes = 60) {
  const schedule = parseScheduleJson(scheduleValue);
  if (!schedule || !Object.keys(schedule).length) {
    return { ok: true, configured: false };
  }
  if (!(scheduledAt instanceof Date) || Number.isNaN(scheduledAt.getTime())) {
    return { ok: true, configured: true, skipped: true };
  }
  const dayKey = dayKeyFromDate(scheduledAt);
  const dayIntervals = Array.isArray(schedule[dayKey]) ? schedule[dayKey] : [];
  if (!dayIntervals.length) {
    return { ok: false, configured: true, reason: "OUTSIDE_AVAILABILITY_WINDOW", day: dayKey };
  }
  const jobWindow = jobWindowMinutes(scheduledAt, durationMinutes);
  const fits = dayIntervals.some((interval) => intervalContainsJob(interval, jobWindow));
  return fits
    ? { ok: true, configured: true, day: dayKey }
    : { ok: false, configured: true, reason: "OUTSIDE_AVAILABILITY_WINDOW", day: dayKey };
}

function summarizeSchedule(scheduleValue) {
  const schedule = parseScheduleJson(scheduleValue);
  if (!schedule) {
    return { configured: false, days: [] };
  }
  const days = DAY_KEYS.filter((day) => Array.isArray(schedule[day]) && schedule[day].length)
    .map((day) => ({
      day,
      intervals: schedule[day],
    }));
  return { configured: days.length > 0, days };
}

module.exports = {
  DAY_KEYS,
  parseScheduleJson,
  normalizeAvailabilitySchedule,
  jobFitsPartnerSchedule,
  summarizeSchedule,
};
