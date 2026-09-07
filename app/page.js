"use client";

import { useEffect, useRef, useState } from "react";

export default function AddItemPage() {
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [item, setItem] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [status, setStatus] = useState("idle"); // idle | saving | success | error
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef(null);

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
    } catch (err) {
      setErrorMsg(err.message || "Could not read that photo.");
      setStatus("error");
    }
  }

  function resetForm() {
    setItem("");
    setDescription("");
    setCost("");
    setPhoto(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
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

  const saving = status === "saving";

  return (
    <main style={styles.main}>
      <h1 style={styles.h1}>Add Item</h1>

      <form onSubmit={onSubmit} style={styles.form}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onPhotoChange}
          style={{ display: "none" }}
          id="photo-input"
        />
        <button
          type="button"
          style={styles.photoButton}
          onClick={() => fileInputRef.current?.click()}
          disabled={saving}
        >
          {photoPreview ? (
            <img src={photoPreview} alt="Selected" style={styles.preview} />
          ) : (
            <span style={styles.photoLabel}>📷&nbsp; Add Photo</span>
          )}
        </button>

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

        <label style={styles.label}>
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
  photoButton: {
    width: "100%",
    minHeight: 160,
    border: "2px dashed #9db894",
    borderRadius: 12,
    background: "#f4f8f2",
    fontSize: 20,
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
