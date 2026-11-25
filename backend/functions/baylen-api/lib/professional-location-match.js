"use strict";

function normalizePlace(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function placesMatch(left, right) {
  const a = normalizePlace(left);
  const b = normalizePlace(right);
  if (!a || !b) {
    return false;
  }
  return a === b || a.includes(b) || b.includes(a);
}

function normalizePincode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 6);
}

function partnerLocationFromRow(row) {
  if (!row) {
    return { country: "India", state: "", district: "", city: "", pincode: "", service_zone: "" };
  }
  return {
    country: row.country || "India",
    state: row.state || "",
    district: row.district || "",
    city: row.city || "",
    pincode: normalizePincode(row.postal_code || row.pincode),
    service_zone: row.service_zone || "",
  };
}

/**
 * Mandatory location gate: State → District → optional pincode bonus.
 * Missing partner location when the job has a state/district is a mismatch.
 */
function evaluateLocationEligibility(partnerLocation, jobLocation) {
  const reasons = [];
  const partner = partnerLocationFromRow(partnerLocation);
  const jobCountry = jobLocation?.country || "India";
  const jobState = jobLocation?.visit_state || jobLocation?.state || "";
  const jobDistrict = jobLocation?.visit_district || jobLocation?.district || "";
  const jobCity = jobLocation?.visit_city || "";
  const jobServiceZone = String(jobLocation?.service_zone || "").trim();
  const jobPincode = normalizePincode(jobLocation?.pincode);
  const hasPartnerLocation = Boolean(
    partner.state || partner.district || partner.city || partner.pincode || partner.service_zone
  );

  if (jobCountry && hasPartnerLocation && partner.country) {
    if (!placesMatch(partner.country, jobCountry)) {
      reasons.push("LOCATION_COUNTRY_MISMATCH");
    }
  }

  if (jobState) {
    if (!hasPartnerLocation) {
      reasons.push("PARTNER_LOCATION_UNCONFIGURED");
    } else if (partner.state && !placesMatch(partner.state, jobState)) {
      reasons.push("LOCATION_STATE_MISMATCH");
    } else if (!partner.state) {
      reasons.push("LOCATION_STATE_MISMATCH");
    }
  }

  let district_match = true;
  if (jobDistrict && hasPartnerLocation) {
    const partnerDistrict = partner.district || partner.city;
    if (
      partnerDistrict &&
      !placesMatch(partnerDistrict, jobDistrict) &&
      !placesMatch(partner.city, jobCity || jobDistrict)
    ) {
      district_match = false;
    }
  }

  if (jobServiceZone && hasPartnerLocation) {
    if (!partner.service_zone || !placesMatch(partner.service_zone, jobServiceZone)) {
      reasons.push("LOCATION_SERVICE_ZONE_MISMATCH");
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    district_match,
    pincode_match: Boolean(jobPincode && partner.pincode && jobPincode === partner.pincode),
    service_zone_match: Boolean(
      partner.service_zone &&
        jobLocation?.service_zone &&
        placesMatch(partner.service_zone, jobLocation.service_zone)
    ),
    partner,
    job: {
      country: jobCountry,
      state: jobState,
      district: jobDistrict,
      city: jobCity,
      pincode: jobPincode,
      service_zone: jobServiceZone,
    },
  };
}

module.exports = {
  normalizePlace,
  placesMatch,
  normalizePincode,
  partnerLocationFromRow,
  evaluateLocationEligibility,
};
