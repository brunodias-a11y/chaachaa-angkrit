// Cloudflare Pages Function — GET /api/image-search
//
// Server-side proxy for Google Custom Search image search.
// Keeps GOOGLE_CSE_KEY and GOOGLE_CSE_CX out of the client bundle.
//
// Environment variables (Cloudflare Pages → Settings → Environment variables):
//   GOOGLE_TTS_API_KEY  — same key already used by /api/tts (Cloud TTS + Custom Search enabled)
//   GOOGLE_CSE_CX       — Custom Search Engine ID (programmablesearchengine.google.com)
//
// Query params:
//   q    — search query string
//   n    — number of results (default 1, max 5)
//
// Response: { results: [{ url, thumbnail, title }] }  or  { error: "..." }

const CORS = {
  'access-control-allow-origin':  '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  const GOOGLE_CSE_KEY = env.GOOGLE_TTS_API_KEY; // same key — TTS + Custom Search enabled
  const GOOGLE_CSE_CX  = env.GOOGLE_CSE_CX;
  if (!GOOGLE_CSE_KEY || !GOOGLE_CSE_CX) {
    return new Response(JSON.stringify({ error: 'Image search not configured' }), {
      status: 503, headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim();
  if (!q) {
    return new Response(JSON.stringify({ error: 'Missing query param q' }), {
      status: 400, headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  const num = Math.min(parseInt(searchParams.get('n') || '1', 10), 5);

  const apiUrl = new URL('https://www.googleapis.com/customsearch/v1');
  apiUrl.searchParams.set('key',        GOOGLE_CSE_KEY);
  apiUrl.searchParams.set('cx',         GOOGLE_CSE_CX);
  apiUrl.searchParams.set('q',          q);
  apiUrl.searchParams.set('searchType', 'image');
  apiUrl.searchParams.set('num',        String(num));
  apiUrl.searchParams.set('safe',       'active');
  apiUrl.searchParams.set('imgSize',    'medium');
  apiUrl.searchParams.set('imgType',    'photo');

  try {
    const res = await fetch(apiUrl.toString(), {
      headers: { 'Accept': 'application/json' },
      cf: { cacheTtl: 86400, cacheEverything: true }, // cache at Cloudflare edge for 24h
    });

    if (!res.ok) {
      const body = await res.text();
      return new Response(JSON.stringify({ error: `Google CSE error ${res.status}`, detail: body }), {
        status: res.status, headers: { ...CORS, 'content-type': 'application/json' },
      });
    }

    const data = await res.json();
    const results = (data.items || []).map(item => ({
      url:       item.link,
      thumbnail: item.image?.thumbnailLink || item.link,
      title:     item.title,
    }));

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: {
        ...CORS,
        'content-type': 'application/json',
        'cache-control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS, 'content-type': 'application/json' },
    });
  }
}
