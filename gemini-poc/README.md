# Gemini Antique Research POC

Standalone experiment: can a multimodal LLM + live web search replace the
manual "photo → Google image search → browse listings → decide price" workflow?

**Not connected to the inventory PWA.**

## How it works

Two API calls per photo:

1. **Grounded research** — the image + a detailed research prompt go to Gemini
   with the `googleSearch` tool enabled. The model reads markings, formulates
   search queries, inspects results, finds comparable marketplace listings
   (eBay, Etsy, Chairish, 1stDibs, WorthPoint, LiveAuctioneers, etc.), and
   writes a narrative report.
2. **Structuring** — the narrative is converted to strict JSON
   (`identification`, `proposed_inventory`, `research.comparables` with real
   URLs, sold-vs-asking price types, warnings).

Grounding metadata (queries actually executed, cited sources) is preserved in
`result.grounding` so you can verify the research isn't fabricated.

## Setup

1. Get a Gemini API key: https://aistudio.google.com/apikey (free tier exists;
   note that **Search grounding has its own pricing** — check
   https://ai.google.dev/gemini-api/docs/google-search for current rates).
2. `cp .env.example .env` and set `GEMINI_API_KEY`.
   Optionally set `GEMINI_MODEL` (default `gemini-3.6-flash`).
3. `npm install` in this folder.

## Usage

```bash
node test-antique-research.js ../test-photos/photo.jpg   # single, prints report
node test-antique-research.js ../test-photos/            # batch
node test-antique-research.js ../test-photos/ --out results/
```

Output: `results/<name>.json` (full structured result incl. grounding
metadata) + `results/<name>.txt` (readable report) + `summary.json` for batch
runs. `results/` is gitignored.

## Evaluating

The key question: does it read the actual markings in the photo and return
real, verifiable comparables? Check `comparables[].url` — every link should
resolve to a real listing, and `price_type` should honestly say
`asking`/`sold`/`retail`/`reference`.
