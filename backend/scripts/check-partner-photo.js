#!/usr/bin/env node
"use strict";
const path = require("path");
const { createDevCatalystClient, unwrap } = require(path.join(__dirname, "lib/dev-catalyst-client"));
const { findKycRegRow } = require(path.join(__dirname, "../functions/baylen-api/lib/delivery-partner-registration"));
const { mapPartnerPhotoUrls, partnerHasStoredPhoto } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/delivery-partner-photo"
));

async function main() {
  const ctx = await createDevCatalystClient();
  const id = process.argv[2] || "36851000000403039";
  const partner = unwrap(
    await ctx.zcql.query(
      "SELECT ROWID, profile_photo_url, first_name, last_name FROM Delivery_Partners WHERE ROWID = " + id
    ),
    "Delivery_Partners"
  )[0];
  const kyc = await findKycRegRow(ctx.app.zcql(), id, partner);
  const photo = mapPartnerPhotoUrls(String(id), partner, kyc, { scope: "employee" });
  console.log(
    JSON.stringify(
      {
        partner,
        kyc: kyc
          ? {
              ROWID: kyc.ROWID,
              profile_photo_file_id: kyc.profile_photo_file_id,
              profile_photo_folder_id: kyc.profile_photo_folder_id,
              identity_document_file_id: kyc.identity_document_file_id,
              registration_phase: kyc.registration_phase,
            }
          : null,
        photo,
        partnerHasStoredPhoto: partnerHasStoredPhoto(partner, kyc),
      },
      null,
      2
    )
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
