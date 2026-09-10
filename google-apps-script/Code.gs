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
const SHEET_NAME = "Inventory";
// Must match GOOGLE_APP_SECRET in the app's environment variables.
// Any long random string. Prevents strangers who find the URL from posting.
const SHARED_SECRET = "e747b589de84adaa9633de0fe3e8bdf0d07e3e897043a62d";
// ===========================

const CATEGORIES = ["Art", "Bag", "Clothing", "Decor", "Jewelry", "Keychains", "Random", "Shoes"];

function getHeaderMap(sheet) {
  const values = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0];
  const map = {};
  values.forEach((v, i) => {
    const name = String(v || "").trim();
    if (name) map[name] = i + 1; // 1-based column index
  });
  return map;
}

// Find the last row that has actual inventory data by scanning a key column
// (Item) downward. This avoids being thrown off by pre-filled dropdown cells
// in other columns that extend far below the real data.
function getLastDataRow(sheet, headers) {
  const col = headers["Item"] || headers["Item ID"] || 1;
  const values = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues();
  let lastData = 0; // 0 = no data rows
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() !== "") lastData = i + 1; // 1-based within data
  }
  return lastData + 1; // +1 for header row = actual sheet row of last data
}

function getNextItemId(sheet, headers, lastDataRow) {
  var col = headers["Item ID"];
  if (!col) throw new Error('Missing "Item ID" column header.');
  if (lastDataRow <= 1) return 1; // header only
  var lastId = parseInt(sheet.getRange(lastDataRow, col).getValue(), 10);
  return isFinite(lastId) ? lastId + 1 : lastDataRow;
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

    // 2. Append the row. We map columns by header name so column order
    //    can change without breaking the app. If this fails, delete the
    //    photo so orphaned files don't silently accumulate in the folder.
    const salePrice = parseFloat(body.sale_price);
    try {
      let sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
      if (!sheet) {
        const sheets = SpreadsheetApp.openById(SHEET_ID).getSheets();
        if (!sheets.length) throw new Error("No sheets found in spreadsheet.");
        sheet = sheets[0]; // fall back to first tab
      }
      const headers = getHeaderMap(sheet);

      // Build a row covering all existing columns, defaulting to empty.
      const numCols = sheet.getLastColumn() || Object.keys(headers).length;
      const row = new Array(numCols).fill("");

      var lastDataRow = getLastDataRow(sheet, headers);
      var insertRow = lastDataRow + 1; // row right after last data

      if (headers["Item ID"])
        row[headers["Item ID"] - 1] = getNextItemId(sheet, headers, lastDataRow);
      if (headers["Purchase Date"])
        row[headers["Purchase Date"] - 1] = Utilities.formatDate(
          new Date(),
          "America/New_York",
          "M/d/yyyy"
        );
      if (headers["Category"]) row[headers["Category"] - 1] = category;
      if (headers["Item"]) row[headers["Item"] - 1] = item;
      if (headers["Cost"]) row[headers["Cost"] - 1] = cost;
      if (headers["Sale Price"])
        row[headers["Sale Price"] - 1] = isFinite(salePrice) ? salePrice : "";
      if (headers["Image"] && uploadedFile)
        row[headers["Image"] - 1] = uploadedFile.getUrl();
      if (headers["Location"])
        row[headers["Location"] - 1] = "Home";
      if (headers["Status"])
        row[headers["Status"] - 1] = "In Stock";

      // Write into the correct row instead of appendRow, which would land
      // after pre-filled dropdown cells at the bottom of the sheet.
      sheet.getRange(insertRow, 1, 1, row.length).setValues([row]);
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
