#!/usr/bin/env node
/**
 * Antique research POC: photo → Gemini multimodal + Google Search grounding
 * → identification, comparables, and a defensible booth sale price.
 *
 * Usage:
 *   node test-antique-research.js photo.jpg
 *   node test-antique-research.js photos/          (batch)
 *   node test-antique-research.js photos/ --out results/
 *
 * Config: copy .env.example to .env and set GEMINI_API_KEY
 * (https://aistudio.google.com/apikey). Optional: GEMINI_MODEL.
 */

require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

const RESEARCH_PROMPT = `You are an expert antiques and resale researcher. A photo of an item purchased for resale at an antique booth is attached.

Work through this process carefully — this is an iterative research task, not a single guess:

1. EXAMINE the image closely. Describe exactly what you see: object type, materials, color, construction details, style, condition.
2. READ any visible text: maker's marks, stamps, logos, labels, model numbers, signatures, tags, engraved text on hardware. Zoom in mentally on metal fittings, bases, labels. Report the exact text you can read.
3. IDENTIFY the item as specifically as the evidence allows (maker/brand, item type, pattern or model, approximate era). Distinguish clearly between facts visible in the image and inference.
4. SEARCH the web using the markings and details you found. Formulate targeted searches (e.g. specific brand + item type + material + era terms). Search again with refined queries if the first results are ambiguous.
5. FIND COMPARABLE LISTINGS on resale/marketplace/auction sites — eBay, Etsy, Chairish, 1stDibs, Ruby Lane, Poshmark, Mercari, Depop, ShopGoodwill, LiveAuctioneers, Invaluable, HiBid, WorthPoint, auction houses, antique dealers. Prefer sold/completed prices where genuinely available; never present an asking price as a sold price.
6. SYNTHESIZE a proposed inventory entry: item name, description, and a suggested antique-booth sale price with a low/high range. The price must be supported by the comparable evidence you found — a reasonable real-world resale asking price, not the highest dealer price. If the evidence is too thin for a defensible price, say so explicitly.

Be honest about uncertainty. Do not fabricate listings, URLs, or prices. For every comparable you cite, include the real URL from your search results.

Write your full findings as a structured narrative with these sections:
IDENTIFICATION — VISIBLE MARKINGS — RESEARCH NOTES (list every search query you ran and what it found) — COMPARABLES (for each: title, URL, source site, price, whether asking/sold/retail/reference, how closely it matches) — PRICING ANALYSIS — PROPOSED INVENTORY (item name, description, suggested price, low, high, confidence) — WARNINGS/UNCERTAINTIES`;

const JSON_PROMPT = `Convert the research report below into strict JSON matching exactly this schema. Use null for unknown values. "comparables" must only contain listings actually cited in the report with their real URLs — never invent one. "search_queries" should list every query mentioned in the research notes.

{
  "identification": {
    "brand_or_maker": "string|null",
    "item_type": "string|null",
    "model_or_pattern": "string|null",
    "era": "string|null",
    "materials": ["string"],
    "color": "string|null",
    "visible_markings": ["string"],
    "confidence": "high|medium|low"
  },
  "proposed_inventory": {
    "item": "string",
    "description": "string",
    "suggested_sale_price": "number|null",
    "suggested_price_low": "number|null",
    "suggested_price_high": "number|null",
    "price_confidence": "high|medium|low|none",
    "price_basis": "string — 1-3 sentences on how the evidence supports the price"
  },
  "research": {
    "search_queries": ["string"],
    "comparables": [
      {
        "title": "string",
        "url": "string",
        "source": "hostname e.g. ebay.com",
        "price": "number|null",
        "price_type": "asking|sold|retail|reference|unknown",
        "similarity": "high|medium|low",
        "notes": "string"
      }
    ]
  },
  "reasoning_summary": "string — 2-4 sentences",
  "warnings": ["string"]
}

Respond with ONLY the JSON object, no markdown fences, no commentary.

RESEARCH REPORT:
`;

