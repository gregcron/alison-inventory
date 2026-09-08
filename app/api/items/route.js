export const runtime = "nodejs";

// Forwards the submission to the Google Apps Script web app, which runs as
// the Google account owner (so Drive storage quota works on personal
// accounts). The Apps Script saves the photo to the Drive folder and appends
// the row to the Sheet, deleting the photo if the sheet append fails.

export async function POST(request) {
  try {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    const secret = process.env.GOOGLE_APP_SECRET;
    if (!scriptUrl || !secret) {
      return Response.json(
        { error: "Server is missing Google Apps Script configuration." },
        { status: 500 }
      );
    }

    const form = await request.formData();
    const item = (form.get("item") || "").toString().trim();
    const description = (form.get("description") || "").toString().trim();
    const cost = parseFloat((form.get("cost") || "").toString().trim());
    const photo = form.get("photo");

    if (!item) {
      return Response.json({ error: "Item name is required." }, { status: 400 });
    }
    if (!Number.isFinite(cost) || cost < 0) {
      return Response.json({ error: "A valid cost is required." }, { status: 400 });
    }

    const payload = {
      secret,
      item,
      description,
      cost,
    };
    const suggestedPrice = parseFloat(
      (form.get("suggested_price") || "").toString()
    );
    if (Number.isFinite(suggestedPrice) && suggestedPrice >= 0) {
      payload.suggested_price = suggestedPrice;
    }
    const salePrice = parseFloat((form.get("sale_price") || "").toString());
    if (Number.isFinite(salePrice) && salePrice >= 0) {
      payload.sale_price = salePrice;
    }
    const photoFileId = (form.get("photo_file_id") || "").toString().trim();
    if (photoFileId) payload.photo_file_id = photoFileId;

    if (photo && typeof photo === "object" && photo.size > 0) {
      if (photo.size > 20 * 1024 * 1024) {
        return Response.json({ error: "Photo is too large." }, { status: 400 });
      }
      payload.photo = {
        name: photo.name || "photo.jpg",
        mimeType: photo.type || "image/jpeg",
        data: Buffer.from(await photo.arrayBuffer()).toString("base64"),
      };
    }

    // Apps Script web apps answer POST with a 302 to googleusercontent.com;
    // fetch follows it and the final response body is our JSON result.
    const res = await fetch(scriptUrl, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      return Response.json(
        { error: `Google Apps Script returned an unexpected response (${res.status}).` },
        { status: 502 }
      );
    }

    const status = data.status || (res.ok ? 200 : 500);
    if (status >= 400) {
      return Response.json(
        { error: data.error || "Saving to Google failed." },
        { status }
      );
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Save failed:", err);
    return Response.json(
      { error: err?.message || "Unexpected server error." },
      { status: 500 }
    );
  }
}
