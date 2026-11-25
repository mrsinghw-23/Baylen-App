"use strict";

const EVENT_LABELS = {
  BOOKING_CONFIRMED: "Booking confirmed",
  PROVIDER_ASSIGNED: "Professional assigned",
  PROVIDER_ACCEPTED: "Professional confirmed your booking",
  PROVIDER_EN_ROUTE: "Professional is on the way",
  PROVIDER_ARRIVED: "Professional has arrived",
  OTP_ISSUED: "Arrival code sent",
  OTP_VERIFIED: "Arrival verified — service starting",
  SERVICE_STARTED: "Service in progress",
  SERVICE_COMPLETED: "Service completed",
  EXTRA_SERVICE_REQUESTED: "Additional service requested",
  EXTRA_SERVICE_APPROVED: "Additional service approved",
  EXTRA_SERVICE_DECLINED: "Additional service declined",
  BOOKING_CANCELLED: "Booking cancelled",
};

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

async function emitJobEvent(app, { jobId, userId, providerId, event, status, note }) {
  const label = EVENT_LABELS[event] || event;
  const timelineNote = note || label;
  try {
    await app.datastore().table("Job_Timeline").insertRow({
      job_id: jobId,
      provider_id: providerId || null,
      status: status || event,
      note: timelineNote,
      happened_at: nowSql(),
    });
  } catch (_) {}

  if (userId) {
    try {
      await app.datastore().table("Notifications").insertRow({
        user_id: userId,
        type: "SERVICE",
        title: "Home service update",
        body: label,
        reference_type: "JOB",
        reference_id: jobId,
        delivery_status: "PENDING",
        read_at: null,
      });
    } catch (_) {}
  }

  return { event, label };
}

module.exports = {
  EVENT_LABELS,
  emitJobEvent,
};
