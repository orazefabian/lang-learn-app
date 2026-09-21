import { createHash } from "node:crypto";
import http from "node:http";

/**
 * Stand-ins for Piper and faster-whisper, for the UX harness only.
 *
 * Without PIPER_URL and WHISPER_URL the app degrades on purpose: listening
 * exercises disappear and speaking falls back to self-assessment. That is the
 * right behaviour in production and the wrong thing to audit — speaking is the
 * first skill the brief names, so a harness that never sees a speaking card is
 * auditing the wrong app. These two servers exist so the exercises are present
 * and the whole record → transcribe → score → band path runs end to end.
 *
 *   node scripts/ux/stub-speech.mjs
 *
 * This is not an encoder and not a recogniser. It fakes both well enough that
 * the screens are real, and nothing else:
 *
 * - Piper returns a WAV tone whatever format was asked for. Chromium sniffs the
 *   container rather than trusting the extension, so a .opus file holding WAV
 *   bytes plays with a correct duration. Verified, not assumed — a hand-built
 *   Ogg/Opus loaded with a duration of Infinity, which would put a wrong number
 *   in the player UI and read as a bug that isn't one.
 * - Whisper cannot recognise a tone, and the audio it receives says nothing
 *   about what the learner was asked to say. So the transcript it returns is
 *   whatever the capture script last told it to return, via POST /__control.
 *   That is what makes "good", "close" and "off" reachable on demand instead of
 *   by luck, which is the only way to screenshot all three scoring states.
 */

const PIPER_PORT = Number(process.env.UX_PIPER_PORT ?? 5001);
const WHISPER_PORT = Number(process.env.UX_WHISPER_PORT ?? 5002);
const HOST = process.env.UX_STUB_HOST ?? "127.0.0.1";

/** What the extension on disk should be, per the format the app asked for. */
const CONTENT_TYPES = { opus: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav" };

/**
 * A 16-bit mono WAV tone. The pitch comes from a hash of the text so two
 * different phrases are audibly different clips — which is how you notice the
 * player is serving a stale or wrong file rather than merely serving something.
 */
function wavTone(text, seconds = 0.9, rate = 22050) {
  const digest = createHash("sha256").update(text).digest();
  const freq = 220 + (digest.readUInt16BE(0) % 440);

  const samples = Math.floor(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    // A short fade at both ends: a square-edged tone clicks, and a click is the
    // kind of thing that gets filed as an audio bug.
    const fade = Math.min(1, Math.min(i, samples - i) / (rate * 0.05));
    const value = Math.sin((2 * Math.PI * freq * i) / rate) * 11000 * fade;
    data.writeInt16LE(Math.round(value), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": body.length });
  res.end(body);
}

/* ------------------------------------------------------------------ Piper */

const piper = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { status: "ok", service: "piper-stub" });
  }

  if (req.method === "POST" && url.pathname === "/synthesize") {
    let request;
    try {
      request = JSON.parse((await readBody(req)).toString("utf8"));
    } catch {
      return json(res, 400, { error: "invalid json" });
    }

    const text = String(request.text ?? "");
    if (!text) return json(res, 400, { error: "no text" });

    const format = CONTENT_TYPES[request.format] ? request.format : "wav";
    const audio = wavTone(text);
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[format], "Content-Length": audio.length });
    return res.end(audio);
  }

  return json(res, 404, { error: "not found" });
});

/* ---------------------------------------------------------------- Whisper */

/**
 * What the next transcription will claim to have heard. The capture script
 * reads the phrase off the screen and sets this before it records, so the
 * scoring band is chosen rather than stumbled into.
 */
let nextTranscript = "";

/**
 * Mangle a transcript so it lands in a chosen band.
 *
 * "close" is the fiddly one. The scorer calls something good only when the
 * characters agree to 0.85 *and* the words agree to 0.8, so a single wrong
 * ending drops a three-word phrase out of "good" but not a six-word one — one
 * wrong word in six is still 0.83. Scaling the damage with the length is what
 * makes the band a choice rather than a coin toss.
 */
function degrade(text, mode) {
  if (mode === "off") return "ne razumem tega";
  if (mode === "empty") return "";
  if (mode !== "close") return text;

  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return text;

  const wrong = Math.max(1, Math.ceil(words.length * 0.25));
  for (let i = 0; i < wrong; i++) {
    const at = words.length - 1 - i;
    // Swap the last *letter*, stepping over trailing punctuation — a phrase
    // ending in "." would otherwise have its full stop mangled and nothing else.
    words[at] = words[at].replace(/(\p{L})(\P{L}*)$/u, (_, letter, tail) =>
      `${letter.toLowerCase() === "o" ? "e" : "o"}${tail}`,
    );
  }
  return words.join(" ");
}

const whisper = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { status: "ok", service: "whisper-stub" });
  }

  // The seam that makes the three scoring states reachable. Not part of the
  // real Whisper API, and deliberately named so it cannot be mistaken for it.
  if (req.method === "POST" && url.pathname === "/__control") {
    let control;
    try {
      control = JSON.parse((await readBody(req)).toString("utf8"));
    } catch {
      return json(res, 400, { error: "invalid json" });
    }
    nextTranscript = degrade(String(control.target ?? ""), control.mode ?? "good");
    return json(res, 200, { nextTranscript });
  }

  if (req.method === "POST" && url.pathname === "/transcribe") {
    const audio = await readBody(req);
    const seconds = Math.max(0.4, audio.length / 32_000);

    return json(res, 200, {
      text: nextTranscript,
      language: "sl",
      duration: seconds,
      model: "stub",
      segments: nextTranscript
        ? [
            {
              start: 0,
              end: seconds,
              text: nextTranscript,
              // Plausible confidence values: the UI shows what the recogniser
              // understood, and numbers that read as broken would be noise.
              avg_logprob: -0.25,
              no_speech_prob: 0.01,
            },
          ]
        : [],
    });
  }

  return json(res, 404, { error: "not found" });
});

await new Promise((resolve) => piper.listen(PIPER_PORT, HOST, resolve));
await new Promise((resolve) => whisper.listen(WHISPER_PORT, HOST, resolve));

console.log(`piper stub   http://${HOST}:${PIPER_PORT}`);
console.log(`whisper stub http://${HOST}:${WHISPER_PORT}`);

const shutdown = () => {
  piper.close();
  whisper.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