const FAST_PROMPT = `You are an antique-booth pricing assistant. Examine this photo of a resale item.

STEP 1 — Look at the image. Identify the item and read ALL visible text/markings: maker's marks, logos, labels, stamps, signatures on hardware, bases, tags.

STEP 2 — Search Google before answering. You are REQUIRED to use Google Search — never price or identify from memory alone. Keep it fast: 1-3 targeted queries maximum. First verify/refine the identification using any markings found, then look up comparable resale prices (eBay, Etsy, Mercari, Poshmark, auction sites). Prefer sold/completed prices visible in snippets; never treat asking prices as sold. Stop as soon as you have enough for a reasonable booth price.

STEP 3 — Write 1-2 sentences summarizing what you found, then end your reply with a final JSON code block (triple-backtick json fence) matching this schema:
{
  "item": "short shelf-tag name (brand/maker + item type + key descriptor)",
  "description": "1-3 sentences for an inventory record",
  "suggested_sale_price": number|null,
  "suggested_price_low": number|null,
  "suggested_price_high": number|null,
  "confidence": "high|medium|low",
  "comparables": [{"title": "", "url": "copy the real URL from the search result", "source": "hostname", "price": 0, "price_type": "asking|sold|retail|reference|unknown"}],
  "visible_markings": ["exact text read from the image"],
  "warnings": ["string"]
}
Only include comparables that actually appeared in your search results — copy their URLs verbatim. If evidence is too thin for a defensible price, set prices to null and say so in warnings. Never invent listings, URLs, or prices.`;

const FAST_SCHEMA = {
  type: "object",
  properties: {
    item: { type: "string" },
    description: { type: "string" },
    suggested_sale_price: { type: "number", nullable: true },
    suggested_price_low: { type: "number", nullable: true },
    suggested_price_high: { type: "number", nullable: true },
    confidence: { type: "string" },
    comparables: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          source: { type: "string" },
          price: { type: "number", nullable: true },
          price_type: { type: "string" },
        },
      },
    },
    visible_markings: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["item", "description"],
};

async function analyzeImageFast(ai, file) {
  const imageBytes = fs.readFileSync(file);
  const imagePart = {
    inlineData: { data: imageBytes.toString("base64"), mimeType: MIME[path.extname(file).toLowerCase()] || "image/jpeg" },
  };

  const t0 = Date.now();
  // NOTE: responseSchema/responseMimeType is intentionally NOT used here —
  // forcing structured output suppresses the model's googleSearch tool use
  // (it answers from memory instead). JSON is enforced via the prompt.
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [imagePart, { text: FAST_PROMPT }] }],
    config: { tools: [{ googleSearch: {} }] },
  });
  const t1 = Date.now();

  let result;
  const text = res.text || "";
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/g);
  const candidate = fence
    ? fence[fence.length - 1].replace(/```(?:json)?\s*|```/g, "")
    : text.slice(text.indexOf("{"));
  try {
    result = JSON.parse(candidate.trim());
  } catch {
    result = { parse_error: true, raw: text };
  }

  const gm = res.candidates?.[0]?.groundingMetadata || {};
  result._debug = {
    search_queries_executed: gm.webSearchQueries || [],
    cited_sources: (gm.groundingChunks || []).map((c) => c.web).filter(Boolean)
      .map((w) => ({ title: w.title || "", url: w.uri || "" })),
    tokens: usageStr(res.usageMetadata),
  };

  return {
    result,
    researchText: res.text || "",
    meta: {
      model: MODEL,
      tokens: `single call: ${usageStr(res.usageMetadata)}`,
      groundedQueries: gm.webSearchQueries || [],
      timing: { research_ms: t1 - t0, json_ms: 0, total_ms: t1 - t0 },
    },
  };
}

function formatFastText(file, result, meta) {
  const L = [];
  L.push(`IMAGE: ${file}  [FAST MODE]`);
  L.push(`MODEL: ${meta.model}  |  tokens: ${meta.tokens}  |  searches: ${meta.groundedQueries.length}`);
  L.push(`TIMING: total=${(meta.timing.total_ms / 1000).toFixed(1)}s (single grounded call)`);
  L.push("");
  L.push(`  Item        : ${result.item || "?"}`);
  L.push(`  Description : ${result.description || "?"}`);
  L.push(`  Price       : ${fmtPrice(result.suggested_sale_price)}  (range ${fmtPrice(result.suggested_price_low)}–${fmtPrice(result.suggested_price_high)}, confidence: ${result.confidence || "?"})`);
  L.push(`  Markings    : ${(result.visible_markings || []).join(" | ") || "none read"}`);
  const comps = result.comparables || [];
  L.push(`  Comparables (${comps.length}):`);
  comps.forEach((c) => L.push(`    • [${c.price_type || "?"}] ${fmtPrice(c.price)} — ${c.title} (${c.source})\n      ${c.url}`));
  (result.warnings || []).forEach((w) => L.push(`  ⚠ ${w}`));
  return L.join("\n");
}

