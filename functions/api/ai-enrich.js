// Cloudflare Pages Function — POST /api/ai-enrich
//
// Server-side AI proxy that holds provider API keys as server-side environment
// variables (NOT exposed to the client bundle). This lets the app work
// out-of-the-box without each teacher manually entering keys in Settings.
//
// Environment variables (set in Cloudflare Pages → Settings → Environment variables):
//   GEMINI_API_KEY       — Google AI Studio key (primary)
//   GROQ_API_KEY         — Groq console key (1st fallback)
//   CLOUDFLARE_ACCOUNT_ID — Cloudflare account ID (2nd fallback)
//   CLOUDFLARE_API_TOKEN  — Cloudflare API token (2nd fallback)
//
// Request body: { systemPrompt, userMessage }
// Response:     { text, provider }  or  { error: "..." }
//
// The fallback chain matches the client-side callAIWithFallback():
// Gemini 2.5 Flash → Groq Llama 3.3 70B → Cloudflare Workers AI.

const GEMINI_MODEL = 'gemini-2.5-flash';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';
const CF_MODEL     = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const corsHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { systemPrompt, userMessage, maxTokens } = body;
  if (!systemPrompt || !userMessage) {
    return new Response(JSON.stringify({ error: 'Missing systemPrompt or userMessage' }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  // Issue #104 — accept dynamic maxOutputTokens from the client (calculated
  // proportionally to word count in enrichWords). Fall back to 2000 for
  // backward compatibility with older clients or other callers.
  const outTokens = Math.min(8192, Math.max(2000, maxTokens || 2000));

  const errors = [];

  // ── Provider 1: Google Gemini ──────────────────────────────────────────
  if (env.GEMINI_API_KEY) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: outTokens },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Gemini ${res.status}: ${err?.error?.message || res.statusText}`);
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text) {
        return new Response(JSON.stringify({ text, provider: 'Gemini' }), { headers: corsHeaders });
      }
      throw new Error('Gemini returned empty response');
    } catch (e) {
      errors.push(`Gemini: ${e.message}`);
    }
  }

  // ── Provider 2: Groq (OpenAI-compatible) ───────────────────────────────
  if (env.GROQ_API_KEY) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0.1,
          max_tokens: outTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Groq ${res.status}: ${err?.error?.message || res.statusText}`);
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      if (text) {
        return new Response(JSON.stringify({ text, provider: 'Groq' }), { headers: corsHeaders });
      }
      throw new Error('Groq returned empty response');
    } catch (e) {
      errors.push(`Groq: ${e.message}`);
    }
  }

  // ── Provider 3: Cloudflare Workers AI (OpenAI-compatible) ──────────────
  if (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID) {
    try {
      const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        },
        body: JSON.stringify({
          model: CF_MODEL,
          temperature: 0.1,
          max_tokens: outTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err?.error?.message || err?.errors?.[0]?.message || res.statusText;
        throw new Error(`Cloudflare ${res.status}: ${msg}`);
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      if (text) {
        return new Response(JSON.stringify({ text, provider: 'Cloudflare' }), { headers: corsHeaders });
      }
      throw new Error('Cloudflare returned empty response');
    } catch (e) {
      errors.push(`Cloudflare: ${e.message}`);
    }
  }

  // ── All providers failed or none configured ────────────────────────────
  const noKeys = !env.GEMINI_API_KEY && !env.GROQ_API_KEY && !(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID);
  if (noKeys) {
    return new Response(JSON.stringify({
      error: 'NO_SERVER_KEYS',
      message: 'No AI provider keys configured on the server. Set GEMINI_API_KEY, GROQ_API_KEY, or CLOUDFLARE_* in Cloudflare Pages environment variables, or add a personal key in Settings.',
    }), { status: 503, headers: corsHeaders });
  }

  return new Response(JSON.stringify({
    error: 'ALL_PROVIDERS_FAILED',
    message: `All AI providers failed — ${errors.join(' | ')}`,
  }), { status: 502, headers: corsHeaders });
}
