export const runtime = "nodejs";

// Uploads the photo via the Apps Script (temporarily link-shared in Drive)
// and returns a Google Lens image-search URL for it.

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
    const photo = form.get("photo");
    if (!photo || typeof photo !== "object" || photo.size === 0) {
      return Response.json({ error: "A photo is required." }, { status: 400 });
    }

    const res = await fetch(scriptUrl, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        action: "lens",
        photo: {
          name: photo.name || "photo.jpg",
          mimeType: photo.type || "image/jpeg",
          data: Buffer.from(await photo.arrayBuffer()).toString("base64"),
        },
      }),
    });

    const data = await res.json().catch(() => ({}));
    const status = data.status || (res.ok ? 200 : 500);
    if (status >= 400 || !data.image_url) {
      return Response.json(
        { error: data.error || "Could not prepare the photo for Lens." },
        { status: status >= 400 ? status : 502 }
      );
    }

    return Response.json({
      file_id: data.file_id,
      lens_url:
        "https://www.google.com/searchbyimage?image_url=" +
        encodeURIComponent(data.image_url),
    });
  } catch (err) {
    console.error("Lens prep failed:", err);
    return Response.json(
      { error: err?.message || "Unexpected server error." },
      { status: 500 }
    );
  }
}