function usageStr(u) {
  if (!u) return "n/a";
  return `prompt=${u.promptTokenCount ?? "?"} completion=${u.candidatesTokenCount ?? "?"} total=${u.totalTokenCount ?? "?"}`;
}

function fmtPrice(v) {
  return v == null ? "n/a" : `$${Number(v).toFixed(2)}`;
}

function formatText(file, result, researchText, meta) {
  const id = result.identification || {};
  const inv = result.proposed_inventory || {};
  const comps = (result.research && result.research.comparables) || [];
  const queries = (result.research && result.research.search_queries) || [];
  const L = [];
  L.push(`IMAGE: ${file}`);
  L.push(`MODEL: ${meta.model}  |  tokens: ${meta.tokens}  |  grounding queries executed: ${meta.groundedQueries.length}`);
  L.push(`TIMING: research=${(meta.timing.research_ms / 1000).toFixed(1)}s json=${(meta.timing.json_ms / 1000).toFixed(1)}s total=${(meta.timing.total_ms / 1000).toFixed(1)}s`);
  L.push("");
  L.push("IDENTIFICATION");
  L.push(`  Maker/brand : ${id.brand_or_maker || "?"}`);
  L.push(`  Type        : ${id.item_type || "?"}`);
  L.push(`  Pattern     : ${id.model_or_pattern || "?"}`);
  L.push(`  Era         : ${id.era || "?"}`);
  L.push(`  Materials   : ${(id.materials || []).join(", ") || "?"}`);
  L.push(`  Color       : ${id.color || "?"}`);
  L.push(`  Markings    : ${(id.visible_markings || []).join(" | ") || "none read"}`);
  L.push(`  Confidence  : ${id.confidence || "?"}`);
  L.push("");
  L.push("PROPOSED INVENTORY");
  L.push(`  Item        : ${inv.item || "?"}`);
  L.push(`  Description : ${inv.description || "?"}`);
  L.push(`  Price       : ${fmtPrice(inv.suggested_sale_price)}  (range ${fmtPrice(inv.suggested_price_low)}–${fmtPrice(inv.suggested_price_high)}, confidence: ${inv.price_confidence || "?"})`);
  if (inv.price_basis) L.push(`  Basis       : ${inv.price_basis}`);
  L.push("");
  L.push(`SEARCH QUERIES (${queries.length})`);
  queries.forEach((q) => L.push(`  • ${q}`));
  L.push("");
  L.push(`COMPARABLES (${comps.length})`);
  comps.forEach((c, i) => {
    L.push(`  ${i + 1}. [${c.similarity || "?"} match | ${c.price_type || "?"}] ${c.title}`);
    L.push(`     ${fmtPrice(c.price)}  —  ${c.source || ""}`);
    L.push(`     ${c.url}`);
    if (c.notes) L.push(`     ${c.notes}`);
  });
  if (!comps.length) L.push("  (none)");
  L.push("");
  L.push("REASONING");
  L.push(`  ${result.reasoning_summary || ""}`);
  if ((result.warnings || []).length) {
    L.push("");
    L.push("WARNINGS");
    result.warnings.forEach((w) => L.push(`  ⚠ ${w}`));
  }
  L.push("");
  L.push("— RAW RESEARCH NARRATIVE ".padEnd(60, "—"));
  L.push(researchText);
  return L.join("\n");
}

