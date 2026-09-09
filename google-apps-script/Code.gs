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
const SHEET_ID = "1h5oUMrfW9CdpjlCf5lbvDiM6bxm9RvNyUxL4CbFXXMo";
const FOLDER_ID = "1Hm0qelNvrXQnv5aGJ7mVRv2Wx9cYSaEO";
// Change this if the active tab in Alison's sheet is not named "Sheet1".
const SHEET_NAME = "Sheet1";
// Must match GOOGLE_APP_SECRET in the app's environment variables.
// Any long random string. Prevents strangers who find the URL from posting.
const SHARED_SECRET = "PASTE_YOUR_GOOGLE_APP_SECRET_HERE";
// ===========================

const CATEGORIES = ["Art", "Bag", "Clothing", "Decor", "Jewelry", "Keychains", "Random", "Shoes"];

function getNextItemId(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 1; // header only
  const lastId = parseInt(sheet.getRange(lastRow, 1).getValue(), 10);
  return isFinite(lastId) ? lastId + 1 : lastRow;
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");

    if (body.secret !== SHARED_SECRET) {
      return respond(401, { error: "Unauthorized." });
    }

    const item = String(body.item || "").trim();
    const cost = parseFloat(body.cost);
    let category = String(body.category || "Other").trim();
    if (!CATEGORIES.includes(category)) category = "Other";
    if (!item) return respond(400, { error: "Item name is required." });
    if (!isFinite(cost) || cost < 0)
      return respond(400, { error: "A valid cost is required." });

    // 1. Save the photo to Drive (if provided) for visual backup.
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
    }

    // 2. Append the row. If this fails, delete the photo so orphaned
    //    files don't silently accumulate in the folder.
    const salePrice = parseFloat(body.sale_price);
    try {
      const sheets = SpreadsheetApp.openById(SHEET_ID).getSheets();
      if (!sheets.length) throw new Error("No sheets found in spreadsheet.");
      const sheet = sheets[0]; // first tab
      const nextId = getNextItemId(sheet);
      sheet.appendRow([
        nextId,
        category,
        item,
        cost.toFixed(2),
        isFinite(salePrice) ? salePrice.toFixed(2) : "",
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
