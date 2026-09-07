# Alison's Inventory

A tiny mobile-first PWA for recording antique booth purchases. Open the app,
snap a photo, type the item name and cost, tap **Save** — a row is appended to
a Google Sheet and the photo lands in a Google Drive folder.

## Stack

- Next.js 13 (App Router) + React — single form page, one API route.
- A small **Google Apps Script web app** does the Google work: it runs as the
  sheet owner's account, so Drive storage quota works on a normal (personal)
  Google account — service accounts have no Drive storage quota and can't
  upload photos. No OAuth flow for the user.
- Hand-rolled PWA manifest + service worker (network-first, so deploys update
  immediately).

## Local development

```bash
npm install
node scripts/generate-icons.mjs   # creates public/icons/*.png (placeholders)
cp .env.example .env.local        # then fill in the values
npm run dev
```

Open http://localhost:3000.

## Environment variables

| Variable | Description |
|---|---|
| `GOOGLE_APPS_SCRIPT_URL` | The deployed Apps Script web app URL (ends in `/exec`) |
| `GOOGLE_APP_SECRET` | Any long random string — must match `SHARED_SECRET` in `Code.gs` |

## Google setup (one-time, ~10 min)

You already have the Sheet and Drive folder — this wires them to the app.

1. **Open Apps Script**: go to https://script.google.com → **New project**.
2. **Paste** the contents of [`google-apps-script/Code.gs`](google-apps-script/Code.gs)
   into the editor, replacing the default code.
3. **Configure** the constants at the top of the file:
   - `SHEET_ID` — from the sheet URL
     (`https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`)
   - `FOLDER_ID` — from the folder URL
     (`https://drive.google.com/drive/folders/<FOLDER_ID>`)
   - `SHEET_NAME` — the tab name (default `Sheet1`)
   - `SHARED_SECRET` — same random string you use for `GOOGLE_APP_SECRET`
4. **Deploy**: **Deploy → New deployment** → gear icon → **Web app**:
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**
   - Click **Deploy** and authorize when prompted (it runs as your account).
5. **Copy** the web app URL (ends in `/exec`) → set it as
   `GOOGLE_APPS_SCRIPT_URL`.

> **Heads-up:** if you ever edit `Code.gs` and redeploy, choose
> **Deploy → Manage deployments → edit → New version** — the URL stays the
> same. Selecting "New deployment" creates a *new* URL.

The sheet should have a header row: `Date | Item | Description | Cost | Photo`.
(The script doesn't need it, but it keeps the sheet readable.)

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel → **Add New → Project** → import the repo (Next.js is detected
   automatically; no build settings needed).
3. Add `GOOGLE_APPS_SCRIPT_URL` and `GOOGLE_APP_SECRET` in
   **Project → Settings → Environment Variables** (Production + Preview).
4. Deploy — HTTPS is automatic.

## Install on iPhone (PWA)

1. Open the deployed `https://…` URL in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. The app icon appears on the home screen and launches full-screen.

On Android/Chrome: menu → **Add to Home screen** / **Install app**.

## How saving works (reliability)

- The Save button disables while a submission is in flight — no duplicates.
- The API route sends the item + photo to the Apps Script, which (a) saves the
  photo to the Drive folder, then (b) appends
  `Date | Item | Description | Cost | <Drive link>` to the sheet.
- Success is only shown after **both** steps complete.
- If the sheet append fails after the photo was saved, the script trashes the
  file so orphaned photos don't accumulate.
- Failures show an error in the form and keep the entered data for retry —
  nothing is silently lost.
- `SHARED_SECRET`/`GOOGLE_APP_SECRET` means the public Apps Script URL alone
  can't be used to write rows.

## Notes / limitations

- Placeholder icons come from `scripts/generate-icons.mjs` — replace
  `public/icons/*.png` with real artwork whenever you like.
- The service worker only caches static assets and page navigations;
  `POST /api/items` always hits the network.
- The date is written by the Apps Script using its timezone (the script
  formats photo filenames in `America/New_York`; adjust in `Code.gs` if
  needed).
- Costs are appended as `0.00`-formatted values so Sheets treats them as
  numbers/currency.