async function analyzeImage(ai, file) {
  const imageBytes = fs.readFileSync(file);
  const imagePart = {
    inlineData: { data: imageBytes.toString("base64"), mimeType: MIME[path.extname(file).toLowerCase()] || "image/jpeg" },
  };

  const t0 = Date.now();

  // Step 1: grounded research
  const res1 = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [imagePart, { text: RESEARCH_PROMPT }] }],
    config: { tools: [{ googleSearch: {} }] },
  });
  const researchText = res1.text || "";
  const gm = res1.candidates?.[0]?.groundingMetadata || {};
  const groundedQueries = gm.webSearchQueries || [];
  const chunks = (gm.groundingChunks || [])
    .map((c) => c.web)
    .filter(Boolean)
    .map((w) => ({ title: w.title || "", url: w.uri || "" }));

  const t1 = Date.now();

  // Step 2: structure the narrative as JSON
  const res2 = await ai.models.generateContent({
    model: MODEL,
    contents: JSON_PROMPT + researchText,
    config: { responseMimeType: "application/json" },
  });
  let result;
  try {
    result = JSON.parse(res2.text);
  } catch {
    result = { parse_error: true, raw: res2.text };
  }

  // Attach grounding metadata for transparency.
  result.grounding = {
    search_queries_executed: groundedQueries,
    cited_sources: chunks,
  };

  const t2 = Date.now();
  const tokens = `research: ${usageStr(res1.usageMetadata)} | json: ${usageStr(res2.usageMetadata)}`;
  const timing = {
    research_ms: t1 - t0,
    json_ms: t2 - t1,
    total_ms: t2 - t0,
  };
  return { result, researchText, meta: { model: MODEL, tokens, groundedQueries, timing } };
}

async function main() {
  const args = process.argv.slice(2);
  const fast = args.includes("--fast");
  const outFlag = args.indexOf("--out");
  const outDir = outFlag >= 0 ? args[outFlag + 1] : path.join(__dirname, "results");
  const target = args.find(
    (a, i) => a !== "--out" && a !== "--fast" && !(outFlag >= 0 && i === outFlag + 1)
  );
  if (!target) {
    console.error("Usage: node test-antique-research.js <image|folder> [--fast] [--out dir]");
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY not set. Copy .env.example to .env and add your key.");
    process.exit(1);
  }

  let files = [];
  if (fs.statSync(target).isDirectory()) {
    files = fs.readdirSync(target)
      .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
      .map((f) => path.join(target, f)).sort();
  } else {
    files = [target];
  }
  if (!files.length) { console.error("No image files found."); process.exit(1); }

  fs.mkdirSync(outDir, { recursive: true });
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const summary = [];

  for (const file of files) {
    const name = path.basename(file);
    process.stderr.write(`Researching ${name}${fast ? " (fast)" : ""}… `);
    try {
      const { result, researchText, meta } = fast
        ? await analyzeImageFast(ai, file)
        : await analyzeImage(ai, file);
      const base =
        path.basename(file, path.extname(file)) + (fast ? "-fast" : "");
      result.file = name;
      result.mode = fast ? "fast" : "full";
      result.analyzed_at = new Date().toISOString();
      result.model = meta.model;
      result.token_usage = meta.tokens;
      result.timing_ms = meta.timing;
      fs.writeFileSync(path.join(outDir, `${base}.json`), JSON.stringify(result, null, 2));
      const text = fast
        ? formatFastText(name, result, meta)
        : formatText(name, result, researchText, meta);
      fs.writeFileSync(path.join(outDir, `${base}.txt`), text);
      process.stderr.write("done\n");
      if (files.length === 1) console.log(text);
      summary.push({
        file: name,
        mode: fast ? "fast" : "full",
        item: fast ? result.item : result.proposed_inventory?.item || null,
        price: fast ? result.suggested_sale_price ?? null : result.proposed_inventory?.suggested_sale_price ?? null,
        confidence: fast ? result.confidence : result.identification?.confidence || null,
        total_ms: meta.timing.total_ms,
        searches: meta.groundedQueries.length,
        comparables: fast ? (result.comparables || []).length : (result.research?.comparables || []).length,
      });
    } catch (err) {
      process.stderr.write(`FAILED: ${err.message}\n`);
      summary.push({ file: name, error: err.message });
    }
  }

  if (files.length > 1) {
    fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  }
  console.log(`\nResults written to ${outDir}`);
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
