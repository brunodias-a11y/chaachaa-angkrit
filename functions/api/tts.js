// Cloudflare Pages Function — POST /api/tts
//
// Server-side Text-to-Speech proxy.
//
// Primary provider: Gemini 2.5 Flash TTS. Reuses the SAME `GEMINI_API_KEY`
// already configured for /api/ai-enrich — no separate Google Cloud Console
// project, no separate billing setup. Cost is per audio output token
// (~$10 / 1M tokens, roughly 334 THB/1M at current rates) — negligible for
// short study-card words/phrases.
//
// Optional secondary provider: classic Google Cloud Text-to-Speech (Neural2),
// used only if GOOGLE_TTS_API_KEY is also set (kept for backward
// compatibility / in case that's ever configured).
//
// Last resort: the client falls back to the browser's SpeechSynthesis API.
//
// Environment variables (Cloudflare Pages → Settings → Environment variables):
//   GEMINI_API_KEY     — Google AI Studio key (already set for AI enrich) — PRIMARY
//   GOOGLE_TTS_API_KEY — optional, classic Cloud TTS Neural2 — secondary fallback
//
// Request body:  { text: "สวัสดี" }
// Response:      { audio: "data:audio/wav;base64,...", provider: "gemini" }  or  { error: "..." }

const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const GEMINI_TTS_VOICE = 'Kore'; // warm, neutral prebuilt voice; handles English text well
const CLOUD_TTS_VOICE = 'en-US-Neural2-C';
const CLOUD_TTS_LANGUAGE_CODE = 'en-US';

const corsHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// Gemini TTS returns raw 16-bit PCM (no container) — wrap it in a minimal WAV
// header so the browser's <audio>/Audio() can actually play it.
function pcmToWavBase64(pcmBase64, sampleRate = 24000) {
  const pcmBytes = Uint8Array.from(atob(pcmBase64), c => c.charCodeAt(0));
  const dataSize = pcmBytes.length;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);              // PCM chunk size
  view.setUint16(20, 1, true);               // audio format = PCM
  view.setUint16(22, 1, true);               // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);  // byte rate (16-bit mono)
  view.setUint16(32, 2, true);               // block align
  view.setUint16(34, 16, true);              // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const wavBytes = new Uint8Array(44 + dataSize);
  wavBytes.set(new Uint8Array(header), 0);
  wavBytes.set(pcmBytes, 44);

  // base64-encode in chunks to avoid call-stack overflow on longer buffers
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < wavBytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, wavBytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function tryGeminiTts(text, apiKey) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_TTS_VOICE } },
          },
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini TTS ${res.status}: ${err?.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const part = data?.candidates?.[0]?.content?.parts?.[0];
  const inline = part?.inlineData;
  if (!inline?.data) throw new Error('Gemini TTS returned no audio');

  // mimeType looks like "audio/L16;codec=pcm;rate=24000" — pull out the rate
  const rateMatch = /rate=(\d+)/.exec(inline.mimeType || '');
  const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;

  return `data:audio/wav;base64,${pcmToWavBase64(inline.data, sampleRate)}`;
}

async function tryCloudTts(text, apiKey) {
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: CLOUD_TTS_LANGUAGE_CODE, name: CLOUD_TTS_VOICE },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 0.9, pitch: 0 },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Cloud TTS ${res.status}: ${err?.error?.message || res.statusText}`);
  }

  const data = await res.json();
  if (!data?.audioContent) throw new Error('Cloud TTS returned empty audio');
  return `data:audio/mp3;base64,${data.audioContent}`;
}

export async function onRequestPost({ request, env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: corsHeaders,
    });
  }

  const { text } = body;
  if (!text || typeof text !== 'string' || text.length > 500) {
    return new Response(JSON.stringify({ error: 'Text required (max 500 chars)' }), {
      status: 400, headers: corsHeaders,
    });
  }

  const errors = [];

  // Primary: Gemini 2.5 Flash TTS — reuses GEMINI_API_KEY, already configured
  // for /api/ai-enrich, so this works out of the box with no extra setup.
  if (env.GEMINI_API_KEY) {
    try {
      const audio = await tryGeminiTts(text, env.GEMINI_API_KEY);
      return new Response(JSON.stringify({ audio, provider: 'gemini' }), { headers: corsHeaders });
    } catch (e) {
      errors.push(e.message);
    }
  }

  // Secondary (optional): classic Google Cloud TTS Neural2, only if that
  // separate key was ever configured.
  if (env.GOOGLE_TTS_API_KEY) {
    try {
      const audio = await tryCloudTts(text, env.GOOGLE_TTS_API_KEY);
      return new Response(JSON.stringify({ audio, provider: 'cloud-tts' }), { headers: corsHeaders });
    } catch (e) {
      errors.push(e.message);
    }
  }

  // No provider configured or both failed — client falls back to browser TTS.
  return new Response(JSON.stringify({
    error: errors.length ? 'TTS_FAILED' : 'NO_TTS_KEY',
    message: errors.length
      ? errors.join(' | ')
      : 'No TTS provider configured. GEMINI_API_KEY (recommended — same key used for AI enrich) or GOOGLE_TTS_API_KEY must be set in Cloudflare Pages environment variables.',
  }), { status: errors.length ? 502 : 503, headers: corsHeaders });
}
