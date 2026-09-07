/**
 * Alison's Inventory — Google Apps Script web app.
 *
 * Setup:
 *   1. Go to https://script.google.com → New project → paste this file.
 *   2. Fill in SHEET_ID, FOLDER_ID, and SHARED_SECRET below.
 *   3. Deploy → New deployment → type "Web app":
 *        - Execute as: Me
 *        - Who has access: Anyone
 *   4. Copy the /exec URL into GOOGLE_APPS_SCRIPT_URL on the server.
 *
 * The web app runs as the Google account owner, so it uses your Drive
 * storage quota — no service-account quota problems.
 */

// ===== CONFIGURE THESE =====
const SHEET_ID = "1xsPn9KjBDoVX4mU4Y7_0p8iVZ3_gZTjwd0Zj9K7-MSA";
const FOLDER_ID = "19ZeCyt4NRpXUPYzIUfqBE91S6nFapcic";
const SHEET_NAME = "Sheet1";
// Must match GOOGLE_APP_SECRET in the app's environment variables.
// Any long random string. Prevents strangers who find the URL from posting.
const SHARED_SECRET = "PASTE_YOUR_GOOGLE_APP_SECRET_HERE";
// ===========================

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");

    if (body.secret !== SHARED_SECRET) {
      return respond(401, { error: "Unauthorized." });
    }

    const item = String(body.item || "").trim();
    const description = String(body.description || "").trim();
    const cost = parseFloat(body.cost);
    if (!item) return respond(400, { error: "Item name is required." });
    if (!isFinite(cost) || cost < 0)
      return respond(400, { error: "A valid cost is required." });

    // 1. Save the photo to Drive (if provided).
    let photoLink = "";
    let uploadedFile = null;
    if (body.photo && body.photo.data) {
      const bytes = Utilities.base64Decode(body.photo.data);
      const blob = Utilities.newBlob(
        bytes,
        body.photo.mimeType || "image/jpeg",
        body.photo.name || "photo.jpg"
      );
      uploadedFile = DriveApp.getFolderById(FOLDER_ID).createFile(blob);
      uploadedFile.setName(
        Utilities.formatDate(new Date(), "America/New_York", "yyyyMMdd-HHmmss") +
          " - " +
          item.substring(0, 40) +
          "." +
          (blob.getName().split(".").pop() || "jpg")
      );
      photoLink = uploadedFile.getUrl();
    }

    // 2. Append the row. If this fails, delete the photo so orphaned
    //    files don't silently accumulate in the folder.
    const suggestedPrice = parseFloat(body.suggested_price);
    try {
      SpreadsheetApp.openById(SHEET_ID)
        .getSheetByName(SHEET_NAME)
        .appendRow([
          new Date(),
          item,
          description,
          cost.toFixed(2),
          photoLink,
          isFinite(suggestedPrice) ? suggestedPrice.toFixed(2) : "",
        ]);
    } catch (sheetErr) {
      if (uploadedFile) uploadedFile.setTrashed(true);
      throw sheetErr;
    }

    return respond(200, { ok: true });
  } catch (err) {
    return respond(500, { error: String(err && err.message ? err.message : err) });
  }
}

function respond(status, obj) {
  // Apps Script can't set HTTP status codes; the status is in the body
  // and the Next.js API route reads it.
  return ContentService.createTextOutput(
    JSON.stringify(Object.assign({ status: status }, obj))
  ).setMimeType(ContentService.MimeType.JSON);
}
