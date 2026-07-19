// Cloudflare Pages Function — GET /api/thai-dict?word=<thai text>
//
// Server-side proxy + parser for thai-language.com dictionary search.
// We run this on the server (not straight from the browser) because
// thai-language.com doesn't send CORS headers, so a direct client-side
// fetch would be blocked.
//
// Used by the PowerPoint import's AI enrichment step (src/App.jsx,
// enrichWords()) as a ground-truth reference: before asking the AI to
// translate/classify/split a word, we hand it the dictionary's own list of
// senses so it can verify the slide's gloss, catch mistranslations, and
// decide whether a word has multiple unrelated meanings that should become
// separate flashcards (e.g. ตา = "eye" AND, unrelated, "maternal grandfather").
//
// thai-language.com returns grouped results: each headword has a rowspan
// indicating how many senses (POS + gloss) it has. We parse the HTML table,
// extract the primary headword entries (common words), and return them as
// { pos, gloss } pairs — same shape as the previous Lexitron proxy, so
// enrichWords() and its helpers (mapLongdoPos, pickDistinctDictSenses)
// work unchanged.
//
// Fails soft: any error (network, no entries found, parsing miss) returns an
// empty `entries` array with HTTP 200 rather than an error status, since the
// caller treats "no dictionary reference available" as a normal case — the
// AI still works from the slide's own text if this comes back empty.

const LOOKUP_TIMEOUT_MS = 8000;
const MAX_ENTRIES = 8;

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const word = (url.searchParams.get("word") || "").trim();

  const corsHeaders = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    // Dictionary entries for a given word never change — cache at edge for a day.
    "cache-control": "public, max-age=86400",
  };

  if (!word) {
    return new Response(JSON.stringify({ term: "", entries: [], error: "missing_word" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  try {
    const entries = await lookupThaiLanguageCom(word);
    return new Response(JSON.stringify({ term: word, entries }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ term: word, entries: [], error: String(err?.message || err) }), {
      headers: corsHeaders,
    });
  }
}

// ── POS mapping ──────────────────────────────────────────────────────────
// thai-language.com uses fuller POS labels than Lexitron's abbreviations.
// Map them to the same short keys that mapLongdoPos() in App.jsx expects.
const POS_MAP = {
  'noun': 'n',
  'verb': 'v',
  'verb, transitive': 'v',
  'verb, intransitive': 'v',
  'adjective': 'adj',
  'adverb': 'adv',
  'pronoun': 'pron',
  'preposition': 'prep',
  'conjunction': 'conj',
  'interjection': 'intj',
  'particle': 'part',
  'classifier': 'clf',
  'numeral': 'num',
  'phrase': 'phrase',
  'expression': 'phrase',
  'auxiliary verb': 'aux',
};

function mapPos(rawPos) {
  const key = rawPos.trim().toLowerCase();
  // Try exact match first, then try prefix match (e.g. "verb, transitive")
  if (POS_MAP[key]) return POS_MAP[key];
  for (const [k, v] of Object.entries(POS_MAP)) {
    if (key.startsWith(k)) return v;
  }
  return key.split(/[,;]\s*/)[0] || 'n';
}

async function lookupThaiLanguageCom(word) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

  let html;
  try {
    // thai-language.com uses POST for dictionary search.
    // emode=1 (exact), tmode=2 (Thai search)
    const body = new URLSearchParams();
    body.set('search', word);
    body.set('emode', '1');
    body.set('tmode', '2');

    const upstream = await fetch('http://thai-language.com/dict', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ChaChaThaiDictLookup/2.0)',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: controller.signal,
      // Follow redirects — the site may redirect http to https or vice versa
      redirect: 'follow',
    });
    if (!upstream.ok) return [];
    html = await upstream.text();
  } finally {
    clearTimeout(timeout);
  }

  // Parse the results table. thai-language.com returns multiple <table> elements;
  // the one with the dictionary results is the one containing "common words:"
  // or "Search yielded ... results".
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let resultsTable = null;
  let match;
  while ((match = tableRegex.exec(html)) !== null) {
    const tableHtml = match[1];
    if (/common words:|Search yielded.*results/i.test(tableHtml)) {
      resultsTable = tableHtml;
      break;
    }
  }
  if (!resultsTable) return [];

  // Parse rows. The structure is:
  //   <tr><td rowspan=N>1.</td><td class=th rowspan=N><a ...>ตา</a></td><td rowspan=N>romanization</td><td>POS</td><td>gloss</td></tr>
  //   <tr><td>POS</td><td>gloss</td></tr>  (subsequent senses, no numbering/thai/romanization)
  //   <tr><td rowspan=N>2.</td>...  (next headword)
  //
  // We only care about the FIRST headword that matches our search term exactly
  // (thai-language.com returns words that "begin with" the search term).
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [];
  let rowMatch;
  while ((rowMatch = rowRegex.exec(resultsTable)) !== null) {
    rows.push(rowMatch[1]);
  }

  // Find the first numbered entry (has rowspan) that matches our word
  const seen = new Set();
  const entries = [];
  let foundFirstWord = false;

  for (const row of rows) {
    // Check if this row starts a new headword (has td with number + rowspan)
    const hasNumber = /<td[^>]*rowspan=\d+[^>]*>\s*\d+\./.test(row);

    if (hasNumber) {
      // Extract the Thai word from this row
      const thaiMatch = row.match(/<td[^>]*class=th[^>]*>(.*?)<\/td>/i);
      if (thaiMatch) {
        const thaiWord = thaiMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
        // Only take the first headword (exact match or closest)
        if (!foundFirstWord) {
          foundFirstWord = true;
        } else {
          // We've already found our word — stop at the next headword
          break;
        }
      }
    }

    if (!foundFirstWord) continue;

    // Extract POS and gloss from this row
    // The last two <td> cells are POS and gloss
    const cells = row.match(/<td[^>]*>(.*?)<\/td>/gi) || [];
    // For the first row of a headword, cells are: [number, thai, romanization, pos, gloss]
    // For subsequent rows: [pos, gloss]
    const lastTwo = cells.slice(-2).map(c => c.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());

    if (lastTwo.length === 2) {
      const rawPos = lastTwo[0];
      const rawGloss = lastTwo[1];
      if (rawPos && rawGloss) {
        const pos = mapPos(rawPos);
        // Clean up gloss — remove extra whitespace
        const gloss = rawGloss.replace(/\s+/g, ' ').trim();
        const key = `${pos}:${gloss.toLowerCase()}`;
        if (!seen.has(key) && gloss.length > 0) {
          seen.add(key);
          entries.push({ pos, gloss });
          if (entries.length >= MAX_ENTRIES) break;
        }
      }
    }
  }

  return entries;
}
