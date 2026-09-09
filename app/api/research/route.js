import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

// Single-call "fast research" mode. IMPORTANT: do not set responseMimeType/
// responseSchema here — forcing JSON output suppresses the googleSearch tool
// and the model answers (and fabricates prices/URLs) from memory. Instead the
// prompt asks the model to research first and end with a fenced JSON block,
// which we extract below.
const PROMPT = `You are an antique-booth pricing assistant. Examine this photo of a resale item.

STEP 1 — Look at the image. Identify the item and read ALL visible text/markings: maker's marks, logos, labels, stamps, signatures on hardware, bases, tags.

STEP 2 — Search Google before answering. You are REQUIRED to use Google Search — never price or identify from memory alone. Keep it fast: 1-3 targeted queries maximum. First verify/refine the identification using any markings found, then look up comparable resale prices (eBay, Etsy, Mercari, Poshmark, auction sites). Prefer sold/completed prices visible in snippets; never treat asking prices as sold. Stop as soon as you have enough for a reasonable booth price.

STEP 3 — Write 1-2 sentences summarizing what you found, then end your reply with a final JSON code block (triple-backtick json fence) matching this schema:
{
  "item": "short shelf-tag name (brand/maker + item type + key descriptor)",
  "description": "1-3 sentences for an inventory record",
  "category": "one of: Art, Bag, Clothing, Decor, Jewelry, Keychains, Random, Shoes",
  "sale_price": number|null,
  "sale_price_low": number|null,
  "sale_price_high": number|null,
  "confidence": "high|medium|low",
  "comparables": [{"title": "", "url": "copy the real URL from the search result", "source": "hostname", "price": 0, "price_type": "asking|sold|retail|reference|unknown"}],
  "visible_markings": ["exact text read from the image"],
  "warnings": ["string"]
}
Only include comparables that actually appeared in your search results — copy their URLs verbatim. If evidence is too thin for a defensible price, set prices to null and say so in warnings. Never invent listings, URLs, or prices.`;

function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/g);
  const candidate = fence
    ? fence[fence.length - 1].replace(/```(?:json)?\s*|```/g, "")
    : text.slice(text.indexOf("{"));
  return JSON.parse(candidate.trim());
}

export async function POST(request) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return Response.json(
        { error: "Research feature is not configured (missing GEMINI_API_KEY)." },
        { status: 500 }
      );
    }

    const form = await request.formData();
    const photo = form.get("photo");
    if (!photo || typeof photo !== "object" || photo.size === 0) {
      return Response.json({ error: "A photo is required." }, { status: 400 });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: Buffer.from(await photo.arrayBuffer()).toString("base64"),
                mimeType: photo.type || "image/jpeg",
              },
            },
            { text: PROMPT },
          ],
        },
      ],
      config: { tools: [{ googleSearch: {} }] },
    });

    const text = res.text || "";
    let result;
    try {
      result = extractJson(text);
    } catch {
      console.error("Research JSON parse failed:", text.slice(0, 500));
      return Response.json(
        { error: "Could not interpret the research result. Try again." },
        { status: 502 }
      );
    }

    const gm = res.candidates?.[0]?.groundingMetadata || {};
    result._meta = {
      searches: (gm.webSearchQueries || []).length,
      queries: gm.webSearchQueries || [],
      tokens: res.usageMetadata?.totalTokenCount ?? null,
    };

    return Response.json(result);
  } catch (err) {
    console.error("Research failed:", err);
    return Response.json(
      { error: err?.message || "Research failed." },
      { status: 500 }
    );
  }
}
