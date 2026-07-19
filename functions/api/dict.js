// Cloudflare Pages Function — GET /api/dict?word=<english text>
//
// Dictionary lookup for English words. Uses the Free Dictionary API
// (https://api.dictionaryapi.dev/) which has CORS headers, so we could
// call it directly from the browser — but we keep this server-side proxy
// for consistency with the original chaachaathai architecture and to
// allow future provider swaps without client changes.
//
// Used by the AI enrichment step (enrichWords in App.jsx) as a ground-truth
// reference: before asking the AI to classify/split a word, we hand it the
// dictionary's own list of senses for verification.

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const word = url.searchParams.get("word");
  if (!word) return new Response(JSON.stringify({ error: "Missing word param" }), { status: 400 });

  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!res.ok) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    const data = await res.json();

    // Normalize to { pos, gloss } pairs (same shape as the old thai-dict proxy)
    const senses = [];
    for (const entry of data) {
      for (const meaning of entry.meanings || []) {
        for (const def of meaning.definitions || []) {
          senses.push({ pos: meaning.partOfSpeech, gloss: def.definition });
        }
      }
    }
    return new Response(JSON.stringify({ senses }), {
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
    },
  });
}
