"use client";

import { useEffect, useRef, useState } from "react";

export default function AddItemPage() {
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [item, setItem] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [status, setStatus] = useState("idle"); // idle | saving | success | error
  const [errorMsg, setErrorMsg] = useState("");
  const [researching, setResearching] = useState(false);
  const [research, setResearch] = useState(null);
  const cameraInputRef = useRef(null);
  const libraryInputRef = useRef(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js");
    }
  }, []);

  // Downscale to a max dimension and re-encode as JPEG — reference photos
  // don't need full resolution, and it makes upload much faster.
  const MAX_DIM = 1280;
  const JPEG_QUALITY = 0.8;

  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        const scale = Math.min(1, MAX_DIM / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error("Could not process photo."));
            resolve(
              new File([blob], "photo.jpg", { type: "image/jpeg" })
            );
          },
          "image/jpeg",
          JPEG_QUALITY
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read that photo."));
      };
      img.src = url;
    });
  }

  async function onPhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("idle");
    try {
      const resized = await resizeImage(file);
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhoto(resized);
      setPhotoPreview(URL.createObjectURL(resized));
      setResearch(null);
    } catch (err) {
      setErrorMsg(err.message || "Could not read that photo.");
      setStatus("error");
    }
  }

  function resetForm() {
    setItem("");
    setDescription("");
    setCost("");
    setSalePrice("");
    setPhoto(null);
    setResearch(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (libraryInputRef.current) libraryInputRef.current.value = "";
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (status === "saving") return;

    const costNum = parseFloat(cost);
    if (!item.trim()) {
      setErrorMsg("Please enter an item name.");
      setStatus("error");
      return;
    }
    if (!Number.isFinite(costNum) || costNum < 0) {
      setErrorMsg("Please enter a valid cost.");
      setStatus("error");
      return;
    }

    setStatus("saving");
    setErrorMsg("");

    try {
      const fd = new FormData();
      fd.append("item", item.trim());
      fd.append("description", description.trim());
      fd.append("cost", costNum.toFixed(2));
      const saleNum = parseFloat(salePrice);
      if (Number.isFinite(saleNum) && saleNum >= 0)
        fd.append("sale_price", saleNum);
      if (research?.suggested_sale_price != null)
        fd.append("suggested_price", research.suggested_sale_price);
      if (photo) fd.append("photo", photo);

      const res = await fetch("/api/items", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Save failed (${res.status})`);
      }

      resetForm();
      setStatus("success");
    } catch (err) {
      setErrorMsg(err.message || "Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  async function onIdentify() {
    if (!photo || researching) return;
    setResearching(true);
    setErrorMsg("");
    try {
      const fd = new FormData();
      fd.append("photo", photo);
      const res = await fetch("/api/research", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Research failed (${res.status})`);
      setResearch(data);
      if (data.item) setItem(data.item);
      if (data.description) setDescription(data.description);
      if (data.suggested_sale_price != null)
        setSalePrice(String(data.suggested_sale_price));
    } catch (err) {
      setErrorMsg(err.message || "Identification failed. You can still save manually.");
      setStatus("error");
    } finally {
      setResearching(false);
    }
  }

  function onLensSearch() {
    if (!photo) return;
    // Google Lens accepts a direct image POST and redirects to results.
    // A real form submit is used so it opens as a navigation (no CORS).
    const form = document.createElement("form");
    form.method = "POST";
    form.action = `https://lens.google.com/v3/upload?stcs=${Date.now()}`;
    form.target = "_blank";
    form.enctype = "multipart/form-data";
    const input = document.createElement("input");
    input.type = "file";
    input.name = "encoded_image";
    const dt = new DataTransfer();
    dt.items.add(photo);
    input.files = dt.files;
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  }

  const saving = status === "saving";

  return (
    <main style={styles.main}>
      <h1 style={styles.h1}>Add Item</h1>

      <form onSubmit={onSubmit} style={styles.form}>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPhotoChange}
          style={{ display: "none" }}
        />
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/*"
          onChange={onPhotoChange}
          style={{ display: "none" }}
        />
        {photoPreview ? (
          <button
            type="button"
            style={styles.photoButton}
            onClick={() => cameraInputRef.current?.click()}
            disabled={saving}
            title="Tap to retake photo"
          >
            <img src={photoPreview} alt="Selected" style={styles.preview} />
          </button>
        ) : (
          <div style={styles.photoRow}>
            <button
              type="button"
              style={{ ...styles.photoButton, ...styles.photoHalf }}
              onClick={() => cameraInputRef.current?.click()}
              disabled={saving}
            >
              <span style={styles.photoLabel}>📷&nbsp; Take Photo</span>
            </button>
            <button
              type="button"
              style={{ ...styles.photoButton, ...styles.photoHalf }}
              onClick={() => libraryInputRef.current?.click()}
              disabled={saving}
            >
              <span style={styles.photoLabel}>🖼&nbsp; Choose Photo</span>
            </button>
          </div>
        )}

        {photoPreview && (
          <div style={styles.actionRow}>
            <button
              type="button"
              style={styles.researchButton}
              onClick={onIdentify}
              disabled={saving || researching}
            >
              {researching ? "🔍 Researching… (about 10s)" : "✨ Identify & Price"}
            </button>
            <button
              type="button"
              style={styles.lensButton}
              onClick={onLensSearch}
              disabled={saving || researching}
              title="Open Google Lens results for this photo in a new tab"
            >
              🔎 Lens
            </button>
          </div>
        )}

        {research && (
          <div style={styles.researchPanel}>
            {research.suggested_sale_price != null ? (
              <p style={styles.price}>
                Suggested: <strong>${research.suggested_sale_price}</strong>
                {research.suggested_price_low != null &&
                  research.suggested_price_high != null &&
                  ` (range $${research.suggested_price_low}–$${research.suggested_price_high})`}
                {research.confidence ? ` · ${research.confidence} confidence` : ""}
              </p>
            ) : (
              <p style={styles.price}>No price suggestion — not enough evidence.</p>
            )}
            {(research.comparables || []).slice(0, 4).map((c, i) => (
              <p key={i} style={styles.comp}>
                {c.price_type === "sold" ? "✓ sold" : c.price_type || "asking"}
                {c.price != null ? ` $${c.price}` : ""} — {c.title}{" "}
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer" style={styles.link}>
                    link
                  </a>
                ) : null}
              </p>
            ))}
            {(research.warnings || []).map((w, i) => (
              <p key={i} style={styles.warn}>⚠ {w}</p>
            ))}
          </div>
        )}

        <label style={styles.label}>
          Item *
          <input
            type="text"
            value={item}
            onChange={(e) => setItem(e.target.value)}
            required
            autoComplete="off"
            placeholder="e.g. Brass candlestick"
            style={styles.input}
            disabled={saving}
          />
        </label>

        <label style={styles.label}>
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Optional notes"
            style={{ ...styles.input, resize: "vertical" }}
            disabled={saving}
          />
        </label>

        <div style={styles.priceRow}>
          <label style={{ ...styles.label, ...styles.priceField }}>
            Cost *
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              required
              placeholder="0.00"
              style={styles.input}
              disabled={saving}
            />
          </label>
          <label style={{ ...styles.label, ...styles.priceField }}>
            Sale Price
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              placeholder="optional"
              style={styles.input}
              disabled={saving}
            />
          </label>
        </div>

        <button type="submit" style={styles.save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>

        {status === "success" && (
          <p style={styles.success} role="status">
            ✓ Saved to inventory!
          </p>
        )}
        {status === "error" && (
          <p style={styles.error} role="alert">
            {errorMsg}
          </p>
        )}
      </form>
    </main>
  );
}

const styles = {
  main: {
    maxWidth: 480,
    margin: "0 auto",
    padding: "16px",
    paddingTop: "max(16px, env(safe-area-inset-top))",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    minHeight: "100vh",
    boxSizing: "border-box",
  },
  h1: { fontSize: 24, margin: "8px 0 16px", color: "#333" },
  form: { display: "flex", flexDirection: "column", gap: 14 },
  photoRow: { display: "flex", gap: 12 },
  priceRow: { display: "flex", gap: 12, maxWidth: 420 },
  priceField: { flex: "1 1 0", minWidth: 0 },
  photoHalf: { flex: 1 },
  photoButton: {
    width: "100%",
    minHeight: 160,
    border: "2px dashed #9db894",
    borderRadius: 12,
    background: "#f4f8f2",
    fontSize: 18,
    color: "#4a6741",
    cursor: "pointer",
    padding: 0,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  preview: {
    width: "100%",
    maxHeight: 280,
    objectFit: "cover",
    display: "block",
  },
  photoLabel: { padding: 24 },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 15,
    fontWeight: 600,
    color: "#444",
  },
  input: {
    fontSize: 17, // >=16px prevents iOS auto-zoom
    width: "100%",
    boxSizing: "border-box",
    minWidth: 0,
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid #ccc",
    fontWeight: 400,
  },
  save: {
    marginTop: 4,
    padding: "16px",
    fontSize: 18,
    fontWeight: 700,
    color: "#fff",
    background: "#4a6741",
    border: "none",
    borderRadius: 12,
    cursor: "pointer",
  },
  actionRow: { display: "flex", gap: 10 },
  researchButton: {
    flex: 1,
    padding: "12px",
    fontSize: 16,
    fontWeight: 600,
    color: "#4a6741",
    background: "#eef4ec",
    border: "1px solid #9db894",
    borderRadius: 12,
    cursor: "pointer",
  },
  lensButton: {
    padding: "12px 18px",
    fontSize: 16,
    fontWeight: 600,
    color: "#4a6741",
    background: "#eef4ec",
    border: "1px solid #9db894",
    borderRadius: 12,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  researchPanel: {
    background: "#f7f9f6",
    border: "1px solid #d8e2d4",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 14,
    color: "#333",
  },
  price: { margin: "4px 0 8px", fontSize: 15 },
  comp: { margin: "3px 0", lineHeight: 1.35, color: "#555" },
  link: { color: "#2e6da4", marginLeft: 4 },
  warn: { margin: "4px 0", color: "#8a6d00", fontSize: 13 },
  success: {
    textAlign: "center",
    color: "#2e7d32",
    fontWeight: 700,
    fontSize: 17,
    margin: 0,
  },
  error: {
    textAlign: "center",
    color: "#c62828",
    fontWeight: 600,
    fontSize: 15,
    margin: 0,
  },
};
