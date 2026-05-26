/* ===================== CONFIG ===================== */
const PEXELS_API_KEY = 'BcrRpSfBQm9zoXKhCcfJleP8eFAKkeuLyk82Mp0D8cpPQ3zbFlgVZqJK';
const PEXELS_BASE = 'https://api.pexels.com/v1';
// Gemini Generative Language API. Called directly from the browser because
// the API supports CORS for arbitrary origins. The public build ships with
// empty placeholder values - users must paste their own Gemini API key via
// the in-UI settings panel (the AI button in the header). The key is then
// saved to localStorage and persists per browser. Get a free key at
// https://aistudio.google.com/apikey
const GEMINI_BUILTIN_KEYS = [
    { id: '__builtin_1', name: 'Встроенный #1 (введите свой)', value: '', builtin: true },
    { id: '__builtin_2', name: 'Встроенный #2 (введите свой)', value: '', builtin: true },
    { id: '__builtin_3', name: 'Встроенный #3 (введите свой)', value: '', builtin: true },
];
const GEMINI_API_KEY_DEFAULT = GEMINI_BUILTIN_KEYS[0].value; // backward compat
function findBuiltinKey(id) {
    return GEMINI_BUILTIN_KEYS.find(k => k.id === id) || null;
}
const GEMINI_MODEL = 'gemini-2.5-flash';

/* ===================== KEY VAULT =====================
 * User can store many Gemini API keys and switch between them.
 * Vault shape: { keys: [{ id, name, value, addedAt }], activeId: string|null }
 * activeId === null  →  use the built-in default key.
 * Stored in localStorage so it persists per browser. */
const GEMINI_VAULT_LS = 'carousel-maker:gemini-vault';
const GEMINI_LEGACY_KEY_LS = 'carousel-maker:gemini-api-key'; // single-key storage from earlier version

function loadKeyVault() {
    try {
        const raw = localStorage.getItem(GEMINI_VAULT_LS);
        if (raw) {
            const v = JSON.parse(raw);
            if (v && Array.isArray(v.keys)) return v;
        }
    } catch (_) {}
    // Migrate from legacy single-key storage if present.
    try {
        const legacy = localStorage.getItem(GEMINI_LEGACY_KEY_LS);
        if (legacy) {
            const id = 'k' + Date.now();
            const vault = {
                keys: [{ id, name: 'Мой ключ', value: legacy, addedAt: Date.now() }],
                activeId: id,
            };
            saveKeyVault(vault);
            localStorage.removeItem(GEMINI_LEGACY_KEY_LS);
            return vault;
        }
    } catch (_) {}
    return { keys: [], activeId: null };
}
function saveKeyVault(v) {
    try { localStorage.setItem(GEMINI_VAULT_LS, JSON.stringify(v)); } catch (_) {}
}
function getGeminiKey() {
    const v = loadKeyVault();
    if (v.activeId) {
        const builtin = findBuiltinKey(v.activeId);
        if (builtin && builtin.value) return builtin.value;
        const k = v.keys.find(x => x.id === v.activeId);
        if (k && k.value) return k.value;
    }
    // Fallback: any user-added key, then any non-empty built-in.
    if (v.keys.length && v.keys[0].value) return v.keys[0].value;
    const fallbackBuiltin = GEMINI_BUILTIN_KEYS.find(k => k.value);
    if (fallbackBuiltin) return fallbackBuiltin.value;
    return '';
}
function addKeyToVault(name, value) {
    const v = loadKeyVault();
    const id = 'k' + Date.now() + Math.random().toString(36).slice(2, 6);
    v.keys.push({ id, name: name || 'Без названия', value: value.trim(), addedAt: Date.now() });
    v.activeId = id;
    saveKeyVault(v);
    return id;
}
function removeKeyFromVault(id) {
    const v = loadKeyVault();
    v.keys = v.keys.filter(k => k.id !== id);
    if (v.activeId === id) v.activeId = null;
    saveKeyVault(v);
}
function setActiveKey(id) {
    const v = loadKeyVault();
    if (id !== null && !findBuiltinKey(id) && !v.keys.find(k => k.id === id)) return;
    v.activeId = id;
    saveKeyVault(v);
}
function renameKey(id, newName) {
    const v = loadKeyVault();
    const k = v.keys.find(x => x.id === id);
    if (k) { k.name = newName || k.name; saveKeyVault(v); }
}
function geminiUrl() {
    return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${getGeminiKey()}`;
}
/* Per-key daily quota tracking. Each key (and the built-in default) keeps its
 * own counter, so switching keys correctly shows that key's remaining quota.
 * Storage shape: { [keyId|'default']: { date, used, exhausted } }
 * Resets at UTC midnight to match Google's reset window (~03:00 MSK). */
const GEMINI_QUOTA_LS = 'carousel-maker:gemini-quota-v2';
const GEMINI_FREE_TIER_LIMIT = 50;

function todayUtcKey() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}
function activeQuotaSlot() {
    const v = loadKeyVault();
    // null activeId === first built-in, so map both to the same slot.
    if (!v.activeId) return GEMINI_BUILTIN_KEYS[0].id;
    return v.activeId;
}
function loadAllQuotas() {
    try {
        const raw = localStorage.getItem(GEMINI_QUOTA_LS);
        if (raw) return JSON.parse(raw) || {};
    } catch (_) {}
    return {};
}
function saveAllQuotas(all) {
    try { localStorage.setItem(GEMINI_QUOTA_LS, JSON.stringify(all)); } catch (_) {}
}
function getQuotaState(slot) {
    const all = loadAllQuotas();
    const k = slot || activeQuotaSlot();
    const s = all[k];
    if (!s || s.date !== todayUtcKey()) {
        return { date: todayUtcKey(), used: 0, exhausted: false };
    }
    return s;
}
function setQuotaState(s, slot) {
    const all = loadAllQuotas();
    const k = slot || activeQuotaSlot();
    all[k] = s;
    saveAllQuotas(all);
}
function incrementQuota() {
    const s = getQuotaState();
    s.used += 1;
    setQuotaState(s);
    updateQuotaUi();
}
function markQuotaExhausted() {
    const s = getQuotaState();
    s.exhausted = true;
    setQuotaState(s);
    updateQuotaUi();
}
function activeKeyDisplayName() {
    const v = loadKeyVault();
    if (v.activeId) {
        const builtin = findBuiltinKey(v.activeId);
        if (builtin && builtin.value) return builtin.name;
        const k = v.keys.find(x => x.id === v.activeId);
        if (k) return k.name;
    }
    // No active key resolved. If there are user keys, name the first;
    // otherwise tell the user to add one.
    if (v.keys.length) return v.keys[0].name;
    const usableBuiltin = GEMINI_BUILTIN_KEYS.find(k => k.value);
    if (usableBuiltin) return usableBuiltin.name;
    return 'Не выбран — добавьте свой';
}
function updateQuotaUi() {
    const s = getQuotaState();
    const badge = document.getElementById('api-quota-badge');
    const used = document.getElementById('api-quota-used');
    const fill = document.getElementById('api-quota-bar-fill');
    const curKey = document.getElementById('api-current-key');
    const ratio = Math.min(s.used / GEMINI_FREE_TIER_LIMIT, 1);
    const pct = Math.round(ratio * 100);
    if (badge) {
        badge.textContent = s.exhausted ? '0' : String(Math.max(0, GEMINI_FREE_TIER_LIMIT - s.used));
        badge.classList.toggle('warn', s.used >= GEMINI_FREE_TIER_LIMIT * 0.7 && !s.exhausted);
        badge.classList.toggle('danger', s.exhausted || s.used >= GEMINI_FREE_TIER_LIMIT);
        badge.title = s.exhausted
            ? 'Квота этого ключа исчерпана. Переключитесь на другой ключ или подождите до завтра.'
            : `Осталось ~${Math.max(0, GEMINI_FREE_TIER_LIMIT - s.used)} AI-запросов на этом ключе до сброса в полночь UTC`;
    }
    if (used) used.textContent = `${s.used}${s.exhausted ? ' (исчерпан)' : ''}`;
    if (fill) {
        fill.style.width = (s.exhausted ? 100 : pct) + '%';
        fill.classList.toggle('warn', pct >= 70 && !s.exhausted);
        fill.classList.toggle('danger', s.exhausted || pct >= 100);
    }
    if (curKey) curKey.textContent = activeKeyDisplayName();
}
// Legacy backend variable kept so old call sites compile; no longer used.
let API_BASE = '';

/* ===================== AI HELPERS ===================== */
function stripJsonFences(text) {
    let t = (text || '').trim();
    if (t.startsWith('```')) {
        t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```\s*$/, '');
    }
    return t.trim();
}

async function fileToJpegBase64(file, maxEdge = 1280) {
    // Re-encode the upload as a downscaled JPEG so the model sees a
    // predictable format and so we keep prompt tokens manageable. Returns
    // the raw base64 (no data URL prefix) because that's what Gemini wants.
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
}

async function callGeminiJson(systemPrompt, userParts) {
    // userParts is an array of Gemini "parts" — {text: ...} and/or
    // {inlineData: {mimeType, data}}. systemPrompt is sent as
    // systemInstruction so the model receives it as a separate channel.
    const body = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: userParts }],
        generationConfig: {
            temperature: 0.3,
            responseMimeType: 'application/json',
        },
    };
    incrementQuota();
    const resp = await fetch(geminiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        if (resp.status === 429) markQuotaExhausted();
        throw new Error(`Gemini HTTP ${resp.status}: ${errText.slice(0, 200)}`);
    }
    const data = await resp.json();
    const text = stripJsonFences(
        data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || ''
    );
    try {
        return JSON.parse(text);
    } catch (_) {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) return JSON.parse(m[0]);
        throw new Error('AI returned non-JSON');
    }
}

const ANALYZE_PROMPT = `You are a vision-based design analyst. The user has uploaded a screenshot of a single carousel/post slide template (Instagram / Pinterest / Canva style). Output a STRICT JSON object describing the visual style so a static HTML/CSS renderer can faithfully reproduce it.

ALL geometric values (left, top, width, height) MUST be in PERCENT of slide dimensions (slide reference: 1080 x 1350, 4:5). Use the form "12.34%" (no "px"). The frontend scales these percentages to the actual canvas size, so coordinates MUST scale, never sit at fixed pixels.

Return ONLY valid JSON with this exact shape (omit a field only if it does not apply; do NOT add extra keys):

{
  "background": { "type": "solid"|"gradient"|"image", "value": "#RRGGBB"|"linear-gradient(...)"|"search-keywords" },
  "layout": { "textAlign": "left"|"center"|"right", "verticalAlign": "top"|"center"|"bottom", "padding": "Npx Npx" },
  "titleStyle": { "fontFamily": "Inter"|"Montserrat"|"Playfair Display"|"Roboto Slab"|"Nunito"|"Raleway"|"Cormorant Garamond"|"Comfortaa", "fontWeight": "400"-"900", "fontSize": <int px on a 1080-wide canvas>, "color": "#RRGGBB", "textTransform": "none"|"uppercase"|"lowercase"|"capitalize", "letterSpacing": "Npx" },
  "bodyStyle": { "fontFamily": <same options>, "fontWeight": "300"-"700", "fontSize": <int px>, "color": "#RRGGBB", "lineHeight": "1.4"-"1.8" },
  "overlay": { "enabled": true|false, "opacity": 0-90 },
  "decorations": [ { "type": "rectangle"|"circle"|"stripe"|"polaroid"|"card", "css": "position: absolute; top: NN.NN%; left: NN.NN%; width: NN.NN%; height: NN.NN%; background: #RRGGBB; border-radius: Npx; box-shadow: ...; transform: rotate(Ndeg);" } ],
  "cardOverlay": { "enabled": true|false, "css": "position: absolute; top: NN%; left: NN%; width: NN%; height: NN%; background: rgba(...); border-radius: Npx;" },
  "textRegion": { "leftPct": <0-100>, "topPct": <0-100>, "widthPct": <0-100>, "heightPct": <0-100> }
}

Rules:
- decorations describes every visible non-text shape: polaroid frames, photo placeholders, stripes, cards, badges, geometric blobs. Include shadows / rotations when visible.
- textRegion is the empty rectangle where text actually lives (NOT overlapping decorations). The frontend will constrain text to this box. Be precise — leave 2-4% padding from decoration edges.
- cardOverlay ONLY when there is a translucent card behind the text.
- For background.type == "image", set value to 1-3 English search keywords for Pexels (e.g. "wooden desk warm").
- Output JSON ONLY. No prose, no markdown fences, no explanation.`;

const FORMAT_PROMPT = `You are a copywriter. The user provides an array of carousel slides, each with a title and body. Rewrite each slide so:
- title is punchy, <= 6 words
- body is concise (<= 200 chars), with a clear takeaway
- preserve language (Russian if input is Russian, etc.)
- keep meaning faithful - do not invent facts

Return STRICT JSON only:
{ "slides": [ { "title": "...", "body": "..." }, ... ] }
No prose, no markdown.`;

const SPLIT_PROMPT = `You are a copywriter for an Instagram/Pinterest carousel. The user provides a raw block of text. Your job:
1. Split it into 4–10 slides (one slide per coherent idea).
2. If the input already uses explicit slide markers like "Слайд 1", "Slide 2", "1 слайд", "Слайд №3" — RESPECT those boundaries: produce exactly as many slides as there are markers. Strip the markers from the output (do NOT include "Слайд N" anywhere in title or body).
3. Each slide gets a punchy title (<= 6 words) and a concise body (<= 220 chars).
4. Preserve the original language (Russian stays Russian, English stays English).
5. Keep meaning faithful — do not invent facts that aren't implied by the source.
6. Polish wording: remove filler, tighten phrasing, but stay on topic.

Return STRICT JSON only:
{ "slides": [ { "title": "...", "body": "..." }, ... ] }
No prose, no markdown fences.`;

/* ===================== LAYOUTS ===================== */
const LAYOUTS = [
    {
        id: 'centered',
        name: 'По центру',
        align: 'center',
        titlePos: 'center',
        padding: '80px 72px',
        previewSvg: `<rect x="10" y="18" width="28" height="4" rx="1" fill="#6366f1"/><rect x="8" y="26" width="32" height="2" rx="1" fill="#94a3b8"/><rect x="12" y="31" width="24" height="2" rx="1" fill="#94a3b8"/>`,
    },
    {
        id: 'top',
        name: 'Сверху',
        align: 'left',
        titlePos: 'top',
        padding: '100px 72px 80px',
        previewSvg: `<rect x="6" y="8" width="24" height="4" rx="1" fill="#6366f1"/><rect x="6" y="16" width="32" height="2" rx="1" fill="#94a3b8"/><rect x="6" y="21" width="28" height="2" rx="1" fill="#94a3b8"/><rect x="6" y="26" width="20" height="2" rx="1" fill="#94a3b8"/>`,
    },
    {
        id: 'bottom',
        name: 'Снизу',
        align: 'left',
        titlePos: 'bottom',
        padding: '80px 72px 100px',
        previewSvg: `<rect x="6" y="40" width="24" height="4" rx="1" fill="#6366f1"/><rect x="6" y="47" width="32" height="2" rx="1" fill="#94a3b8"/><rect x="6" y="52" width="28" height="2" rx="1" fill="#94a3b8"/>`,
    },
    {
        id: 'quote',
        name: 'Цитата',
        align: 'center',
        titlePos: 'center',
        padding: '120px 90px',
        previewSvg: `<text x="10" y="18" font-size="16" fill="#6366f1" opacity="0.3">\u201C</text><rect x="10" y="22" width="28" height="3" rx="1" fill="#6366f1"/><rect x="12" y="28" width="24" height="2" rx="1" fill="#94a3b8"/><rect x="14" y="33" width="20" height="2" rx="1" fill="#94a3b8"/>`,
    },
    {
        id: 'split',
        name: 'С акцентом',
        align: 'left',
        titlePos: 'center',
        padding: '80px 72px 80px 90px',
        previewSvg: `<rect x="2" y="0" width="4" height="60" fill="#6366f1"/><rect x="12" y="18" width="24" height="4" rx="1" fill="#6366f1"/><rect x="12" y="26" width="28" height="2" rx="1" fill="#94a3b8"/><rect x="12" y="31" width="22" height="2" rx="1" fill="#94a3b8"/>`,
    },
    {
        id: 'card',
        name: 'Карточка',
        align: 'center',
        titlePos: 'center',
        padding: '100px 90px',
        previewSvg: `<rect x="6" y="8" width="36" height="44" rx="4" fill="white" opacity="0.7"/><rect x="12" y="20" width="24" height="4" rx="1" fill="#6366f1"/><rect x="14" y="28" width="20" height="2" rx="1" fill="#94a3b8"/><rect x="16" y="33" width="16" height="2" rx="1" fill="#94a3b8"/>`,
    },
    {
        id: 'photo-bottom',
        name: 'Фото+текст',
        align: 'left',
        titlePos: 'bottom',
        padding: '0px 60px 80px',
        previewSvg: `<defs><linearGradient id="g-pb" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#94a3b8" stop-opacity="0.1"/><stop offset="100%" stop-color="#1a1a2e" stop-opacity="0.9"/></linearGradient></defs><rect x="0" y="0" width="48" height="60" fill="#94a3b8" opacity="0.3" rx="0"/><rect x="0" y="0" width="48" height="60" fill="url(#g-pb)" rx="0"/><rect x="6" y="42" width="22" height="4" rx="1" fill="white"/><rect x="6" y="49" width="30" height="2" rx="1" fill="white" opacity="0.7"/><rect x="6" y="54" width="26" height="2" rx="1" fill="white" opacity="0.5"/>`,
    },
];

/* ===================== GRADIENTS ===================== */
const GRADIENTS = [
    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    'linear-gradient(135deg, #0c3483 0%, #4fc3f7 100%)',
    'linear-gradient(135deg, #2d1b69 0%, #9333ea 100%)',
    'linear-gradient(135deg, #1b5e20 0%, #43a047 100%)',
    'linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%)',
    'linear-gradient(160deg, #fce4ec 0%, #e8eaf6 100%)',
    'linear-gradient(160deg, #f5f0e8 0%, #efe5d5 100%)',
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
    'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
    'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)',
    'linear-gradient(135deg, #c3cfe2 0%, #f5f7fa 100%)',
    'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)',
    'linear-gradient(135deg, #f5af19 0%, #f12711 100%)',
    'linear-gradient(135deg, #00c6fb 0%, #005bea 100%)',
    'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)',
    'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
    'linear-gradient(135deg, #434343 0%, #000000 100%)',
];

/* ===================== SOLID COLORS ===================== */
const SOLIDS = [
    '#ffffff', '#f8f9fc', '#f0f0f0', '#e8e0d8',
    '#0f0f1a', '#111827', '#1b2a4a', '#0a0a14',
    '#1a1a2e', '#2d1b69', '#1b5e20', '#7c2d12',
    '#000000', '#1e293b', '#334155', '#4a044e',
    '#fef2f2', '#fefce8', '#f0fdf4', '#eff6ff',
];

/* ===================== DECOR PRESETS ===================== */
/* Each preset is a recipe for a decoration the user can add by clicking.
 * css is the inline CSS for the decoration <div>. Position is given in % so
 * decor scales with the canvas. After adding, the user can drag / resize. */
const DECOR_PRESETS = [
    {
        id: 'rect-light',
        name: 'Карточка',
        cssLight: 'position:absolute; top:15%; left:12%; width:76%; height:55%; background:#ffffff; border-radius:14px; box-shadow:0 8px 32px rgba(0,0,0,0.12);',
        cssDark: 'position:absolute; top:15%; left:12%; width:76%; height:55%; background:#1f2937; border-radius:14px; box-shadow:0 8px 32px rgba(0,0,0,0.35);',
        svg: '<rect x="6" y="10" width="36" height="40" rx="4" fill="currentColor" opacity="0.85"/>',
    },
    {
        id: 'circle',
        name: 'Круг',
        cssLight: 'position:absolute; top:20%; left:20%; width:32%; height:auto; aspect-ratio:1/1; background:#fde68a; border-radius:50%;',
        cssDark: 'position:absolute; top:20%; left:20%; width:32%; height:auto; aspect-ratio:1/1; background:#7c3aed; border-radius:50%;',
        svg: '<circle cx="24" cy="30" r="12" fill="currentColor" opacity="0.85"/>',
    },
    {
        id: 'square-accent',
        name: 'Квадрат',
        cssLight: 'position:absolute; top:18%; left:18%; width:30%; height:auto; aspect-ratio:1/1; background:#fb7185; border-radius:6px; transform:rotate(-6deg);',
        cssDark: 'position:absolute; top:18%; left:18%; width:30%; height:auto; aspect-ratio:1/1; background:#22d3ee; border-radius:6px; transform:rotate(-6deg);',
        svg: '<rect x="14" y="20" width="20" height="20" rx="2" fill="currentColor" opacity="0.85" transform="rotate(-6 24 30)"/>',
    },
    {
        id: 'square-pair',
        name: 'Два квадрата',
        cssLight: null, /* multi-element: handled separately */
        multi: [
            'position:absolute; top:14%; left:10%; width:32%; height:auto; aspect-ratio:1/1; background:#fcd34d; border-radius:8px;',
            'position:absolute; top:50%; left:58%; width:32%; height:auto; aspect-ratio:1/1; background:#a78bfa; border-radius:8px;',
        ],
        svg: '<rect x="6" y="8" width="14" height="14" rx="2" fill="#fcd34d"/><rect x="28" y="38" width="14" height="14" rx="2" fill="#a78bfa"/>',
    },
    {
        id: 'stripe',
        name: 'Полоса',
        cssLight: 'position:absolute; top:0; left:0; width:8%; height:100%; background:#6366f1;',
        cssDark: 'position:absolute; top:0; left:0; width:8%; height:100%; background:#a5b4fc;',
        svg: '<rect x="0" y="0" width="6" height="60" fill="currentColor" opacity="0.85"/>',
    },
    {
        id: 'dot-pattern',
        name: 'Точки',
        cssLight: 'position:absolute; top:8%; left:8%; width:40%; height:30%; background-image: radial-gradient(circle, #6366f1 18%, transparent 20%); background-size: 14px 14px; opacity:0.6;',
        cssDark: 'position:absolute; top:8%; left:8%; width:40%; height:30%; background-image: radial-gradient(circle, #a5b4fc 18%, transparent 20%); background-size: 14px 14px; opacity:0.7;',
        svg: '<g fill="currentColor" opacity="0.8"><circle cx="8" cy="14" r="2"/><circle cx="16" cy="14" r="2"/><circle cx="24" cy="14" r="2"/><circle cx="8" cy="22" r="2"/><circle cx="16" cy="22" r="2"/><circle cx="24" cy="22" r="2"/><circle cx="8" cy="30" r="2"/><circle cx="16" cy="30" r="2"/><circle cx="24" cy="30" r="2"/></g>',
    },
    {
        id: 'photo-frame',
        name: 'Фото-рамка',
        cssLight: 'position:absolute; top:14%; left:25%; width:50%; height:48%; background:#ffffff; border-radius:6px; box-shadow:0 8px 24px rgba(0,0,0,0.18);',
        cssDark: 'position:absolute; top:14%; left:25%; width:50%; height:48%; background:#374151; border-radius:6px; box-shadow:0 8px 24px rgba(0,0,0,0.35);',
        svg: '<rect x="10" y="10" width="28" height="40" fill="currentColor" opacity="0.85" rx="2"/>',
    },
    {
        id: 'underline',
        name: 'Подчёркивание',
        cssLight: 'position:absolute; top:62%; left:14%; width:32%; height:8px; background:#fbbf24; border-radius:4px;',
        cssDark: 'position:absolute; top:62%; left:14%; width:32%; height:8px; background:#fbbf24; border-radius:4px;',
        svg: '<rect x="8" y="42" width="20" height="3" rx="1.5" fill="#fbbf24"/>',
    },
];

/* Add a decoration preset to current slide and re-render. */
function addDecorPreset(presetId) {
    const preset = DECOR_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    if (typeof pushEditHistory === 'function') pushEditHistory('До добавления декора');
    if (!state.settings.decorations) state.settings.decorations = [];
    const bgIsLight = isLightBg(state.selectedBg);
    if (preset.multi) {
        preset.multi.forEach(css => state.settings.decorations.push({ type: 'rectangle', css }));
    } else {
        const css = bgIsLight ? (preset.cssLight || preset.cssDark) : (preset.cssDark || preset.cssLight);
        state.settings.decorations.push({ type: 'rectangle', css });
    }
    renderSlide();
    renderThumbnails();
    showToast('Декор добавлен');
}

/* Remove last decoration (undo for the Decor panel). */
function removeLastDecor() {
    if (!state.settings.decorations || state.settings.decorations.length === 0) return;
    if (typeof pushEditHistory === 'function') pushEditHistory('До удаления последнего декора');
    state.settings.decorations.pop();
    state.settings.photoSlot = detectPhotoSlot(state.settings.decorations);
    renderSlide();
    renderThumbnails();
}

/* Clear all decorations on current slide. */
function clearAllDecor() {
    if (state.settings.decorations && state.settings.decorations.length > 0
        && typeof pushEditHistory === 'function') {
        pushEditHistory('До очистки всех декоров');
    }
    state.settings.decorations = [];
    state.settings.photoSlot = null;
    state.settings.slotPhotoSrc = null;
    renderSlide();
    renderThumbnails();
}

/* ===================== TEMPLATE PRESETS ===================== */
/* Ready-made designs the user can apply on step 2 with one click.
 * Each preset specifies bg, layout, decorations, textRegion, title/body fonts. */
const TEMPLATE_PRESETS = [
    {
        id: 'preset-card-light',
        name: 'Карточка',
        bg: { type: 'solid', value: '#fef3c7' },
        layoutId: 'centered',
        decorations: [
            { type: 'rectangle', css: 'position:absolute; top:14%; left:10%; width:80%; height:72%; background:#ffffff; border-radius:18px; box-shadow:0 12px 40px rgba(0,0,0,0.10);' },
        ],
        textRegion: { leftPct: 16, topPct: 24, widthPct: 68, heightPct: 52 },
        titleFont: 'Montserrat', bodyFont: 'Inter',
        titleSize: 46, bodySize: 22,
    },
    {
        id: 'preset-squares',
        name: 'Квадраты',
        bg: { type: 'solid', value: '#0f172a' },
        layoutId: 'bottom',
        decorations: [
            { type: 'rectangle', css: 'position:absolute; top:8%; left:8%; width:34%; height:auto; aspect-ratio:1/1; background:#fb923c; border-radius:8px; transform:rotate(-4deg);' },
            { type: 'rectangle', css: 'position:absolute; top:18%; left:58%; width:32%; height:auto; aspect-ratio:1/1; background:#a78bfa; border-radius:8px; transform:rotate(6deg);' },
        ],
        textRegion: { leftPct: 8, topPct: 56, widthPct: 84, heightPct: 36 },
        titleFont: 'Montserrat', bodyFont: 'Inter',
        titleSize: 48, bodySize: 22,
    },
    {
        id: 'preset-stripe',
        name: 'Полоса',
        bg: { type: 'solid', value: '#fefce8' },
        layoutId: 'split',
        decorations: [
            { type: 'rectangle', css: 'position:absolute; top:0; left:0; width:10%; height:100%; background:#6366f1;' },
        ],
        textRegion: { leftPct: 16, topPct: 18, widthPct: 76, heightPct: 64 },
        titleFont: 'Playfair Display', bodyFont: 'Inter',
        titleSize: 50, bodySize: 22,
    },
    {
        id: 'preset-minimal',
        name: 'Минимал',
        bg: { type: 'solid', value: '#ffffff' },
        layoutId: 'centered',
        decorations: [
            { type: 'rectangle', css: 'position:absolute; top:46%; left:42%; width:16%; height:4px; background:#1f2937; border-radius:2px;' },
        ],
        textRegion: { leftPct: 12, topPct: 20, widthPct: 76, heightPct: 60 },
        titleFont: 'Playfair Display', bodyFont: 'Inter',
        titleSize: 54, bodySize: 22,
    },
    {
        id: 'preset-bold-gradient',
        name: 'Постер',
        bg: { type: 'gradient', value: 'linear-gradient(135deg, #2d1b69 0%, #ec4899 100%)' },
        layoutId: 'centered',
        decorations: [
            { type: 'rectangle', css: 'position:absolute; top:8%; left:62%; width:40%; height:auto; aspect-ratio:1/1; background:radial-gradient(circle, rgba(252,211,77,0.45) 0%, rgba(252,211,77,0) 70%);' },
            { type: 'rectangle', css: 'position:absolute; top:60%; left:-8%; width:50%; height:auto; aspect-ratio:1/1; background:radial-gradient(circle, rgba(34,211,238,0.35) 0%, rgba(34,211,238,0) 70%);' },
        ],
        textRegion: { leftPct: 10, topPct: 20, widthPct: 80, heightPct: 60 },
        titleFont: 'Montserrat', bodyFont: 'Inter',
        titleSize: 56, bodySize: 22,
    },
    {
        id: 'preset-polaroid',
        name: 'Полароид',
        bg: { type: 'solid', value: '#fde68a' },
        layoutId: 'bottom',
        decorations: [
            { type: 'rectangle', css: 'position:absolute; top:8%; left:8%; width:38%; height:42%; background:#ffffff; border-radius:6px; box-shadow:0 8px 24px rgba(0,0,0,0.15); transform:rotate(-4deg);' },
            { type: 'rectangle', css: 'position:absolute; top:10%; left:54%; width:38%; height:44%; background:#ffffff; border-radius:6px; box-shadow:0 8px 24px rgba(0,0,0,0.15); transform:rotate(4deg);' },
        ],
        textRegion: { leftPct: 8, topPct: 58, widthPct: 84, heightPct: 34 },
        titleFont: 'Montserrat', bodyFont: 'Inter',
        titleSize: 42, bodySize: 22,
    },
    {
        id: 'preset-tag',
        name: 'Тэги',
        bg: { type: 'solid', value: '#eef2ff' },
        layoutId: 'top',
        decorations: [
            { type: 'rectangle', css: 'position:absolute; top:14%; left:8%; width:auto; padding:6px 14px; height:auto; background:#6366f1; color:#fff; border-radius:99px; font:600 14px Inter,sans-serif; display:flex; align-items:center; justify-content:center;' },
        ],
        textRegion: { leftPct: 8, topPct: 28, widthPct: 84, heightPct: 60 },
        titleFont: 'Inter', bodyFont: 'Inter',
        titleSize: 44, bodySize: 22,
    },
    {
        id: 'preset-magazine',
        name: 'Журнал',
        bg: { type: 'solid', value: '#fef3e2' },
        layoutId: 'top',
        decorations: [
            { type: 'rectangle', css: 'position:absolute; top:6%; left:8%; width:14%; height:4px; background:#1f2937;' },
            { type: 'rectangle', css: 'position:absolute; bottom:6%; right:8%; width:14%; height:4px; background:#1f2937;' },
        ],
        textRegion: { leftPct: 8, topPct: 16, widthPct: 84, heightPct: 70 },
        titleFont: 'Playfair Display', bodyFont: 'Inter',
        titleSize: 52, bodySize: 20,
    },
];

/* Apply a TEMPLATE_PRESET to current state and jump to editor. */
function applyTemplatePreset(presetId) {
    const p = TEMPLATE_PRESETS.find(t => t.id === presetId);
    if (!p) return;
    state.selectedBg = JSON.parse(JSON.stringify(p.bg));
    const layout = LAYOUTS.find(l => l.id === p.layoutId);
    if (layout) state.selectedLayout = layout;
    state.settings.decorations = JSON.parse(JSON.stringify(p.decorations || []));
    state.settings.textRegion = p.textRegion ? { ...p.textRegion } : null;
    state.settings.photoSlot = detectPhotoSlot(state.settings.decorations);
    state.settings.slotPhotoSrc = null;
    state.settings.cardOverlay = null;
    if (p.titleFont) state.settings.titleFont = p.titleFont;
    if (p.bodyFont) state.settings.bodyFont = p.bodyFont;
    if (p.titleSize) state.settings.titleSize = p.titleSize;
    if (p.bodySize) state.settings.fontSize = p.bodySize;
    if (p.layoutId === 'top') state.settings.textPosition = 'top';
    else if (p.layoutId === 'bottom') state.settings.textPosition = 'bottom';
    else state.settings.textPosition = 'center';
    showToast(`Шаблон «${p.name}» применён`);
    const btnEditor = document.querySelector('#btn-to-editor');
    if (btnEditor) btnEditor.disabled = false;
}

/* ===================== STATE ===================== */
let state = {
    slides: [],
    currentSlide: 0,
    // Stack of pre-AI-mutation snapshots (capped to AI_HISTORY_LIMIT).
    aiHistory: [],
    // Stack of pre-action state snapshots for the universal undo button
    // (Ctrl+Z / «Назад»). Covers drag, resize, decor add/remove/modify,
    // layout/position changes, background/color swaps, etc. Capped to
    // EDIT_HISTORY_LIMIT to bound memory.
    editHistory: [],
    // Index of decoration the user is currently editing (or null when none).
    // Lives on root state because it's purely UI focus, not slide content.
    selectedDecorIdx: null,
    // Which non-decor draggable is currently selected: 'title' | 'body' |
    // 'card' | null. When ANY element is selected (text or decor) all others
    // become non-interactive (pointer-events:none) so dragging one doesn't
    // accidentally grab another. Tap an empty part of the canvas to clear.
    selectedTextEl: null,
    selectedLayout: LAYOUTS[0],
    selectedBg: { type: 'gradient', value: GRADIENTS[0] },
    settings: {
        ratio: '4:5',
        titleFont: 'Montserrat',
        bodyFont: 'Inter',
        fontSize: 28,
        titleSize: 44,
        align: null,
        showNumber: true,
        author: '',
        overlayOpacity: 50,
        overlayMode: 'darken',
        overlayDirection: 'auto',
        bgBlur: 0,
        highlightColor: '#FBBF24',
        highlightStyle: 'marker',
        textPosition: null,
    },
    pexels: {
        query: 'business office',
        page: 1,
        photos: [],
        loading: false,
    },
};

/* ===================== DOM REFS ===================== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const textInput = $('#text-input');
const charCount = $('#char-count');
const slideCountNum = $('#slide-count-num');
const btnToStyle = $('#btn-to-style');
const btnAiSplit = $('#btn-ai-split');
const btnBackToText = $('#btn-back-to-text');
const btnToEditor = $('#btn-to-editor');
const btnBackToStyle = $('#btn-back-to-style');
const slideCanvas = $('#slide-canvas');
const slideTitle = $('#slide-title');
const slideBody = $('#slide-body');
const slideNumber = $('#slide-number');
const slideAuthor = $('#slide-author');
const slideDecoration = $('#slide-decoration');
const canvasWrapper = $('#canvas-wrapper');
const currentSlideNum = $('#current-slide-num');
const totalSlidesNum = $('#total-slides-num');
const thumbnailsStrip = $('#thumbnails-strip');
const titleFontSelect = $('#title-font-select');
const bodyFontSelect = $('#body-font-select');
const bgImageInput = $('#bg-image-input');
const btnUploadBg = $('#btn-upload-bg');
const photoControls = $('#photo-controls');
const bgOverlayRange = $('#bg-overlay');
const bgOverlayVal = $('#bg-overlay-val');
const bgBlurRange = $('#bg-blur');
const bgBlurVal = $('#bg-blur-val');
const btnRemoveBg = $('#btn-remove-bg');
const slideBgImage = $('#slide-bg-image');
const slideBgOverlay = $('#slide-bg-overlay');
const fontSizeRange = $('#font-size');
const fontSizeVal = $('#font-size-val');
const titleSizeRange = $('#title-size');
const titleSizeVal = $('#title-size-val');
const showSlideNumber = $('#show-slide-number');
const authorInput = $('#author-name');
const btnExportAll = $('#btn-export-all');
const btnExportCurrent = $('#btn-export-current');
const btnPrevSlide = $('#btn-prev-slide');
const btnNextSlide = $('#btn-next-slide');
const btnAddSlide = $('#btn-add-slide');
const loadingOverlay = $('#loading-overlay');
const toastContainer = $('#toast-container');
const photoGrid = $('#photo-grid');
const photoLoading = $('#photo-loading');
const btnLoadMore = $('#btn-load-more');
const photoSearch = $('#photo-search');
const layoutOptions = $('#layout-options');
const gradientGrid = $('#gradient-grid');
const solidGrid = $('#solid-grid');

/* ===================== TEXT PARSING =====================
 * Splits raw user text into slide blocks. Priority order:
 *   1. Explicit "Слайд N" / "Slide N" markers (tolerant of trailing
 *      punctuation and same-line content; markers stripped from output).
 *   2. Explicit `---` separators.
 *   3. Numbered list `1.`, `2)`, `3:`.
 *   4. Fallback: double newlines.
 */

// Matches a slide marker at line start (or right after a newline). Captures
// the slide number. Tolerant of:
//   слайд 1 / Слайд №2 / Slide 3 / СЛАЙД #4 / Слайд - 5 / 1 слайд / Slide-7
// Trailing punctuation (":", ".", "—", ")") is consumed so it doesn't leak
// into the slide title. Content can follow on the same line.
const SLIDE_MARKER_RE = /(?:^|\n)[\t ]*(?:(?:слайды?|slide)[\s\-:#№.)]*(\d+)|(\d+)[\s\-:#№.)]*(?:слайды?|slide))[\s\-:.—)]*/giu;

function findSlideMarkers(text) {
    const markers = [];
    let m;
    SLIDE_MARKER_RE.lastIndex = 0;
    while ((m = SLIDE_MARKER_RE.exec(text)) !== null) {
        const n = parseInt(m[1] || m[2], 10);
        if (!isNaN(n)) {
            markers.push({ start: m.index, end: m.index + m[0].length, num: n });
        }
    }
    return markers;
}

function parseSlides(text) {
    if (!text.trim()) return [];

    // 1. Explicit "Слайд N" / "Slide N" markers — definitive when 2+ found.
    const markers = findSlideMarkers(text);
    if (markers.length >= 2) {
        const slides = [];
        for (let i = 0; i < markers.length; i++) {
            const start = markers[i].end;
            const end = i + 1 < markers.length ? markers[i + 1].start : text.length;
            const chunk = text.slice(start, end).trim();
            if (chunk) slides.push(blockToSlide(chunk));
        }
        if (slides.length > 0) return slides;
    }

    // 2. Explicit --- separators
    if (text.includes('---')) {
        const blocks = text.split(/\n---\n|\n---$|^---\n/);
        return blocks.map(b => b.trim()).filter(b => b.length > 0).map(blockToSlide);
    }

    // 3. Detect numbered list patterns (e.g. "1.", "2)", "1:")
    const numberedRe = /^\d+[.):\s]/m;
    const lines = text.split('\n');
    const numberedLines = lines.filter(l => /^\d+[.):\s]/.test(l.trim()));
    if (numberedLines.length >= 2) {
        const slides = [];
        let currentBlock = [];
        let hasTitle = false;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                if (currentBlock.length > 0) {
                    const blockText = currentBlock.join('\n').trim();
                    if (!hasTitle && !numberedRe.test(blockText)) {
                        slides.push(blockToSlide(blockText));
                        currentBlock = [];
                        hasTitle = true;
                        continue;
                    }
                }
                if (currentBlock.length > 0) currentBlock.push('');
                continue;
            }
            if (/^\d+[.):\s]/.test(trimmed) && currentBlock.length > 0) {
                const blockText = currentBlock.join('\n').trim();
                if (blockText) slides.push(blockToSlide(blockText));
                currentBlock = [trimmed];
            } else {
                currentBlock.push(trimmed);
            }
        }
        if (currentBlock.length > 0) {
            const blockText = currentBlock.join('\n').trim();
            if (blockText) slides.push(blockToSlide(blockText));
        }
        if (slides.length >= 2) return slides;
    }

    // 4. Fallback: split on double newlines
    const blocks = text.split(/\n\s*\n/);
    return blocks.map(b => b.trim()).filter(b => b.length > 0).map(blockToSlide);
}

function blockToSlide(block) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return { title: '', body: '' };
    if (lines.length === 1) return { title: lines[0], body: '' };
    return { title: lines[0], body: lines.slice(1).join('\n').trim() };
}

/* ===================== STEP NAVIGATION ===================== */
function goToStep(num) {
    $$('.step').forEach(s => s.classList.remove('active'));
    $(`#step-${num}`).classList.add('active');
    $$('.step-indicator').forEach((ind, i) => {
        ind.classList.remove('active', 'done');
        if (i + 1 < num) ind.classList.add('done');
        if (i + 1 === num) ind.classList.add('active');
    });
    $$('.step-line').forEach((line, i) => {
        line.classList.toggle('done', i + 1 < num);
    });
    if (num === 2) {
        if (state.pexels.photos.length === 0) {
            fetchPhotos('business office', true);
        }
    }
    if (num === 3) {
        requestAnimationFrame(() => { scaleCanvas(); renderSlide(); renderThumbnails(); });
    }
}

/* ===================== PEXELS API ===================== */
async function fetchPhotos(query, reset = false) {
    if (state.pexels.loading) return;
    state.pexels.loading = true;

    if (reset) {
        state.pexels.page = 1;
        state.pexels.photos = [];
        photoGrid.innerHTML = '';
        photoLoading.style.display = 'block';
        photoGrid.appendChild(photoLoading);
    }

    state.pexels.query = query;

    try {
        const url = `${PEXELS_BASE}/search?query=${encodeURIComponent(query)}&per_page=24&page=${state.pexels.page}&orientation=portrait`;
        const resp = await fetch(url, {
            headers: { 'Authorization': PEXELS_API_KEY }
        });
        const data = await resp.json();

        if (data.photos && data.photos.length > 0) {
            state.pexels.photos.push(...data.photos);
            renderPhotos(data.photos, reset);
            btnLoadMore.style.display = data.next_page ? 'block' : 'none';
        } else if (reset) {
            photoGrid.innerHTML = '<div class="photo-grid-loading">\u041d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0434\u0440\u0443\u0433\u043e\u0439 \u0437\u0430\u043f\u0440\u043e\u0441.</div>';
            btnLoadMore.style.display = 'none';
        }
    } catch (err) {
        console.error('Pexels error:', err);
        if (reset) {
            photoGrid.innerHTML = '<div class="photo-grid-loading">\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043f\u043e\u0437\u0436\u0435.</div>';
        }
    }

    photoLoading.style.display = 'none';
    state.pexels.loading = false;
}

function renderPhotos(photos, reset) {
    if (reset) {
        photoGrid.innerHTML = '';
    }
    for (const photo of photos) {
        const div = document.createElement('div');
        div.className = 'photo-item';
        if (state.selectedBg.type === 'photo' && state.selectedBg.pexelsId === photo.id) {
            div.classList.add('selected');
        }
        const previewTitle = state.slides.length > 0 ? (state.slides[0].title || '').substring(0, 40) : '';
        const previewBody = state.slides.length > 0 ? (state.slides[0].body || '').substring(0, 60) : '';
        div.innerHTML = `
            <img src="${photo.src.medium}" alt="${photo.alt || ''}" loading="lazy">
            <div class="photo-text-preview">
                ${previewTitle ? `<span class="preview-title">${previewTitle}</span>` : ''}
                ${previewBody ? `<span>${previewBody}</span>` : ''}
            </div>
            <div class="photo-credit">${photo.photographer}</div>
        `;
        div.addEventListener('click', () => {
            $$('.photo-item').forEach(p => p.classList.remove('selected'));
            $$('.gradient-item').forEach(g => g.classList.remove('selected'));
            $$('.solid-item').forEach(s => s.classList.remove('selected'));
            div.classList.add('selected');
            state.selectedBg = {
                type: 'photo',
                value: photo.src.large2x || photo.src.original,
                medium: photo.src.medium,
                pexelsId: photo.id,
                photographer: photo.photographer,
            };
            updateEditorButton();
        });
        photoGrid.appendChild(div);
    }
}

/* ===================== LAYOUT RENDERING ===================== */
function renderLayouts() {
    layoutOptions.innerHTML = LAYOUTS.map(l => `
        <div class="layout-card ${l.id === state.selectedLayout.id ? 'selected' : ''}" data-layout="${l.id}">
            <div class="layout-preview">
                <svg viewBox="0 0 48 60" width="48" height="60">${l.previewSvg}</svg>
            </div>
            <div class="layout-label">${l.name}</div>
        </div>
    `).join('');

    layoutOptions.querySelectorAll('.layout-card').forEach(card => {
        card.addEventListener('click', () => {
            if (typeof pushEditHistory === 'function') pushEditHistory('До смены макета');
            $$('.layout-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            state.selectedLayout = LAYOUTS.find(l => l.id === card.dataset.layout);
            // Switching layouts implies switching its default text alignment and
            // vertical position so the visual change is obvious. The user can
            // still override with the alignment / position buttons afterwards.
            state.settings.align = state.selectedLayout.align;
            state.settings.textPosition = state.selectedLayout.titlePos;
            // Picking a new layout means the user wants its factory placement —
            // discard any per-slide drag overrides so the preset actually shows.
            resetAllDraggedPositions();
            syncSidebarWithState();
            updateEditorButton();
            if (state.slides && state.slides.length) {
                renderSlide();
                renderThumbnails();
            }
        });
    });
}

/* ===================== GRADIENT & SOLID GRIDS ===================== */
function renderGradients() {
    gradientGrid.innerHTML = GRADIENTS.map((g, i) => `
        <div class="gradient-item ${state.selectedBg.type === 'gradient' && state.selectedBg.value === g ? 'selected' : ''}" data-index="${i}" style="background: ${g};"></div>
    `).join('');

    gradientGrid.querySelectorAll('.gradient-item').forEach(item => {
        item.addEventListener('click', () => {
            $$('.photo-item').forEach(p => p.classList.remove('selected'));
            $$('.gradient-item').forEach(g => g.classList.remove('selected'));
            $$('.solid-item').forEach(s => s.classList.remove('selected'));
            item.classList.add('selected');
            state.selectedBg = { type: 'gradient', value: GRADIENTS[item.dataset.index] };
            updateEditorButton();
        });
    });
}

function renderSolids() {
    solidGrid.innerHTML = SOLIDS.map((c, i) => `
        <div class="solid-item ${state.selectedBg.type === 'solid' && state.selectedBg.value === c ? 'selected' : ''}" data-index="${i}" style="background: ${c}; ${c === '#ffffff' || c === '#f8f9fc' || c === '#f0f0f0' || c === '#e8e0d8' || c.startsWith('#fe') || c.startsWith('#f0') || c.startsWith('#ef') ? 'border: 1px solid #e2e8f0;' : ''}"></div>
    `).join('');

    solidGrid.querySelectorAll('.solid-item').forEach(item => {
        item.addEventListener('click', () => {
            $$('.photo-item').forEach(p => p.classList.remove('selected'));
            $$('.gradient-item').forEach(g => g.classList.remove('selected'));
            $$('.solid-item').forEach(s => s.classList.remove('selected'));
            item.classList.add('selected');
            state.selectedBg = { type: 'solid', value: SOLIDS[item.dataset.index] };
            updateEditorButton();
        });
    });
}

function updateEditorButton() {
    btnToEditor.disabled = false;
}

/* ===================== TEMPLATE PRESETS ===================== */
function renderTemplatePresets() {
    const grid = document.getElementById('preset-grid');
    if (!grid) return;
    grid.innerHTML = TEMPLATE_PRESETS.map(p => {
        const bgStyle = p.bg.type === 'gradient'
            ? `background: ${p.bg.value};`
            : `background: ${p.bg.value};`;
        const decorHtml = (p.decorations || []).map(d => {
            // Strip any inline scripts and trust our own preset CSS.
            return `<div style="${d.css}"></div>`;
        }).join('');
        return `
            <div class="preset-card" data-preset-id="${p.id}" title="${p.name}">
                <div class="preset-thumb" style="${bgStyle}">
                    <div class="preset-thumb-inner">${decorHtml}</div>
                </div>
                <div class="preset-name">${p.name}</div>
            </div>`;
    }).join('');
    grid.querySelectorAll('.preset-card').forEach(card => {
        card.addEventListener('click', () => {
            applyTemplatePreset(card.dataset.presetId);
            // Jump straight to editor for a quick-start flow.
            state.currentSlide = 0;
            state.settings.align = state.settings.align || state.selectedLayout.align;
            syncSidebarWithState();
            goToStep(3);
        });
    });
}

/* ===================== DECOR BUTTONS (sidebar) ===================== */
function renderDecorButtons() {
    const grid = document.getElementById('decor-grid');
    if (!grid) return;
    grid.innerHTML = DECOR_PRESETS.map(p => `
        <button class="decor-btn" data-preset-id="${p.id}" title="${p.name}" aria-label="${p.name}">
            <svg viewBox="0 0 48 60" xmlns="http://www.w3.org/2000/svg">${p.svg}</svg>
            <span class="decor-btn-label">${p.name}</span>
        </button>
    `).join('');
    grid.querySelectorAll('.decor-btn').forEach(btn => {
        btn.addEventListener('click', () => addDecorPreset(btn.dataset.presetId));
    });
}

function wireDecorActions() {
    const undo = document.getElementById('btn-decor-undo');
    const clr = document.getElementById('btn-decor-clear');
    if (undo) undo.addEventListener('click', () => {
        removeLastDecor();
        state.selectedDecorIdx = null;
        syncDecorDetailPanel();
    });
    if (clr) clr.addEventListener('click', () => {
        clearAllDecor();
        state.selectedDecorIdx = null;
        syncDecorDetailPanel();
    });

    // Per-decoration controls (opacity / outline / delete).
    const opacityInput = document.getElementById('decor-opacity');
    const opacityVal = document.getElementById('decor-opacity-val');
    if (opacityInput) {
        opacityInput.addEventListener('input', () => {
            if (typeof pushEditHistoryDebounced === 'function') pushEditHistoryDebounced('До смены прозрачности');
            const pct = parseInt(opacityInput.value, 10);
            if (opacityVal) opacityVal.textContent = `${pct}%`;
            patchSelectedDecorMods({ opacity: pct / 100 });
        });
    }
    const outlineToggle = document.getElementById('decor-outline-only');
    if (outlineToggle) {
        outlineToggle.addEventListener('change', () => {
            if (typeof pushEditHistory === 'function') pushEditHistory('До переключения обводки');
            patchSelectedDecorMods({ outlineOnly: outlineToggle.checked });
        });
    }
    const outlineWidth = document.getElementById('decor-outline-width');
    const outlineWidthVal = document.getElementById('decor-outline-width-val');
    if (outlineWidth) {
        outlineWidth.addEventListener('input', () => {
            if (typeof pushEditHistoryDebounced === 'function') pushEditHistoryDebounced('До смены толщины обводки');
            const w = parseInt(outlineWidth.value, 10);
            if (outlineWidthVal) outlineWidthVal.textContent = `${w}px`;
            patchSelectedDecorMods({ outlineWidth: w });
        });
    }
    const outlineColor = document.getElementById('decor-outline-color');
    if (outlineColor) {
        outlineColor.addEventListener('input', () => {
            if (typeof pushEditHistoryDebounced === 'function') pushEditHistoryDebounced('До смены цвета обводки');
            patchSelectedDecorMods({ outlineColor: outlineColor.value });
        });
    }
    const btnDeselect = document.getElementById('btn-decor-deselect');
    if (btnDeselect) {
        btnDeselect.addEventListener('click', () => {
            state.selectedDecorIdx = null;
            renderSlide();
            syncDecorDetailPanel();
        });
    }
    const btnDelete = document.getElementById('btn-decor-delete');
    if (btnDelete) {
        btnDelete.addEventListener('click', () => {
            const idx = state.selectedDecorIdx;
            const decos = state.settings.decorations;
            if (idx === null || !decos) return;
            if (typeof pushEditHistory === 'function') pushEditHistory('До удаления декора');
            decos.splice(idx, 1);
            if (typeof detectPhotoSlot === 'function') {
                state.settings.photoSlot = detectPhotoSlot(decos);
            }
            state.selectedDecorIdx = null;
            renderSlide();
            renderThumbnails();
            syncDecorDetailPanel();
        });
    }

    // Click on empty canvas area deselects whatever was selected.
    const canvas = document.getElementById('slide-canvas');
    if (canvas) {
        canvas.addEventListener('pointerdown', (ev) => {
            // Only deselect when click lands on the canvas itself or content area,
            // not on a decoration/title/body (those stopPropagation in their own handler).
            if (ev.target === canvas || ev.target.classList?.contains('slide-content-area')) {
                if (state.selectedDecorIdx !== null || state.selectedTextEl !== null) {
                    state.selectedDecorIdx = null;
                    state.selectedTextEl = null;
                    renderSlide();
                    syncDecorDetailPanel();
                }
            }
        });
    }
}

/* ===================== API KEY MODAL ===================== */
function renderKeyList() {
    const list = document.getElementById('api-keys-list');
    if (!list) return;
    const vault = loadKeyVault();
    // null activeId means "use first builtin" — show that builtin as active.
    const effectiveActive = vault.activeId || GEMINI_BUILTIN_KEYS[0].id;

    // Show built-in keys only if they actually have a value baked in.
    // The public build ships with empty placeholders, which would otherwise
    // appear as confusing dead slots in the list.
    const items = GEMINI_BUILTIN_KEYS.filter(k => k.value).map(k => ({ ...k }));
    vault.keys.forEach(k => items.push({ ...k, builtin: false }));

    if (items.length === 0) {
        list.innerHTML = `<div class="api-key-empty">У вас пока нет сохранённых ключей. Нажмите <strong>+ Добавить</strong> чтобы добавить свой Gemini API-ключ. Получить ключ можно бесплатно на <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.</div>`;
        return;
    }

    list.innerHTML = items.map(k => {
        const isActive = k.id === effectiveActive;
        const slot = k.id;
        const q = getQuotaState(slot);
        const remaining = Math.max(0, GEMINI_FREE_TIER_LIMIT - q.used);
        const quotaCls = q.exhausted ? 'danger' : (q.used >= GEMINI_FREE_TIER_LIMIT * 0.7 ? 'warn' : '');
        const quotaTxt = q.exhausted ? 'исчерпан' : `${remaining}/${GEMINI_FREE_TIER_LIMIT}`;
        const masked = k.value.slice(0, 8) + '…' + k.value.slice(-4);
        return `
            <div class="api-key-item ${isActive ? 'active' : ''}" data-id="${k.id}">
                <div class="api-key-radio"></div>
                <div class="api-key-info">
                    <div class="api-key-name">${escapeHtml(k.name)}<span class="api-key-quota-mini ${quotaCls}">${quotaTxt}</span></div>
                    <div class="api-key-meta">${masked}${k.builtin ? ' • встроенный' : ''}</div>
                </div>
                <div class="api-key-actions">
                    ${k.builtin ? '' : `<button class="btn-rename-key" title="Переименовать">✏</button>`}
                    ${k.builtin ? '' : `<button class="btn-delete-key" title="Удалить">🗑</button>`}
                </div>
            </div>`;
    }).join('');

    // Wire up clicks
    list.querySelectorAll('.api-key-item').forEach(el => {
        const id = el.dataset.id;
        // Click info or radio to switch
        const radio = el.querySelector('.api-key-radio');
        const info = el.querySelector('.api-key-info');
        const onSwitch = () => {
            setActiveKey(id);
            renderKeyList();
            updateQuotaUi();
            showToast('Активный ключ переключён');
        };
        if (radio) radio.addEventListener('click', onSwitch);
        if (info) info.addEventListener('click', onSwitch);

        const isBuiltin = !!findBuiltinKey(id);
        const renameBtn = el.querySelector('.btn-rename-key');
        if (renameBtn && id && !isBuiltin) {
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const cur = loadKeyVault().keys.find(x => x.id === id);
                const newName = prompt('Новое название:', cur ? cur.name : '');
                if (newName !== null) {
                    renameKey(id, newName.trim());
                    renderKeyList();
                    updateQuotaUi();
                }
            });
        }

        const delBtn = el.querySelector('.btn-delete-key');
        if (delBtn && id && !isBuiltin) {
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!confirm('Удалить этот ключ из браузера?')) return;
                removeKeyFromVault(id);
                renderKeyList();
                updateQuotaUi();
            });
        }
    });
}

function wireApiKeyModal() {
    const backdrop = document.getElementById('api-modal-backdrop');
    const openBtn = document.getElementById('btn-open-api-modal');
    const closeBtn = document.getElementById('btn-api-cancel');
    const saveBtn = document.getElementById('btn-api-save');
    const toggleAddBtn = document.getElementById('btn-toggle-add-key');
    const addCancelBtn = document.getElementById('btn-add-cancel');
    const addSection = document.getElementById('api-add-key');
    const keysSection = document.querySelector('.api-keys-section');
    const bottomActions = document.getElementById('api-modal-bottom-actions');
    const input = document.getElementById('api-key-input');
    const nameInput = document.getElementById('api-key-name-input');
    const status = document.getElementById('api-modal-status');
    if (!backdrop || !openBtn) return;

    const showList = () => {
        addSection.style.display = 'none';
        keysSection.style.display = '';
        bottomActions.style.display = '';
    };
    const showAdd = () => {
        addSection.style.display = '';
        keysSection.style.display = 'none';
        bottomActions.style.display = 'none';
        nameInput.value = '';
        input.value = '';
        status.textContent = '';
        status.classList.remove('ok', 'err');
        setTimeout(() => input.focus(), 50);
    };

    const open = () => {
        updateQuotaUi();
        renderKeyList();
        showList();
        backdrop.style.display = 'flex';
    };
    const close = () => { backdrop.style.display = 'none'; };

    openBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && backdrop.style.display !== 'none') {
            if (addSection.style.display !== 'none') showList();
            else close();
        }
    });

    toggleAddBtn.addEventListener('click', showAdd);
    addCancelBtn.addEventListener('click', showList);

    saveBtn.addEventListener('click', async () => {
        const key = (input.value || '').trim();
        const name = (nameInput.value || '').trim() || `Ключ ${loadKeyVault().keys.length + 1}`;
        if (!key) {
            status.textContent = 'Вставьте ключ.';
            status.className = 'api-modal-status err';
            return;
        }
        if (!/^AIzaSy[A-Za-z0-9_\-]{20,}$/.test(key)) {
            status.textContent = 'Неверный формат. Ключ должен начинаться с AIzaSy.';
            status.className = 'api-modal-status err';
            return;
        }
        if (loadKeyVault().keys.some(k => k.value === key)) {
            status.textContent = 'Этот ключ уже сохранён.';
            status.className = 'api-modal-status err';
            return;
        }
        status.textContent = 'Проверяю ключ…';
        status.className = 'api-modal-status';
        try {
            const tempUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
            const r = await fetch(tempUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
                    generationConfig: { temperature: 0, maxOutputTokens: 5 },
                }),
            });
            if (r.ok) {
                addKeyToVault(name, key);
                updateQuotaUi();
                renderKeyList();
                status.textContent = 'Ключ работает. Сохранён и активирован.';
                status.className = 'api-modal-status ok';
                showToast('AI ключ добавлен');
                setTimeout(showList, 800);
            } else {
                const t = await r.text().catch(() => '');
                if (r.status === 400 && t.includes('location is not supported')) {
                    // Save anyway — user may switch VPN on later
                    addKeyToVault(name, key);
                    renderKeyList();
                    updateQuotaUi();
                    status.textContent = 'Ключ валидный, но Gemini сейчас не пускает с вашего IP. Сохранён.';
                    status.className = 'api-modal-status ok';
                    setTimeout(showList, 1500);
                } else if (r.status === 429) {
                    addKeyToVault(name, key);
                    renderKeyList();
                    updateQuotaUi();
                    status.textContent = 'Ключ валидный, но его квота на сегодня исчерпана. Сохранён.';
                    status.className = 'api-modal-status ok';
                    setTimeout(showList, 1500);
                } else {
                    status.textContent = `Ошибка ${r.status}: ${t.slice(0, 120)}`;
                    status.className = 'api-modal-status err';
                }
            }
        } catch (err) {
            status.textContent = 'Сеть не пускает: ' + (err.message || err);
            status.className = 'api-modal-status err';
        }
    });
}

/* ===================== CANVAS SCALING ===================== */
function getCanvasDimensions() {
    const r = state.settings.ratio;
    if (r === '1:1') return { w: 1080, h: 1080 };
    if (r === '9:16') return { w: 1080, h: 1920 };
    return { w: 1080, h: 1350 };
}

function scaleCanvas() {
    const { w, h } = getCanvasDimensions();
    slideCanvas.style.width = w + 'px';
    slideCanvas.style.height = h + 'px';
    const wrapW = canvasWrapper.clientWidth - 20;
    const wrapH = canvasWrapper.clientHeight - 20;
    const scale = Math.min(wrapW / w, wrapH / h, 1);
    // Expose the scale as a CSS var so slide-change keyframes can compose
    // translateX with the same scale().
    slideCanvas.style.setProperty('--canvas-scale', String(scale));
    slideCanvas.style.transform = `scale(${scale})`;
}

/* ===================== TEXT COLOR DETECTION ===================== */
function isLightBg(bg) {
    if (!bg) return true;
    if (bg.type === 'photo') return false;
    const val = bg.value;
    if (val.includes('gradient')) {
        const colors = val.match(/#[0-9a-fA-F]{6}/g) || [];
        if (colors.length === 0) return true;
        return colors.every(c => getLuminance(c) > 0.5);
    }
    return getLuminance(val) > 0.5;
}

function getLuminance(hex) {
    if (!hex || !hex.startsWith('#')) return 0.5;
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

/* ===================== DRAGGABLE ELEMENTS ===================== */
/**
 * Make an element draggable inside the slide canvas. Positions are tracked
 * in % of canvas size, so dragging works at any zoom / screen size and the
 * stored coordinates remain meaningful across exports.
 *
 * The element must already be position:absolute and have an initial top/left.
 * After drag, opts.onEnd({leftPct, topPct, widthPct, heightPct}) fires so the
 * caller can persist the new position to state.
 */
function makeDraggable(el, opts = {}) {
    if (!el) return;
    // Remove any previously attached drag handlers so we can re-bind with
    // updated callbacks on each render.
    if (el._dragHandlers) {
        el.removeEventListener('pointerdown', el._dragHandlers.down);
        el.removeEventListener('pointermove', el._dragHandlers.move);
        el.removeEventListener('pointerup', el._dragHandlers.up);
        el.removeEventListener('pointercancel', el._dragHandlers.up);
    }
    el.style.touchAction = 'none';
    el.style.userSelect = 'none';

    let drag = null;

    const onDown = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        // Don't capture if user is actively editing text inside this element
        if (el.isContentEditable && document.activeElement === el) return;
        e.preventDefault();
        e.stopPropagation();
        const cr = slideCanvas.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        drag = {
            startX: e.clientX,
            startY: e.clientY,
            startLeftPct: (er.left - cr.left) / cr.width * 100,
            startTopPct: (er.top - cr.top) / cr.height * 100,
            widthPct: er.width / cr.width * 100,
            heightPct: er.height / cr.height * 100,
            cw: cr.width,
            ch: cr.height,
            // Track whether the user actually moved the element so we only
            // push history for real drags (not stray clicks).
            moved: false,
            historyPushed: false,
            // For smooth dragging we animate `transform: translate3d(...)`
            // every frame (rAF-throttled) instead of re-writing top/left on
            // each pointermove. left/top is committed once on pointerup.
            // Saving the original transform lets us cleanly restore it.
            origTransform: el.style.transform || '',
            pendingDx: 0,
            pendingDy: 0,
            rafId: 0,
        };
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        el.classList.add('dragging');
    };

    const flushTransform = () => {
        if (!drag) return;
        drag.rafId = 0;
        const base = drag.origTransform ? (drag.origTransform + ' ') : '';
        el.style.transform = base + `translate3d(${drag.pendingDx}px, ${drag.pendingDy}px, 0)`;
    };

    const onMove = (e) => {
        if (!drag) return;
        const dxPx = e.clientX - drag.startX;
        const dyPx = e.clientY - drag.startY;
        // Push a history entry the first time the user clearly moves the
        // element (>3px) so undo restores the pre-drag position.
        if (!drag.historyPushed && (Math.abs(dxPx) + Math.abs(dyPx) > 3)) {
            drag.historyPushed = true;
            drag.moved = true;
            if (typeof pushEditHistory === 'function') pushEditHistory('Перед перетаскиванием');
        }
        drag.pendingDx = dxPx;
        drag.pendingDy = dyPx;
        if (!drag.rafId) drag.rafId = requestAnimationFrame(flushTransform);
    };

    const onUp = (e) => {
        if (!drag) return;
        if (drag.rafId) { cancelAnimationFrame(drag.rafId); drag.rafId = 0; }
        const dxPct = (e.clientX - drag.startX) / drag.cw * 100;
        const dyPct = (e.clientY - drag.startY) / drag.ch * 100;
        const newLeftPct = drag.startLeftPct + dxPct;
        const newTopPct = drag.startTopPct + dyPct;
        // Commit the final position to top/left (in %) so it survives any
        // future re-render, and restore the element's original transform so
        // the translate3d we used during the drag doesn't compound.
        el.style.transform = drag.origTransform;
        el.style.left = newLeftPct + '%';
        el.style.top = newTopPct + '%';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        // Drag only changes position. Don't pass width/height to onEnd so that
        // elements relying on aspect-ratio or width:auto stay intact. Resize
        // handles still pass full geometry.
        const result = { leftPct: newLeftPct, topPct: newTopPct };
        drag = null;
        el.classList.remove('dragging');
        try { el.releasePointerCapture(e.pointerId); } catch (_) {}
        if (opts.onEnd) opts.onEnd(result);
    };

    el._dragHandlers = { down: onDown, move: onMove, up: onUp };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
}

/** Remove drag handlers from an element (for switching to edit mode). */
function unmakeDraggable(el) {
    if (!el || !el._dragHandlers) return;
    el.removeEventListener('pointerdown', el._dragHandlers.down);
    el.removeEventListener('pointermove', el._dragHandlers.move);
    el.removeEventListener('pointerup', el._dragHandlers.up);
    el.removeEventListener('pointercancel', el._dragHandlers.up);
    el._dragHandlers = null;
    el.style.touchAction = '';
    el.style.userSelect = '';
    el.classList.remove('dragging');
}

/* ===================== PINCH-TO-ZOOM TEXT =====================
 * Two-finger pinch on the slide canvas scales the title or body font
 * size in real time. The pinch decides which element to target by
 * checking which one contains the touch centroid; if neither, we scale
 * both simultaneously. We attach a single non-passive touchstart on
 * the canvas (idempotent setup) and only intercept when 2+ fingers are
 * present, so single-finger drag still works as before.
 */
const _pinchState = {
    active: false,
    target: null,      // 'title' | 'body' | 'both'
    startDist: 0,
    startTitle: 0,
    startBody: 0,
};

function _touchDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.hypot(dx, dy);
}

function _hitTarget(cx, cy) {
    // Use DOM hit-test rather than reading from the touch event, because the
    // centroid is a synthetic point.
    const titleRect = slideTitle && slideTitle.getBoundingClientRect();
    const bodyRect = slideBody && slideBody.getBoundingClientRect();
    const inside = (r) => r && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    if (inside(titleRect)) return 'title';
    if (inside(bodyRect)) return 'body';
    return 'both';
}

function setupPinchZoom() {
    const canvas = document.getElementById('slide-canvas');
    if (!canvas || canvas._pinchSetup) return;
    canvas._pinchSetup = true;
    canvas.addEventListener('touchstart', (ev) => {
        if (ev.touches.length !== 2) return;
        const [a, b] = [ev.touches[0], ev.touches[1]];
        const cx = (a.clientX + b.clientX) / 2;
        const cy = (a.clientY + b.clientY) / 2;
        _pinchState.active = true;
        _pinchState.target = _hitTarget(cx, cy);
        _pinchState.startDist = _touchDistance(a, b) || 1;
        _pinchState.startTitle = state.settings.titleSize || 44;
        _pinchState.startBody = state.settings.fontSize || 28;
        ev.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchmove', (ev) => {
        if (!_pinchState.active || ev.touches.length < 2) return;
        const [a, b] = [ev.touches[0], ev.touches[1]];
        const dist = _touchDistance(a, b);
        const ratio = dist / _pinchState.startDist;
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        if (_pinchState.target === 'title' || _pinchState.target === 'both') {
            state.settings.titleSize = Math.round(clamp(_pinchState.startTitle * ratio, 14, 180));
            const range = document.getElementById('title-size');
            const val = document.getElementById('title-size-val');
            if (range) range.value = state.settings.titleSize;
            if (val) val.textContent = state.settings.titleSize;
        }
        if (_pinchState.target === 'body' || _pinchState.target === 'both') {
            state.settings.fontSize = Math.round(clamp(_pinchState.startBody * ratio, 10, 120));
            const range = document.getElementById('font-size');
            const val = document.getElementById('font-size-val');
            if (range) range.value = state.settings.fontSize;
            if (val) val.textContent = state.settings.fontSize;
        }
        renderSlide();
        ev.preventDefault();
    }, { passive: false });

    const endPinch = () => { _pinchState.active = false; };
    canvas.addEventListener('touchend', endPinch);
    canvas.addEventListener('touchcancel', endPinch);
}

/* ===================== SLIDE NAVIGATION (animated) =====================
 * Single helper that all next/prev callers (buttons + swipe) go through.
 * On mobile-sized viewports (<=900px) we animate the canvas sliding
 * left/right; on desktop we just re-render instantly.
 */
let _slideAnimBusy = false;
function navigateSlide(direction) {
    if (_slideAnimBusy) return;
    const target = state.currentSlide + direction;
    if (target < 0 || target >= state.slides.length) return;

    const mobile = window.innerWidth <= 900;
    const canvas = slideCanvas;

    if (!mobile || !canvas) {
        saveCurrentSlideEdits();
        state.currentSlide = target;
        renderSlide();
        renderThumbnails();
        return;
    }

    _slideAnimBusy = true;
    const outCls = direction > 0 ? 'slide-out-left' : 'slide-out-right';
    const inCls  = direction > 0 ? 'slide-in-right' : 'slide-in-left';

    canvas.classList.remove('slide-in-left', 'slide-in-right', 'slide-out-left', 'slide-out-right');
    // Force a reflow so re-adding the class restarts the animation
    void canvas.offsetWidth;
    canvas.classList.add(outCls);

    setTimeout(() => {
        saveCurrentSlideEdits();
        state.currentSlide = target;
        renderSlide();
        renderThumbnails();
        canvas.classList.remove(outCls);
        void canvas.offsetWidth;
        canvas.classList.add(inCls);
        setTimeout(() => {
            canvas.classList.remove(inCls);
            _slideAnimBusy = false;
        }, 220);
    }, 170);
}

/* ===================== SWIPE SLIDE NAVIGATION =====================
 * Single-finger horizontal swipe on the canvas-wrapper navigates between
 * slides (left = next, right = prev). Only fires when:
 * - The touch started on canvas/wrapper background (not on a draggable decor)
 * - Horizontal distance > 50px and > vertical distance (no conflict with scroll)
 * - Only one finger was used (two fingers = pinch)
 */
function setupSwipeNavigation() {
    const wrapper = document.querySelector('.canvas-wrapper');
    if (!wrapper || wrapper._swipeSetup) return;
    wrapper._swipeSetup = true;

    let startX = 0, startY = 0, swiping = false;

    wrapper.addEventListener('touchstart', (ev) => {
        if (ev.touches.length !== 1) return;
        // Don't swipe if the user is interacting with a draggable element
        // (decoration, photo slot, card overlay, title, body) or while the
        // editor is in move-mode (because then every touch is a potential
        // drag). Without this guard, dragging a decor on mobile would
        // «swipe» mid-drag and switch to the next slide.
        if (state.settings && state.settings.moveMode) return;
        const t = ev.target;
        if (t.closest && (
            t.closest('.ai-decoration') ||
            t.closest('.decor-el') ||
            t.closest('.ai-card-overlay') ||
            t.closest('.slot-photo') ||
            t.closest('.resize-handle') ||
            t.closest('.drag-handle') ||
            t.id === 'slide-title' ||
            t.id === 'slide-body' ||
            (t.closest('#slide-title')) ||
            (t.closest('#slide-body'))
        )) return;
        startX = ev.touches[0].clientX;
        startY = ev.touches[0].clientY;
        swiping = true;
    }, { passive: true });

    wrapper.addEventListener('touchend', (ev) => {
        if (!swiping) return;
        swiping = false;
        const endX = ev.changedTouches[0].clientX;
        const endY = ev.changedTouches[0].clientY;
        const dx = endX - startX;
        const dy = endY - startY;
        // Must be clearly horizontal and long enough
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
        if (dx < 0) {
            // Swipe left → next slide
            navigateSlide(1);
        } else if (dx > 0) {
            // Swipe right → prev slide
            navigateSlide(-1);
        }
    }, { passive: true });

    wrapper.addEventListener('touchcancel', () => { swiping = false; }, { passive: true });
}

/* ===================== MOBILE BOTTOM TAB BAR =====================
 * On narrow viewports the sidebar / edit-panel are hidden by default
 * and revealed as bottom sheets when the user taps a tab. We:
 *   1) Tag each .sidebar-section with data-mtab="style" (default) or
 *      "decor" depending on what's inside (so CSS can filter)
 *   2) Wire up tab buttons to set body[data-mtab]
 *   3) Wire up the backdrop and tapping the active tab again to close
 */
function setupMobileTabbar() {
    const tabbar = document.getElementById('mobile-tabbar');
    if (!tabbar || tabbar._mtabSetup) return;
    tabbar._mtabSetup = true;

    // Tag sidebar sections so CSS can filter them by tab.
    const sidebar = document.querySelector('.editor-sidebar');
    if (sidebar) {
        sidebar.querySelectorAll('.sidebar-section').forEach(s => {
            if (!s.hasAttribute('data-mtab')) s.setAttribute('data-mtab', 'style');
        });
        const decorSec = sidebar.querySelector('#decor-section');
        if (decorSec) decorSec.setAttribute('data-mtab', 'decor');
        const moveSec = sidebar.querySelector('#move-mode-section');
        if (moveSec) moveSec.setAttribute('data-mtab', 'decor');
    }

    // Re-scale the canvas after the sheet transition completes so the slide
    // shrinks to fit the visible area above the sheet (and grows back when
    // the sheet closes).
    const rescaleAfterSheet = () => {
        // The CSS transition on canvas-wrapper max-height is 0.22s. Re-run
        // scaleCanvas on each animation frame for ~250ms to follow it.
        const start = performance.now();
        const tick = (t) => {
            if (typeof scaleCanvas === 'function') scaleCanvas();
            if (t - start < 260) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    };

    const setActiveTab = (name) => {
        const cur = document.body.getAttribute('data-mtab');
        if (cur === name) {
            // Tapping the active tab again closes the sheet.
            document.body.removeAttribute('data-mtab');
        } else {
            document.body.setAttribute('data-mtab', name);
        }
        tabbar.querySelectorAll('.mobile-tab').forEach(b => {
            b.classList.toggle('active', b.dataset.mtab === document.body.getAttribute('data-mtab'));
        });
        rescaleAfterSheet();
    };

    tabbar.querySelectorAll('.mobile-tab').forEach(btn => {
        btn.addEventListener('click', () => setActiveTab(btn.dataset.mtab));
    });

    const backdrop = document.getElementById('mobile-sheet-backdrop');
    if (backdrop) {
        backdrop.addEventListener('click', () => {
            document.body.removeAttribute('data-mtab');
            tabbar.querySelectorAll('.mobile-tab').forEach(b => b.classList.remove('active'));
            rescaleAfterSheet();
        });
    }

    // Close any open sheet when the viewport grows past mobile width (e.g.,
    // user rotates phone to landscape or resizes desktop window).
    window.addEventListener('resize', () => {
        if (window.innerWidth > 600 && document.body.hasAttribute('data-mtab')) {
            document.body.removeAttribute('data-mtab');
            tabbar.querySelectorAll('.mobile-tab').forEach(b => b.classList.remove('active'));
        }
    });
}

/**
 * Attach 4 corner resize handles to a positioned (% based) element. Each handle,
 * when dragged, updates the element's width/height/left/top in % of canvas and
 * fires opts.onEnd({leftPct, topPct, widthPct, heightPct}) so callers can
 * persist. Handles are removed by removeResizeHandles().
 */
function makeResizable(el, opts = {}) {
    if (!el) return;
    removeResizeHandles(el);
    const corners = [
        { name: 'tl', cursor: 'nwse-resize', x: 0, y: 0 },
        { name: 'tr', cursor: 'nesw-resize', x: 1, y: 0 },
        { name: 'bl', cursor: 'nesw-resize', x: 0, y: 1 },
        { name: 'br', cursor: 'nwse-resize', x: 1, y: 1 },
    ];
    el._resizeHandles = [];
    corners.forEach(c => {
        const h = document.createElement('div');
        h.className = 'resize-handle resize-handle-' + c.name;
        h.style.cssText = `position:absolute;width:14px;height:14px;background:#fff;border:2px solid var(--primary, #6366f1);border-radius:50%;left:${c.x * 100}%;top:${c.y * 100}%;transform:translate(-50%,-50%);cursor:${c.cursor};z-index:5;touch-action:none;user-select:none;`;
        el.appendChild(h);
        el._resizeHandles.push(h);
        let drag = null;
        const onDown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Snapshot pre-resize state so undo restores it.
            if (typeof pushEditHistory === 'function') pushEditHistory('До изменения размера');
            const cr = slideCanvas.getBoundingClientRect();
            const er = el.getBoundingClientRect();
            drag = {
                startX: e.clientX,
                startY: e.clientY,
                startLeftPct: (er.left - cr.left) / cr.width * 100,
                startTopPct: (er.top - cr.top) / cr.height * 100,
                startWPct: er.width / cr.width * 100,
                startHPct: er.height / cr.height * 100,
                cw: cr.width,
                ch: cr.height,
            };
            try { h.setPointerCapture(e.pointerId); } catch (_) {}
            el.classList.add('dragging');
        };
        const onMove = (e) => {
            if (!drag) return;
            const dxPct = (e.clientX - drag.startX) / drag.cw * 100;
            const dyPct = (e.clientY - drag.startY) / drag.ch * 100;
            let leftPct = drag.startLeftPct;
            let topPct = drag.startTopPct;
            let widthPct = drag.startWPct;
            let heightPct = drag.startHPct;
            if (c.x === 0) { leftPct = drag.startLeftPct + dxPct; widthPct = drag.startWPct - dxPct; }
            else { widthPct = drag.startWPct + dxPct; }
            if (c.y === 0) { topPct = drag.startTopPct + dyPct; heightPct = drag.startHPct - dyPct; }
            else { heightPct = drag.startHPct + dyPct; }
            const MIN = 3;
            if (widthPct < MIN) { widthPct = MIN; if (c.x === 0) leftPct = drag.startLeftPct + drag.startWPct - MIN; }
            if (heightPct < MIN) { heightPct = MIN; if (c.y === 0) topPct = drag.startTopPct + drag.startHPct - MIN; }
            el.style.left = leftPct + '%';
            el.style.top = topPct + '%';
            el.style.width = widthPct + '%';
            el.style.height = heightPct + '%';
            el.style.right = 'auto';
            el.style.bottom = 'auto';
        };
        const onUp = (e) => {
            if (!drag) return;
            const cr = slideCanvas.getBoundingClientRect();
            const er = el.getBoundingClientRect();
            const result = {
                leftPct: (er.left - cr.left) / cr.width * 100,
                topPct: (er.top - cr.top) / cr.height * 100,
                widthPct: er.width / cr.width * 100,
                heightPct: er.height / cr.height * 100,
            };
            drag = null;
            el.classList.remove('dragging');
            try { h.releasePointerCapture(e.pointerId); } catch (_) {}
            if (opts.onEnd) opts.onEnd(result);
        };
        h._handlers = { down: onDown, move: onMove, up: onUp };
        h.addEventListener('pointerdown', onDown);
        h.addEventListener('pointermove', onMove);
        h.addEventListener('pointerup', onUp);
        h.addEventListener('pointercancel', onUp);
    });
}

function removeResizeHandles(el) {
    if (!el || !el._resizeHandles) return;
    el._resizeHandles.forEach(h => {
        if (h._handlers) {
            h.removeEventListener('pointerdown', h._handlers.down);
            h.removeEventListener('pointermove', h._handlers.move);
            h.removeEventListener('pointerup', h._handlers.up);
            h.removeEventListener('pointercancel', h._handlers.up);
        }
        h.remove();
    });
    el._resizeHandles = null;
}

/**
 * Shrink the font sizes of titleEl + bodyEl together until the container
 * (their flex parent) no longer overflows. Handles the case where the
 * AI/template defines a tight text region and the user's text would
 * otherwise be clipped. Only active when the container is height-constrained.
 */
function fitTextToRegion(containerEl, titleEl, bodyEl, options = {}) {
    if (!containerEl) return;
    const minTitle = options.minTitle || 16;
    const minBody = options.minBody || 12;
    const step = options.step || 1;
    const computed = getComputedStyle(containerEl);
    if (computed.overflow !== 'hidden' && computed.overflowY !== 'hidden') return;
    let titleSize = parseFloat(titleEl && titleEl.style.fontSize) || 0;
    let bodySize = parseFloat(bodyEl && bodyEl.style.fontSize) || 0;
    let guard = 80;
    const overflows = () => {
        if (containerEl.scrollHeight - containerEl.clientHeight > 1) return true;
        if (titleEl && titleEl.scrollWidth - titleEl.clientWidth > 1) return true;
        return false;
    };
    while (guard-- > 0 && overflows()) {
        let changed = false;
        // Shrink whichever is currently bigger so the two sizes track each other.
        if (titleSize > minTitle && titleSize >= bodySize) {
            titleSize -= step;
            if (titleEl) titleEl.style.fontSize = titleSize + 'px';
            changed = true;
        } else if (bodySize > minBody) {
            bodySize -= step;
            if (bodyEl) bodyEl.style.fontSize = bodySize + 'px';
            changed = true;
        } else if (titleSize > minTitle) {
            titleSize -= step;
            if (titleEl) titleEl.style.fontSize = titleSize + 'px';
            changed = true;
        }
        if (!changed) break;
    }
}

/**
 * Apply a per-element absolute position to slideTitle / slideBody. When pos
 * is set, the element jumps out of the flex layout and is positioned by %
 * coordinates. When null, the element resets to its default flex position.
 */
function applyElementPos(el, pos) {
    if (!el) return;
    // For dragged title/body we want them positioned relative to the slide
    // canvas (so the stored % is canvas-relative). Move the element out of
    // the content area into the slide canvas when positioned, and back when
    // reset.
    const canvas = slideCanvas;
    const contentArea = document.querySelector('.slide-content-area');
    if (pos && pos.leftPct != null && pos.topPct != null) {
        if (canvas && el.parentElement !== canvas) {
            canvas.appendChild(el);
        }
        el.style.position = 'absolute';
        el.style.left = pos.leftPct + '%';
        el.style.top = pos.topPct + '%';
        if (pos.widthPct != null) el.style.width = pos.widthPct + '%';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.zIndex = '3';
        el.style.marginBottom = '0';
    } else {
        // Reset \u2014 ensure the element lives back inside the content area
        if (contentArea && el.parentElement !== contentArea) {
            contentArea.appendChild(el);
        }
        el.style.position = '';
        el.style.left = '';
        el.style.top = '';
        el.style.width = '';
        el.style.right = '';
        el.style.bottom = '';
        el.style.zIndex = '';
        el.style.marginBottom = '';
    }
}

/**
 * Override the geometric properties of a decoration's CSS string with new
 * left/top (and optional width/height). Used when persisting drag results.
 */
function overrideCssGeom(css, { leftPct, topPct, widthPct, heightPct } = {}) {
    let out = css || '';
    const setProp = (prop, val) => {
        const re = new RegExp(prop + ':\\s*[^;]+;?', 'gi');
        out = out.replace(re, '').replace(/;\s*;+/g, ';').replace(/\s{2,}/g, ' ').trim();
        if (val != null) {
            const sep = (out === '' || out.endsWith(';')) ? ' ' : '; ';
            out = out + sep + `${prop}: ${val.toFixed(2)}%;`;
        }
    };
    if (leftPct != null) { setProp('left', leftPct); setProp('right', null); }
    if (topPct != null) { setProp('top', topPct); setProp('bottom', null); }
    if (widthPct != null) setProp('width', widthPct);
    if (heightPct != null) setProp('height', heightPct);
    return out.trim();
}

/* ===================== OVERLAY CSS ===================== */
// Resolves the overlay background CSS for a photo background, honoring
// user-selected `overlayDirection` and falling back to a sensible auto
// behavior based on text position. Intensity comes from `overlayOpacity`.
function resolveOverlayDirection(s, layout, effectivePos) {
    const userDir = s.overlayDirection || 'auto';
    if (userDir !== 'auto') return userDir;
    if (layout && layout.id === 'photo-bottom') return 'bottom';
    if (effectivePos === 'bottom') return 'bottom';
    if (effectivePos === 'top') return 'top';
    return 'full';
}

function buildOverlayCss(s, layout, effectivePos) {
    const baseRgb = s.overlayMode === 'lighten' ? '255,255,255' : '0,0,0';
    const a = Math.max(0, Math.min(1, (s.overlayOpacity || 0) / 100));
    // For gradients we let the peak alpha track the slider but allow it to
    // run a bit hotter than uniform so the gradient remains visible at low
    // slider values.
    const peakA = Math.min(1, a * 1.45 + 0.05);
    const dir = resolveOverlayDirection(s, layout, effectivePos);
    switch (dir) {
        case 'top':
            return `linear-gradient(to bottom, rgba(${baseRgb},${peakA}) 0%, rgba(${baseRgb},${peakA * 0.85}) 35%, rgba(${baseRgb},0) 80%)`;
        case 'bottom':
            return `linear-gradient(to top, rgba(${baseRgb},${peakA}) 0%, rgba(${baseRgb},${peakA * 0.85}) 35%, rgba(${baseRgb},0) 80%)`;
        case 'middle':
            return `linear-gradient(to bottom, rgba(${baseRgb},0) 5%, rgba(${baseRgb},${peakA * 0.85}) 30%, rgba(${baseRgb},${peakA}) 50%, rgba(${baseRgb},${peakA * 0.85}) 70%, rgba(${baseRgb},0) 95%)`;
        case 'full':
        default:
            return `rgba(${baseRgb},${a})`;
    }
}

/* ===================== PER-SLIDE STYLE & BG =====================
 * Each slide can now own its own style overrides (fonts, sizes, alignment,
 * highlight color/style, overlay) and background. state.settings and
 * state.selectedBg behave as a "live view" of whatever slide the user is
 * currently editing — every renderSlide() flushes the live view into the
 * slide on the way out, and loads the next slide's overrides on the way in
 * (only when the active slide actually changed, to avoid clobbering an
 * in-progress slider drag that triggers a re-render). "Применить ко всем"
 * copies the current slide's overrides + bg onto every other slide.
 */
const PER_SLIDE_STYLE_KEYS = [
    'titleFont', 'bodyFont', 'fontSize', 'titleSize',
    'align', 'textPosition',
    'highlightColor', 'highlightStyle',
    'overlayOpacity', 'overlayMode', 'overlayDirection',
    'bgBlur',
];
let _lastRenderedSlideIdx = -1;

function loadCurrentSlideStyleAndBg() {
    const slide = state.slides[state.currentSlide];
    if (!slide) return;
    if (slide.style) {
        PER_SLIDE_STYLE_KEYS.forEach(k => {
            if (slide.style[k] !== undefined) state.settings[k] = slide.style[k];
        });
    }
    if (slide.bg) {
        state.selectedBg = deepClone(slide.bg);
    }
}

function persistStyleToCurrentSlide() {
    const slide = state.slides[state.currentSlide];
    if (!slide) return;
    if (!slide.style) slide.style = {};
    PER_SLIDE_STYLE_KEYS.forEach(k => {
        if (state.settings[k] !== undefined) slide.style[k] = state.settings[k];
    });
    if (state.selectedBg) {
        slide.bg = deepClone(state.selectedBg);
    }
}

function syncStyleControlsToSettings() {
    // Sync sidebar UI controls so they reflect the freshly-loaded slide style.
    const s = state.settings;
    if (titleFontSelect && s.titleFont) titleFontSelect.value = s.titleFont;
    if (bodyFontSelect && s.bodyFont) bodyFontSelect.value = s.bodyFont;
    if (fontSizeRange) {
        fontSizeRange.value = s.fontSize;
        if (fontSizeVal) fontSizeVal.textContent = s.fontSize;
    }
    if (titleSizeRange) {
        titleSizeRange.value = s.titleSize;
        if (titleSizeVal) titleSizeVal.textContent = s.titleSize;
    }
    document.querySelectorAll('.align-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.align === (s.align || 'center'));
    });
    document.querySelectorAll('.text-pos-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.position === s.textPosition);
    });
    const hl = document.getElementById('highlight-color');
    if (hl && s.highlightColor) hl.value = s.highlightColor;
    document.querySelectorAll('.highlight-style-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.style === (s.highlightStyle || 'marker'));
    });
    if (bgOverlayRange) {
        bgOverlayRange.value = s.overlayOpacity;
        if (bgOverlayVal) bgOverlayVal.textContent = s.overlayOpacity + '%';
    }
    if (bgBlurRange) {
        bgBlurRange.value = s.bgBlur || 0;
        if (bgBlurVal) bgBlurVal.textContent = s.bgBlur || 0;
    }
    document.querySelectorAll('.overlay-mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === s.overlayMode);
    });
    document.querySelectorAll('.overlay-dir-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.dir === s.overlayDirection);
    });
    // Show/hide photo controls based on whether the current slide has a photo bg.
    if (photoControls) {
        photoControls.style.display = (state.selectedBg && state.selectedBg.type === 'photo') ? 'flex' : 'none';
    }
}

function applyCurrentStyleToAllSlides() {
    if (!state.slides.length) return;
    if (typeof pushEditHistory === 'function') pushEditHistory('До «Применить ко всем»');
    // Flush the live view into the current slide before broadcasting.
    persistStyleToCurrentSlide();
    const cur = state.slides[state.currentSlide];
    if (!cur) return;
    const styleSnap = cur.style ? { ...cur.style } : {};
    const bgSnap = cur.bg ? deepClone(cur.bg) : null;
    state.slides.forEach((s, i) => {
        if (i === state.currentSlide) return;
        s.style = { ...styleSnap };
        if (bgSnap) s.bg = deepClone(bgSnap);
    });
    renderSlide();
    renderThumbnails();
    showToast('Стиль применён ко всем слайдам');
}

/* ===================== RENDER SLIDE ===================== */
function renderSlide() {
    if (!state.slides.length) return;

    // On slide change, pull that slide's style overrides into the live view.
    // Skip the reload while editing the same slide — otherwise every slider
    // input would snap back to the previously-saved value before the new one
    // is applied.
    if (state.currentSlide !== _lastRenderedSlideIdx) {
        loadCurrentSlideStyleAndBg();
        _lastRenderedSlideIdx = state.currentSlide;
        syncStyleControlsToSettings();
    }

    const slide = state.slides[state.currentSlide];
    const s = state.settings;
    const layout = state.selectedLayout;
    const bg = state.selectedBg;
    const total = state.slides.length;
    const current = state.currentSlide + 1;
    const light = isLightBg(bg);
    const titleColor = light ? '#1a1a2e' : '#ffffff';
    const bodyColor = light ? '#444455' : 'rgba(255,255,255,0.9)';
    const numColor = light ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.5)';
    const authorColor = light ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.6)';

    // Background
    if (bg.type === 'photo') {
        slideCanvas.style.background = s.overlayMode === 'lighten' ? '#fff' : '#000';
        slideBgImage.style.backgroundImage = `url(${bg.value})`;
        slideBgImage.style.display = 'block';
        slideBgImage.style.filter = s.bgBlur ? `blur(${s.bgBlur}px)` : 'none';
        slideBgOverlay.style.display = 'block';
        const effectivePos = s.textPosition || layout.titlePos || 'center';
        slideBgOverlay.style.background = buildOverlayCss(s, layout, effectivePos);
    } else {
        slideCanvas.style.background = bg.value;
        slideBgImage.style.display = 'none';
        slideBgImage.style.filter = 'none';
        slideBgOverlay.style.display = 'none';
    }

    // Layout. The content area is the box that holds title + body. By default
    // it uses flex positioning controlled by the layout's padding + textPosition.
    // If AI detected a textRegion (the empty area inside the template), use that
    // as the content area bounds so text doesn't overlap decorations. If the user
    // has dragged the content area, slide.contentPos overrides everything.
    const contentArea = slideCanvas.querySelector('.slide-content-area');
    const isMoveMode = s.moveMode === true;
    const tr = s.textRegion;

    // Move-mode hint banner: small floating chip above the slide explaining
    // that decorations / text are draggable. Mounted on the canvas wrapper
    // so it doesn't get exported with the slide.
    const oldHint = canvasWrapper && canvasWrapper.querySelector('.move-mode-hint');
    if (oldHint) oldHint.remove();
    if (isMoveMode && canvasWrapper) {
        const hint = document.createElement('div');
        hint.className = 'move-mode-hint';
        hint.textContent = 'Перемещайте элементы: тяните за блок, тяните углы для размера';
        canvasWrapper.appendChild(hint);
    }
    if (slide.contentPos) {
        // User-dragged position
        contentArea.style.cssText = `position:absolute;left:${slide.contentPos.leftPct}%;top:${slide.contentPos.topPct}%;width:${slide.contentPos.widthPct}%;height:${slide.contentPos.heightPct}%;display:flex;flex-direction:column;z-index:2;text-align:${s.align || layout.align};overflow:hidden;`;
    } else if (tr) {
        // AI-detected text region (constrains text to the template's empty area)
        contentArea.style.cssText = `position:absolute;left:${tr.leftPct}%;top:${tr.topPct}%;width:${tr.widthPct}%;height:${tr.heightPct}%;display:flex;flex-direction:column;z-index:2;text-align:${s.align || layout.align};overflow:hidden;`;
    } else {
        contentArea.style.cssText = `flex:1;display:flex;flex-direction:column;position:relative;z-index:2;padding:${layout.padding};text-align:${s.align || layout.align};`;
    }

    const pos = s.textPosition || layout.titlePos || 'center';
    switch (pos) {
        case 'top': contentArea.style.justifyContent = 'flex-start'; break;
        case 'bottom': contentArea.style.justifyContent = 'flex-end'; break;
        default: contentArea.style.justifyContent = 'center'; break;
    }

    // In move mode the content area itself is NOT draggable \u2014 only the title
    // and body inside it are. This way users can drop decorations / photo frames
    // anywhere inside the slide without the content area absorbing clicks meant
    // for the elements behind it.
    if (isMoveMode) {
        // Let pointer events pass through the content area's empty space to
        // decorations underneath. Title and body have explicit pointer-events
        // restored below.
        contentArea.style.pointerEvents = 'none';
    } else {
        unmakeDraggable(contentArea);
        contentArea.style.pointerEvents = '';
        contentArea.style.cursor = '';
        contentArea.style.outline = '';
    }

    // Card overlay
    const existingCard = slideCanvas.querySelector('.slide-card-overlay');
    if (existingCard) existingCard.remove();
    if (layout.id === 'card') {
        const card = document.createElement('div');
        card.className = 'slide-card-overlay';
        const cardBg = bg.type === 'photo' ? 'rgba(255,255,255,0.15)' : (light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)');
        card.style.cssText = `position:absolute;inset:80px 60px;background:${cardBg};border-radius:20px;z-index:1;backdrop-filter:blur(8px);border:1px solid ${light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.15)'};pointer-events:none;`;
        slideCanvas.insertBefore(card, contentArea);
    }

    // Auto font sizing based on text length
    const totalChars = (slide.title || '').length + (slide.body || '').length;
    let autoTitleSize = s.titleSize;
    let autoBodySize = s.fontSize;
    if (totalChars > 300) { autoTitleSize = Math.max(28, s.titleSize - 8); autoBodySize = Math.max(18, s.fontSize - 6); }
    else if (totalChars > 200) { autoTitleSize = Math.max(32, s.titleSize - 4); autoBodySize = Math.max(20, s.fontSize - 3); }
    else if (totalChars < 50) { autoTitleSize = Math.min(60, s.titleSize + 8); autoBodySize = Math.min(36, s.fontSize + 4); }

    // Title (use innerHTML if slide has highlights, else innerText)
    const titleHtml = slide.titleHtml || escapeHtml(slide.title);
    if (slideTitle.innerHTML !== titleHtml) slideTitle.innerHTML = titleHtml;
    slideTitle.style.color = s.titleColorOverride || titleColor;
    slideTitle.style.fontSize = autoTitleSize + 'px';
    slideTitle.style.fontWeight = s.titleWeight || '800';
    slideTitle.style.textAlign = s.align || layout.align;
    slideTitle.style.fontFamily = `'${s.titleFont}', sans-serif`;
    slideTitle.style.lineHeight = '1.2';
    slideTitle.style.marginBottom = '24px';
    slideTitle.style.textTransform = s.titleTransform || 'none';
    slideTitle.style.letterSpacing = s.titleLetterSpacing || '0';
    // Title: own absolute position when user has dragged it
    applyElementPos(slideTitle, slide.titlePos);

    // Body (use innerHTML if slide has highlights, else innerText)
    const bodyHtml = slide.bodyHtml || escapeHtml(slide.body);
    if (slideBody.innerHTML !== bodyHtml) slideBody.innerHTML = bodyHtml;
    slideBody.style.color = s.bodyColorOverride || bodyColor;
    slideBody.style.fontSize = autoBodySize + 'px';
    slideBody.style.fontWeight = s.bodyWeight || '400';
    slideBody.style.textAlign = s.align || layout.align;
    slideBody.style.fontFamily = `'${s.bodyFont}', sans-serif`;
    slideBody.style.lineHeight = s.bodyLineHeight || '1.65';
    slideBody.style.whiteSpace = 'pre-wrap';
    // Body: own absolute position when user has dragged it
    applyElementPos(slideBody, slide.bodyPos);

    // Wire up move-mode dragging for title and body. In edit mode they
    // remain contentEditable; in move mode they snap to a draggable rect.
    //
    // Selection model: in move-mode only ONE element across the slide can be
    // "active" at a time (selectedDecorIdx OR selectedTextEl). The active
    // element gets pointer-events:auto + drag handlers + bright outline +
    // z-index:999 so it's always on top and the only thing that responds to
    // touches. Non-active elements get pointer-events:none so an accidental
    // finger crossover during a drag can't grab a different element. Tap an
    // empty part of the canvas to clear selection — then everything becomes
    // interactive again (and the next tap selects).
    slideTitle.contentEditable = isMoveMode ? 'false' : 'true';
    slideBody.contentEditable = isMoveMode ? 'false' : 'true';
    const hasSelection = state.selectedDecorIdx !== null || state.selectedTextEl !== null;
    const titleIsActive = isMoveMode && (!hasSelection || state.selectedTextEl === 'title');
    const bodyIsActive = isMoveMode && (!hasSelection || state.selectedTextEl === 'body');
    if (isMoveMode) {
        slideTitle.style.pointerEvents = titleIsActive ? 'auto' : 'none';
        slideBody.style.pointerEvents = bodyIsActive ? 'auto' : 'none';
        slideTitle.style.cursor = 'move';
        slideBody.style.cursor = 'move';
        // Faded outline for "tap-to-select" hint; bright outline for selected.
        const titleSelected = state.selectedTextEl === 'title';
        const bodySelected = state.selectedTextEl === 'body';
        slideTitle.style.outline = titleSelected
            ? '2px solid var(--primary, #6366f1)'
            : '2px dashed rgba(99, 102, 241, 0.35)';
        slideBody.style.outline = bodySelected
            ? '2px solid var(--primary, #6366f1)'
            : '2px dashed rgba(99, 102, 241, 0.35)';
        if (titleSelected) slideTitle.style.zIndex = '999';
        else slideTitle.style.zIndex = '';
        if (bodySelected) slideBody.style.zIndex = '999';
        else slideBody.style.zIndex = '';

        // Tap title/body → select that text element (clears any decor selection).
        // Wired to pointerdown (not mousedown) because makeDraggable's
        // pointerdown calls preventDefault() which cancels the synthesized
        // mouse event. Both listeners fire on the same pointerdown.
        slideTitle.onpointerdown = (ev) => {
            if (state.selectedTextEl !== 'title' || state.selectedDecorIdx !== null) {
                state.selectedTextEl = 'title';
                state.selectedDecorIdx = null;
                syncDecorDetailPanel();
                // Block siblings synchronously so the drag-in-this-gesture
                // can't bleed into them, then defer a full re-render until
                // after pointerup so the drag completes cleanly.
                slideCanvas.querySelectorAll('.ai-decoration').forEach(n => {
                    n.style.pointerEvents = 'none';
                    n.style.zIndex = '1';
                    n.classList.remove('decor-selected');
                });
                slideBody.style.pointerEvents = 'none';
                slideTitle.style.pointerEvents = 'auto';
                slideTitle.style.zIndex = '999';
                slideTitle.style.outline = '2px solid var(--primary, #6366f1)';
                document.addEventListener('pointerup', () => {
                    renderSlide();
                    syncDecorDetailPanel();
                }, { once: true });
            }
        };
        slideBody.onpointerdown = (ev) => {
            if (state.selectedTextEl !== 'body' || state.selectedDecorIdx !== null) {
                state.selectedTextEl = 'body';
                state.selectedDecorIdx = null;
                syncDecorDetailPanel();
                slideCanvas.querySelectorAll('.ai-decoration').forEach(n => {
                    n.style.pointerEvents = 'none';
                    n.style.zIndex = '1';
                    n.classList.remove('decor-selected');
                });
                slideTitle.style.pointerEvents = 'none';
                slideBody.style.pointerEvents = 'auto';
                slideBody.style.zIndex = '999';
                slideBody.style.outline = '2px solid var(--primary, #6366f1)';
                document.addEventListener('pointerup', () => {
                    renderSlide();
                    syncDecorDetailPanel();
                }, { once: true });
            }
        };

        if (titleIsActive) {
            makeDraggable(slideTitle, {
                // After the drag finishes, commit the new position in % to
                // slide state AND visually reposition the element via
                // applyElementPos so the user sees the final placement even
                // when no full re-render is queued (e.g. on a second drag
                // after the element is already selected).
                onEnd: (geom) => {
                    slide.titlePos = geom;
                    applyElementPos(slideTitle, geom);
                    renderThumbnails();
                },
            });
        } else {
            unmakeDraggable(slideTitle);
        }
        if (bodyIsActive) {
            makeDraggable(slideBody, {
                onEnd: (geom) => {
                    slide.bodyPos = geom;
                    applyElementPos(slideBody, geom);
                    renderThumbnails();
                },
            });
        } else {
            unmakeDraggable(slideBody);
        }
    } else {
        unmakeDraggable(slideTitle);
        unmakeDraggable(slideBody);
        slideTitle.style.pointerEvents = '';
        slideBody.style.pointerEvents = '';
        slideTitle.style.cursor = 'text';
        slideBody.style.cursor = 'text';
        slideTitle.style.outline = '';
        slideBody.style.outline = '';
        slideTitle.style.zIndex = '';
        slideBody.style.zIndex = '';
        slideTitle.onpointerdown = null;
        slideBody.onpointerdown = null;
    }

    // Photo-bottom layout forces white text
    if (layout.id === 'photo-bottom' && bg.type === 'photo') {
        slideTitle.style.color = s.titleColorOverride || '#ffffff';
        slideBody.style.color = s.bodyColorOverride || 'rgba(255,255,255,0.85)';
    }

    // Decorations from template — moveable & resizable only in move mode.
    // In edit mode they're rendered with pointer-events:none so clicks pass
    // through to the text underneath (no accidental drags).
    const existingDecos = slideCanvas.querySelectorAll('.ai-decoration');
    existingDecos.forEach(el => el.remove());
    const existingSlotPhotos = slideCanvas.querySelectorAll('.template-slot-photo');
    existingSlotPhotos.forEach(el => el.remove());
    if (s.decorations && s.decorations.length > 0) {
        const slotIdx = s.photoSlot ? s.photoSlot.index : -1;
        s.decorations.forEach((deco, i) => {
            const el = document.createElement('div');
            const isSelected = isMoveMode && state.selectedDecorIdx === i;
            // In move-mode, an element is "active" (full pointer events +
            // drag handlers) if (a) nothing is selected yet, or (b) it's the
            // currently selected one. Non-selected siblings get pointer-
            // events:none so a finger drag can't bleed into them.
            const decorIsActive = isMoveMode && (!hasSelection || isSelected);
            el.className = 'ai-decoration' + (decorIsActive ? ' draggable' : '') + (isSelected ? ' decor-selected' : '');
            const pe = (isMoveMode && decorIsActive) ? '' : 'pointer-events:none;';
            const z = isSelected ? 999 : 1;
            el.style.cssText = `position:absolute;z-index:${z};${pe}${buildDecorCss(deco)}`;
            slideCanvas.appendChild(el);
            if (isMoveMode) {
                // Click on any decor — selected or not — sets the selection.
                // We attach this even when pointer-events:none because clicks
                // are blocked anyway then; on un-selected decors (when nothing
                // is selected) the first tap picks this one and the same
                // gesture continues into a drag (makeDraggable below handles
                // the pointerdown that fired this).
                el.addEventListener('pointerdown', (ev) => {
                    if (state.selectedDecorIdx !== i || state.selectedTextEl !== null) {
                        state.selectedDecorIdx = i;
                        state.selectedTextEl = null;
                        syncDecorDetailPanel();
                        // Apply selection visuals synchronously WITHOUT a
                        // full re-render — otherwise we'd replace `el` mid-
                        // gesture and the drag-start that's about to fire on
                        // the same pointerdown would be lost. Defer the
                        // re-render until pointerup so resize handles + the
                        // proper draggable state come back cleanly.
                        slideCanvas.querySelectorAll('.ai-decoration').forEach(n => {
                            if (n !== el) {
                                n.style.pointerEvents = 'none';
                                n.style.zIndex = '1';
                                n.classList.remove('decor-selected');
                            }
                        });
                        slideTitle.style.pointerEvents = 'none';
                        slideBody.style.pointerEvents = 'none';
                        el.classList.add('decor-selected');
                        el.style.zIndex = '999';
                        el.style.pointerEvents = 'auto';
                        document.addEventListener('pointerup', () => {
                            renderSlide();
                            syncDecorDetailPanel();
                        }, { once: true });
                    }
                    ev.stopPropagation();
                });
                if (decorIsActive) {
                    makeDraggable(el, {
                        onEnd: (geom) => {
                            state.settings.decorations[i].css = overrideCssGeom(
                                state.settings.decorations[i].css, geom
                            );
                            if (i === slotIdx && s.slotPhotoSrc) renderSlide();
                            renderThumbnails();
                        },
                    });
                    // Only the SELECTED decor gets resize handles — otherwise
                    // every overlapping decor would show its own 4 corner
                    // handles and the canvas becomes a hit-test mess.
                    if (isSelected) {
                        makeResizable(el, {
                            onEnd: (geom) => {
                                state.settings.decorations[i].css = overrideCssGeom(
                                    state.settings.decorations[i].css, geom
                                );
                                if (i === slotIdx && s.slotPhotoSrc) renderSlide();
                                renderThumbnails();
                            },
                        });
                    }
                }
            }
            // If this is the photo slot and user uploaded a slot photo, render the photo on top
            if (i === slotIdx && s.slotPhotoSrc) {
                const img = document.createElement('img');
                img.className = 'template-slot-photo';
                img.src = s.slotPhotoSrc;
                img.style.cssText = `position:absolute;z-index:1;pointer-events:none;object-fit:cover;${deco.css}`;
                img.style.background = 'transparent';
                slideCanvas.appendChild(img);
            }
        });
    }

    // Card overlay from template — also moveable/resizable in move mode.
    const existingCardOvl = slideCanvas.querySelector('.ai-card-overlay');
    if (existingCardOvl) existingCardOvl.remove();
    if (s.cardOverlay && s.cardOverlay.enabled) {
        const cardEl = document.createElement('div');
        const cardSelected = state.selectedTextEl === 'card';
        const cardActive = isMoveMode && (!hasSelection || cardSelected);
        cardEl.className = 'ai-card-overlay ai-decoration' + (cardActive ? ' draggable' : '') + (cardSelected ? ' decor-selected' : '');
        const cardPe = (isMoveMode && cardActive) ? '' : 'pointer-events:none;';
        const cardZ = cardSelected ? 999 : 1;
        cardEl.style.cssText = `position:absolute;z-index:${cardZ};${cardPe}${s.cardOverlay.css}`;
        slideCanvas.insertBefore(cardEl, contentArea);
        if (isMoveMode) {
            cardEl.addEventListener('pointerdown', (ev) => {
                if (state.selectedTextEl !== 'card' || state.selectedDecorIdx !== null) {
                    state.selectedTextEl = 'card';
                    state.selectedDecorIdx = null;
                    syncDecorDetailPanel();
                    slideCanvas.querySelectorAll('.ai-decoration').forEach(n => {
                        if (n !== cardEl) {
                            n.style.pointerEvents = 'none';
                            n.style.zIndex = '1';
                            n.classList.remove('decor-selected');
                        }
                    });
                    slideTitle.style.pointerEvents = 'none';
                    slideBody.style.pointerEvents = 'none';
                    cardEl.style.pointerEvents = 'auto';
                    cardEl.style.zIndex = '999';
                    cardEl.classList.add('decor-selected');
                    document.addEventListener('pointerup', () => {
                        renderSlide();
                        syncDecorDetailPanel();
                    }, { once: true });
                }
                ev.stopPropagation();
            });
            if (cardActive) {
                makeDraggable(cardEl, {
                    onEnd: (geom) => {
                        state.settings.cardOverlay.css = overrideCssGeom(
                            state.settings.cardOverlay.css, geom
                        );
                        renderThumbnails();
                    },
                });
                if (cardSelected) {
                    makeResizable(cardEl, {
                        onEnd: (geom) => {
                            state.settings.cardOverlay.css = overrideCssGeom(
                                state.settings.cardOverlay.css, geom
                            );
                            renderThumbnails();
                        },
                    });
                }
            }
        }
    }

    // Number
    if (s.showNumber) {
        slideNumber.style.display = 'block';
        slideNumber.textContent = `${current} / ${total}`;
        slideNumber.style.cssText = `display:block;position:absolute;top:40px;right:56px;z-index:3;font-size:20px;font-weight:600;color:${numColor};font-family:'${s.titleFont}',sans-serif;`;
    } else {
        slideNumber.style.display = 'none';
    }

    // Author
    if (s.author) {
        slideAuthor.style.display = 'block';
        slideAuthor.textContent = s.author;
        slideAuthor.style.cssText = `display:block;position:absolute;bottom:36px;left:72px;right:72px;z-index:3;font-size:20px;font-weight:500;color:${authorColor};text-align:${s.align || layout.align};`;
    } else {
        slideAuthor.style.display = 'none';
    }

    // Decoration
    renderDecoration(layout, current, total);

    // Fit-text: if the AI/user-defined textRegion is constrained (overflow:hidden
    // and fixed height), iteratively shrink the title+body font sizes until the
    // text no longer overflows. Must run after the browser has flushed layout
    // so scrollHeight / clientHeight are accurate.
    requestAnimationFrame(() => {
        fitTextToRegion(contentArea, slideTitle, slideBody, {
            minTitle: 16,
            minBody: 12,
        });
    });

    // Counter
    currentSlideNum.textContent = current;
    totalSlidesNum.textContent = total;
    btnPrevSlide.style.visibility = current > 1 ? 'visible' : 'hidden';
    btnNextSlide.style.visibility = current < total ? 'visible' : 'hidden';

    // Sidebar decor-detail panel mirrors the selected decoration.
    if (typeof syncDecorDetailPanel === 'function') syncDecorDetailPanel();

    // Sync edit-panel mirrors. The mirrors show the slide title/body with
    // highlight marks intact and are the user's bigger, calmer surface for
    // selecting text → applying highlights.
    if (typeof syncEditMirrors === 'function') syncEditMirrors();

    // Capture the just-rendered style + bg as this slide's persistent override
    // so that navigating away and back restores it. Runs every frame so any
    // setter that mutated state.settings (slider, font picker, color, etc.)
    // automatically sticks to this slide and only this slide.
    persistStyleToCurrentSlide();
}

/* ===================== DECORATIONS ===================== */
function renderDecoration(layout, current, total) {
    slideDecoration.innerHTML = '';
    slideDecoration.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:1;';
    const bg = state.selectedBg;
    const light = isLightBg(bg);
    const ac = light ? '#6366f1' : 'rgba(255,255,255,0.3)';

    switch (layout.id) {
        case 'quote':
            slideDecoration.innerHTML = `
                <div style="position:absolute;top:80px;left:80px;font-size:200px;line-height:1;font-family:'Playfair Display',serif;color:${ac};opacity:0.25;">\u201C</div>
                <div style="position:absolute;bottom:80px;right:80px;font-size:200px;line-height:1;font-family:'Playfair Display',serif;color:${ac};opacity:0.25;">\u201D</div>
            `;
            break;
        case 'split':
            slideDecoration.innerHTML = `<div style="position:absolute;top:0;left:0;bottom:0;width:10px;background:${light ? '#6366f1' : 'rgba(255,255,255,0.5)'};"></div>`;
            break;
        case 'top':
            slideDecoration.innerHTML = `<div style="position:absolute;top:0;left:0;right:0;height:6px;background:${light ? '#6366f1' : 'rgba(255,255,255,0.4)'};"></div>`;
            break;
    }
}

/* ===================== THUMBNAILS ===================== */
function renderThumbnails() {
    const bg = state.selectedBg;
    const light = isLightBg(bg);
    const titleC = light ? '#1a1a2e' : '#fff';
    const bodyC = light ? '#666' : 'rgba(255,255,255,0.7)';

    thumbnailsStrip.innerHTML = state.slides.map((slide, i) => {
        let bgStyle, overlayHtml = '';
        if (bg.type === 'photo') {
            bgStyle = `background:url(${bg.medium || bg.value}) center/cover;`;
            const thumbLayout = state.selectedLayout || {};
            const thumbPos = state.settings.textPosition || thumbLayout.titlePos || 'center';
            const thumbOvlBg = buildOverlayCss(state.settings, thumbLayout, thumbPos);
            overlayHtml = `<div style="position:absolute;inset:0;background:${thumbOvlBg};z-index:0;"></div>`;
        } else {
            bgStyle = `background:${bg.value};`;
        }

        return `
            <div class="thumbnail ${i === state.currentSlide ? 'active' : ''}" data-index="${i}">
                <div class="thumb-inner" style="${bgStyle} font-family:'${state.settings.titleFont}',sans-serif; position:relative;">
                    ${overlayHtml}
                    <div class="thumb-title" style="color:${bg.type === 'photo' ? '#fff' : titleC};font-weight:800;position:relative;z-index:1;">${escapeHtml(slide.title)}</div>
                    <div class="thumb-text" style="color:${bg.type === 'photo' ? 'rgba(255,255,255,0.7)' : bodyC};position:relative;z-index:1;">${escapeHtml(slide.body)}</div>
                    <div class="thumb-num" style="color:${bg.type === 'photo' ? '#fff' : titleC};opacity:0.3;position:relative;z-index:1;">${i + 1}</div>
                </div>
            </div>
        `;
    }).join('');

    thumbnailsStrip.querySelectorAll('.thumbnail').forEach(th => {
        th.addEventListener('click', () => {
            saveCurrentSlideEdits();
            state.currentSlide = parseInt(th.dataset.index);
            renderSlide();
            renderThumbnails();
        });
    });
}

/* ===================== SAVE EDITS ===================== */
function saveCurrentSlideEdits() {
    if (!state.slides.length) return;
    const slide = state.slides[state.currentSlide];
    const titleText = slideTitle.innerText.trim();
    const bodyText = slideBody.innerText.trim();
    if (titleText) slide.title = titleText;
    if (bodyText || slideBody.innerText === '') slide.body = bodyText;
    // Preserve highlight HTML if marks exist
    if (slideTitle.querySelector('mark')) {
        slide.titleHtml = slideTitle.innerHTML;
    }
    if (slideBody.querySelector('mark')) {
        slide.bodyHtml = slideBody.innerHTML;
    }
}

/* ===================== TEMPLATE ANALYSIS ===================== */
let templateFile = null;

/**
 * Slide canvas reference dimensions (matches .slide-canvas in styles.css).
 * The AI returns decoration coordinates in px assuming this frame.
 * We normalise them to % so decorations scale correctly with any canvas size
 * (mobile, desktop, different aspect ratios).
 */
const CANVAS_REF_W = 1080;
const CANVAS_REF_H = 1350;

function normalizeDecorationCss(css, refW = CANVAS_REF_W, refH = CANVAS_REF_H) {
    if (!css) return css;
    return css
        .replace(/(left|right|width):\s*(-?\d+(?:\.\d+)?)px/gi, (m, prop, val) => {
            return `${prop}: ${(parseFloat(val) / refW * 100).toFixed(2)}%`;
        })
        .replace(/(top|bottom|height):\s*(-?\d+(?:\.\d+)?)px/gi, (m, prop, val) => {
            return `${prop}: ${(parseFloat(val) / refH * 100).toFixed(2)}%`;
        });
}

/**
 * Parse a CSS string for one geometric property, supporting both % and px.
 * For px values, normalises to % against the reference frame.
 */
function parseGeomPct(css, prop, refDim) {
    const pctM = css.match(new RegExp(prop + ':\\s*(-?\\d+(?:\\.\\d+)?)%', 'i'));
    if (pctM) return parseFloat(pctM[1]);
    const pxM = css.match(new RegExp(prop + ':\\s*(-?\\d+(?:\\.\\d+)?)px', 'i'));
    if (pxM) return parseFloat(pxM[1]) / refDim * 100;
    return null;
}

/**
 * Detect a photo slot in the AI-returned decorations. Returns the index and
 * geometry of the largest light-coloured rectangle, which is almost always
 * the placeholder for a photo (frame, polaroid, image card).
 *
 * Decorations look like:
 *   { type: 'rectangle', css: 'position: absolute; top: 13%; left: 9%;
 *                              width: 28%; height: 33%; background: #FFFFFF; ...' }
 */
function detectPhotoSlot(decorations) {
    if (!decorations || decorations.length === 0) return null;
    let best = null;
    let bestArea = 0;
    decorations.forEach((deco, i) => {
        const css = deco.css || '';
        const w = parseGeomPct(css, 'width', CANVAS_REF_W);
        const h = parseGeomPct(css, 'height', CANVAS_REF_H);
        if (w == null || h == null) return;
        const area = w * h; // area as %^2
        // Require at least ~5% × 5% so we ignore tiny stickers / badges
        if (area < 25) return;
        const bgM = css.match(/background(?:-color)?:\s*(#[0-9a-fA-F]{3,8})/);
        const color = bgM ? bgM[1] : null;
        const lum = color ? getLuminance(color) : 1;
        if (lum < 0.7) return;
        if (area > bestArea) {
            bestArea = area;
            best = {
                index: i,
                width: w,
                height: h,
                top: parseGeomPct(css, 'top', CANVAS_REF_H) || 0,
                left: parseGeomPct(css, 'left', CANVAS_REF_W) || 0,
                color,
            };
        }
    });
    return best;
}

/**
 * Compute a default text region (as %) for a slide based on AI's verticalAlign
 * and the bounding box of decorations. This is where the text should live to
 * not overlap with template elements.
 */
function computeTextRegion(decorations, vAlign) {
    if (!decorations || decorations.length === 0) {
        return { leftPct: 6, topPct: 8, widthPct: 88, heightPct: 84 };
    }
    // Compute bounding box of all decorations
    let minLeft = 100, minTop = 100, maxRight = 0, maxBottom = 0;
    decorations.forEach(d => {
        const css = d.css || '';
        const l = parseGeomPct(css, 'left', CANVAS_REF_W);
        const t = parseGeomPct(css, 'top', CANVAS_REF_H);
        const w = parseGeomPct(css, 'width', CANVAS_REF_W);
        const h = parseGeomPct(css, 'height', CANVAS_REF_H);
        if (l == null || t == null || w == null || h == null) return;
        minLeft = Math.min(minLeft, l);
        minTop = Math.min(minTop, t);
        maxRight = Math.max(maxRight, l + w);
        maxBottom = Math.max(maxBottom, t + h);
    });
    // Default fallback if no usable rects
    if (maxBottom === 0) return { leftPct: 6, topPct: 8, widthPct: 88, heightPct: 84 };
    const PAD = 4; // % padding around decoration bbox
    // Place text in the most empty band of the slide
    if (vAlign === 'top') {
        // Decorations occupy the bottom — text on top
        return { leftPct: 6, topPct: 4, widthPct: 88, heightPct: Math.max(20, minTop - PAD) };
    } else if (vAlign === 'bottom') {
        // Decorations on top — text on bottom
        return { leftPct: 6, topPct: Math.min(96 - 20, maxBottom + PAD), widthPct: 88, heightPct: Math.max(20, 100 - (maxBottom + PAD) - 4) };
    } else {
        // Center: pick the larger empty band (top or bottom of decorations)
        const topBand = minTop;
        const bottomBand = 100 - maxBottom;
        if (topBand >= bottomBand) {
            return { leftPct: 6, topPct: 4, widthPct: 88, heightPct: Math.max(20, topBand - PAD) };
        } else {
            return { leftPct: 6, topPct: Math.min(96 - 20, maxBottom + PAD), widthPct: 88, heightPct: Math.max(20, bottomBand - PAD - 4) };
        }
    }
}

function handleTemplateFile(file, previewImg, uploadContent, uploadPreview) {
    templateFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
        previewImg.src = ev.target.result;
        uploadContent.style.display = 'none';
        uploadPreview.style.display = 'flex';
        // Auto-analyze after short delay
        setTimeout(() => {
            analyzeTemplate();
        }, 500);
    };
    reader.readAsDataURL(file);
}

function loadGoogleFont(fontName) {
    if (!fontName || fontName === 'Inter') return;
    const id = 'gfont-' + fontName.replace(/\s+/g, '-');
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@400;500;600;700;800;900&display=swap`;
    document.head.appendChild(link);
}

async function analyzeTemplate() {
    if (!templateFile) return;

    const uploadContent = $('#template-upload-content');
    const preview = $('#template-upload-preview');
    const analyzing = $('#template-analyzing');
    const uploadArea = $('#template-upload-area');

    preview.style.display = 'none';
    analyzing.style.display = 'flex';

    try {
        const imgB64 = await fileToJpegBase64(templateFile);
        const userParts = [
            { text: 'Analyze this template screenshot. Return JSON only.' },
            { inlineData: { mimeType: 'image/jpeg', data: imgB64 } },
        ];
        const style = await callGeminiJson(ANALYZE_PROMPT, userParts);

        // Apply analyzed style to state
        state.templateStyle = style;

        // Apply background
        if (style.background) {
            if (style.background.type === 'solid') {
                state.selectedBg = { type: 'solid', value: style.background.value };
            } else if (style.background.type === 'gradient') {
                state.selectedBg = { type: 'gradient', value: style.background.value };
            } else if (style.background.type === 'image' && style.background.value) {
                // Search Pexels for matching photo
                const query = style.background.value;
                try {
                    const pResp = await fetch(`${PEXELS_BASE}/search?query=${encodeURIComponent(query)}&per_page=1&orientation=portrait`, {
                        headers: { Authorization: PEXELS_API_KEY }
                    });
                    const pData = await pResp.json();
                    if (pData.photos && pData.photos.length > 0) {
                        state.selectedBg = {
                            type: 'photo',
                            value: pData.photos[0].src.large2x,
                            photographer: pData.photos[0].photographer,
                        };
                    }
                } catch (e) {
                    console.warn('Pexels search failed:', e);
                }
            }
        }

        // Apply layout from analysis
        let aiVAlign = 'center';
        if (style.layout) {
            const align = style.layout.textAlign || 'center';
            const vAlign = style.layout.verticalAlign || 'center';
            aiVAlign = vAlign;
            const matchingLayout = LAYOUTS.find(l =>
                (vAlign === 'top' && l.id === 'top') ||
                (vAlign === 'bottom' && l.id === 'bottom') ||
                (vAlign === 'center' && l.id === 'centered')
            ) || LAYOUTS[0];
            state.selectedLayout = matchingLayout;
            if (style.layout.padding) state.selectedLayout = { ...state.selectedLayout, padding: style.layout.padding };
            // Apply AI's understanding of text position/alignment so the editor
            // reflects where the template wants text. The user can still
            // override afterwards via the position/align buttons.
            state.settings.textPosition = vAlign === 'top' ? 'top' : vAlign === 'bottom' ? 'bottom' : 'center';
            state.settings.align = align === 'right' ? 'right' : align === 'left' ? 'left' : 'center';
        }

        // Apply title style
        if (style.titleStyle) {
            if (style.titleStyle.fontSize) state.settings.titleSize = style.titleStyle.fontSize;
            if (style.titleStyle.fontFamily) {
                state.settings.titleFont = style.titleStyle.fontFamily;
                loadGoogleFont(style.titleStyle.fontFamily);
            }
            if (style.titleStyle.textTransform) state.settings.titleTransform = style.titleStyle.textTransform;
            if (style.titleStyle.letterSpacing) state.settings.titleLetterSpacing = style.titleStyle.letterSpacing;
            if (style.titleStyle.fontWeight) state.settings.titleWeight = style.titleStyle.fontWeight;
            if (style.titleStyle.color) state.settings.titleColorOverride = style.titleStyle.color;
        }

        // Apply body style
        if (style.bodyStyle) {
            if (style.bodyStyle.fontSize) state.settings.fontSize = style.bodyStyle.fontSize;
            if (style.bodyStyle.fontFamily) {
                state.settings.bodyFont = style.bodyStyle.fontFamily;
                loadGoogleFont(style.bodyStyle.fontFamily);
            }
            if (style.bodyStyle.fontWeight) state.settings.bodyWeight = style.bodyStyle.fontWeight;
            if (style.bodyStyle.lineHeight) state.settings.bodyLineHeight = style.bodyStyle.lineHeight;
            if (style.bodyStyle.color) state.settings.bodyColorOverride = style.bodyStyle.color;
        }

        // Apply overlay
        if (style.overlay && style.overlay.enabled) {
            state.settings.overlayOpacity = style.overlay.opacity || 40;
        }

        // Store decorations — normalise px coordinates to % so they scale with
        // any canvas size (mobile, desktop, different aspect ratios).
        if (style.decorations) {
            style.decorations = style.decorations.map(d => ({ ...d, css: normalizeDecorationCss(d.css) }));
            state.settings.decorations = style.decorations;
            // Detect a photo slot — the largest light-coloured rectangle (most likely a frame/placeholder)
            state.settings.photoSlot = detectPhotoSlot(style.decorations);
            // Clear any previously uploaded slot photo since the template changed
            state.settings.slotPhotoSrc = null;
        } else {
            state.settings.photoSlot = null;
            state.settings.slotPhotoSrc = null;
        }

        // Compute text region (the empty area inside the template where text
        // should live). Stored as % so it survives any canvas resize.
        state.settings.textRegion = computeTextRegion(
            state.settings.decorations || [],
            aiVAlign,
        );

        // New template applied \u2014 reset any per-slide drag positions so the
        // user sees the fresh template layout. They can still re-drag.
        state.slides.forEach(sl => {
            sl.contentPos = null;
            sl.titlePos = null;
            sl.bodyPos = null;
        });

        // Card overlay
        if (style.cardOverlay && style.cardOverlay.enabled) {
            style.cardOverlay.css = normalizeDecorationCss(style.cardOverlay.css);
            state.settings.cardOverlay = style.cardOverlay;
        }

        // Visual feedback
        uploadArea.classList.add('template-style-applied');
        let badge = uploadArea.querySelector('.template-style-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'template-style-badge';
            uploadArea.appendChild(badge);
        }
        badge.textContent = 'Стиль применён';

        analyzing.style.display = 'none';
        preview.style.display = 'flex';

        // Show detected style summary
        showStyleSummary(style);

        // Update layout cards visual selection
        syncLayoutCards();

        showToast('AI скопировал стиль шаблона!');

        // Enable editor button
        $('#btn-to-editor').disabled = false;

    } catch (err) {
        console.error('Template analysis error:', err);
        showToast('Ошибка анализа: ' + err.message);
        analyzing.style.display = 'none';
        preview.style.display = 'flex';
    }
}

/* ===================== TEXT HIGHLIGHT ===================== */
function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ===================== TEXT SELECTION PERSISTENCE =====================
 * The user often selects text in the slide canvas, then taps a different
 * tab/sheet (Стиль) to apply a highlight. Tapping anywhere outside the
 * contentEditable collapses the live DOM selection. We mirror every valid
 * selection into editorSelection so the highlight controls still know what
 * the user picked even after the selection visually disappears.
 */
const editorSelection = {
    range: null,
    text: '',
    target: null,    // 'title' | 'body'
    slideIdx: -1,
};

function captureEditorSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (r.collapsed) return;
    const inTitle = slideTitle && slideTitle.contains(r.commonAncestorContainer);
    const inBody = slideBody && slideBody.contains(r.commonAncestorContainer);
    if (!inTitle && !inBody) return;
    editorSelection.range = r.cloneRange();
    editorSelection.text = (r.toString() || '').trim();
    editorSelection.target = inTitle ? 'title' : 'body';
    editorSelection.slideIdx = state.currentSlide;
    updateSelectionPreviewBar();
}

function clearEditorSelection() {
    editorSelection.range = null;
    editorSelection.text = '';
    editorSelection.target = null;
    editorSelection.slideIdx = -1;
    updateSelectionPreviewBar();
}

function hasValidEditorSelection() {
    if (!editorSelection.range) return false;
    if (editorSelection.slideIdx !== state.currentSlide) return false;
    const host = editorSelection.target === 'title' ? slideTitle : slideBody;
    if (!host) return false;
    // Range must still point into the live DOM of the host element.
    try {
        const c = editorSelection.range.commonAncestorContainer;
        return host.contains(c);
    } catch (e) {
        return false;
    }
}

function restoreEditorSelectionToDom() {
    if (!hasValidEditorSelection()) return null;
    const sel = window.getSelection();
    if (!sel) return null;
    sel.removeAllRanges();
    try {
        sel.addRange(editorSelection.range);
        return sel.getRangeAt(0);
    } catch (e) {
        return null;
    }
}

function updateSelectionPreviewBar() {
    const bar = document.getElementById('selection-preview-bar');
    if (!bar) return;
    const has = hasValidEditorSelection();
    bar.classList.toggle('has-selection', has);
    if (has) {
        const preview = bar.querySelector('.sel-preview-text');
        if (preview) {
            const t = editorSelection.text || '';
            preview.textContent = t.length > 60 ? t.slice(0, 57) + '…' : t;
        }
    }
}

// Capture every user selection inside slideTitle / slideBody. Use both
// selectionchange (catches keyboard + touch) and pointerup as a fallback.
document.addEventListener('selectionchange', () => {
    captureEditorSelection();
});

function applyHighlight() {
    // Prefer the live selection if user still has one, otherwise fall back to
    // the saved Range (which survives tab/sheet switches that steal focus).
    const sel = window.getSelection();
    let range = null;
    let isInTitle = false;
    let isInBody = false;

    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        const r = sel.getRangeAt(0);
        if (slideTitle.contains(r.commonAncestorContainer) || slideBody.contains(r.commonAncestorContainer)) {
            range = r;
        }
    }
    if (!range && hasValidEditorSelection()) {
        range = restoreEditorSelectionToDom();
    }
    if (!range || range.collapsed) {
        showToast('Сначала выделите текст в заголовке или описании');
        return;
    }
    isInTitle = slideTitle.contains(range.commonAncestorContainer);
    isInBody = slideBody.contains(range.commonAncestorContainer);

    if (!isInTitle && !isInBody) {
        showToast('Выделите текст на слайде');
        return;
    }

    if (typeof pushEditHistory === 'function') pushEditHistory('До выделения текста');
    if (typeof pushHighlightHistory === 'function') pushHighlightHistory('Выделение фрагмента');

    const color = state.settings.highlightColor;
    const styleId = state.settings.highlightStyle || 'marker';
    const mark = document.createElement('mark');
    applyMarkStyle(mark, color, styleId);

    try {
        range.surroundContents(mark);
    } catch (e) {
        // Range crosses element boundaries — wrap selected text manually
        const frag = range.extractContents();
        mark.appendChild(frag);
        range.insertNode(mark);
    }

    if (sel) sel.removeAllRanges();
    clearEditorSelection();

    // Save the highlighted HTML back to state
    const slide = state.slides[state.currentSlide];
    if (isInTitle) {
        slide.titleHtml = slideTitle.innerHTML;
        slide.title = slideTitle.innerText;
    }
    if (isInBody) {
        slide.bodyHtml = slideBody.innerHTML;
        slide.body = slideBody.innerText;
    }

    renderThumbnails();
    if (typeof syncEditMirrors === 'function') syncEditMirrors();
}

function clearHighlights() {
    if (typeof pushHighlightHistory === 'function') pushHighlightHistory('Очистка всех выделений');
    state.slides.forEach(slide => {
        slide.titleHtml = null;
        slide.bodyHtml = null;
    });
    renderSlide();
    renderThumbnails();
    if (typeof syncEditMirrors === 'function') syncEditMirrors();
    showToast('Выделение убрано');
}

/* AI auto-highlight: picks impactful words per slide */
function autoHighlightAllSlides(opts = {}) {
    if (!opts.skipHistory && state.slides && state.slides.length) {
        // Snapshot before re-highlighting so the user can roll back to the
        // previous highlight set (or none at all).
        pushAiHistory('До AI-выделения');
        if (typeof pushHighlightHistory === 'function') pushHighlightHistory('AI-выделение');
    }
    const color = state.settings.highlightColor;
    const styleId = state.settings.highlightStyle || 'marker';
    let highlightedCount = 0;
    state.slides.forEach(slide => {
        if (!slide.title) return;
        const phrase = pickHighlightPhrase(slide.title);
        if (phrase) {
            slide.titleHtml = buildHighlightedHtml(slide.title, phrase, color, styleId);
            highlightedCount++;
        } else {
            // Clear any prior highlight so a too-short title goes back to plain
            slide.titleHtml = null;
        }
    });
    renderSlide();
    renderThumbnails();
    if (typeof syncEditMirrors === 'function') syncEditMirrors();
    if (highlightedCount > 0) {
        // Surface the chosen style/color so the user can immediately tell
        // whether AI used the variant they expected — and switch chips to
        // restyle the result in place if not.
        const styleName = (HIGHLIGHT_STYLES[styleId] || HIGHLIGHT_STYLES.marker).name;
        showToast('AI выделил ключевые фразы в стиле «' + styleName + '»');
    } else {
        showToast('Заголовки слишком короткие для выделения');
    }
}

/**
 * Pick a contiguous 2–3 word phrase to highlight (looks like a real highlighter
 * pen swipe). Returns null when the title is too short / has nothing meaningful
 * to highlight (we'd rather skip than mark a single isolated word).
 */
function pickHighlightPhrase(text) {
    const tokens = tokenizeWithGaps(text);
    const wordIdx = tokens.map((t, i) => t.kind === 'word' ? i : -1).filter(i => i >= 0);
    if (wordIdx.length < 3) return null; // need at least 3 words to pick a 2-word phrase meaningfully

    const STOPWORDS = new Set(['и', 'в', 'на', 'с', 'о', 'а', 'у', 'к', 'из', 'за', 'по', 'от', 'до',
        'ты', 'я', 'мы', 'он', 'она', 'это', 'эту', 'эти', 'этот', 'тот', 'та', 'те', 'для', 'вы',
        'же', 'бы', 'ли', 'но', 'или', 'да', 'нет', 'уж', 'так', 'там', 'тут', 'еще', 'ещё']);
    const NEGATIONS = new Set(['не', 'ни', 'никогда', 'нельзя', 'никто', 'ничего', 'без']);
    const POWER = new Set(['секрет', 'главный', 'важно', 'лучший', 'худший', 'топ', 'ошибка', 'ошибки',
        'правда', 'ложь', 'деньги', 'успех', 'провал', 'рост', 'прорыв', 'факт', 'факты',
        'миф', 'мифы', 'способ', 'способы', 'правило', 'правила', 'привычка', 'привычки',
        'совет', 'советы', 'новый', 'старый', 'первый', 'последний', 'единственный',
        'всегда', 'каждый', 'бесплатно', 'быстро', 'просто', 'сложно', 'идеальный',
        'мощный', 'крутой', 'реальный', 'точно', 'срочно', 'сейчас', 'стоп', 'внимание',
        'книга', 'книгу', 'инсайт', 'инсайты', 'хак', 'хаки', 'тренд', 'тренды']);
    const QUESTION = new Set(['почему', 'зачем', 'как', 'когда', 'кто', 'что', 'сколько', 'какой']);

    const score = (tokenIdx) => {
        const t = tokens[tokenIdx];
        const lower = t.value.toLowerCase();
        let s = 0;
        if (/^\d+/.test(t.value)) s += 5;
        if (NEGATIONS.has(lower)) s += 5;
        if (POWER.has(lower)) s += 4;
        if (QUESTION.has(lower)) s += 3;
        if (t.value.length >= 6) s += 1;
        if (STOPWORDS.has(lower)) s = -2;
        return s;
    };

    // Score every possible 2- or 3-word contiguous run.
    const candidates = [];
    for (let start = 0; start < wordIdx.length; start++) {
        for (let len = 2; len <= 3 && start + len <= wordIdx.length; len++) {
            const idxs = wordIdx.slice(start, start + len);
            let sum = 0;
            for (const i of idxs) sum += score(i);
            // Bonus for spanning 2-3 important words rather than just one.
            const nonStop = idxs.filter(i => !STOPWORDS.has(tokens[i].value.toLowerCase())).length;
            if (nonStop < 2) continue; // require 2+ real words
            sum += nonStop; // small bias toward fuller phrases
            candidates.push({ startTok: idxs[0], endTok: idxs[idxs.length - 1], sum });
        }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.sum - a.sum);
    const best = candidates[0];
    if (best.sum <= 0) return null;
    return { startTok: best.startTok, endTok: best.endTok };
}

/** Tokenize text into words and non-word gaps so we can wrap a contiguous range. */
function tokenizeWithGaps(text) {
    const out = [];
    const re = /[\p{L}\p{N}]+/gu;
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) out.push({ kind: 'gap', value: text.slice(last, m.index) });
        out.push({ kind: 'word', value: m[0] });
        last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ kind: 'gap', value: text.slice(last) });
    return out;
}

function buildHighlightedHtml(text, phrase, color, styleId) {
    const tokens = tokenizeWithGaps(text);
    const styleAttr = markStyleAttr(color, styleId);
    let html = '';
    let inMark = false;
    for (let i = 0; i < tokens.length; i++) {
        if (!inMark && i === phrase.startTok) {
            html += `<mark style="${styleAttr}">`;
            inMark = true;
        }
        html += escapeHtml(tokens[i].value);
        if (inMark && i === phrase.endTok) {
            html += '</mark>';
            inMark = false;
        }
    }
    if (inMark) html += '</mark>';
    return html;
}

/** Catalog of selectable highlight styles. Each builds the inline CSS that
 * is stamped on every <mark> tag. */
const HIGHLIGHT_STYLES = {
    marker: {
        name: 'Маркер',
        css: (c) => `background: linear-gradient(180deg, transparent 55%, ${c} 55%); padding: 0 0.1em; border-radius: 0; color: inherit; -webkit-box-decoration-break: clone; box-decoration-break: clone;`,
    },
    'marker-tall': {
        name: 'Жирный маркер',
        css: (c) => `background: linear-gradient(180deg, transparent 25%, ${c} 25%); padding: 0 0.15em; border-radius: 2px; color: inherit; -webkit-box-decoration-break: clone; box-decoration-break: clone;`,
    },
    pill: {
        name: 'Заливка',
        css: (c) => `background: ${c}; padding: 0.05em 0.35em; border-radius: 0.35em; color: ${pickReadableTextColor(c)}; font-weight: 700; -webkit-box-decoration-break: clone; box-decoration-break: clone;`,
    },
    underline: {
        name: 'Подчёркивание',
        css: (c) => `background: transparent; box-shadow: inset 0 -0.15em 0 ${c}; padding: 0 0.05em; color: inherit; -webkit-box-decoration-break: clone; box-decoration-break: clone;`,
    },
    'underline-thick': {
        name: 'Жирное подчёркивание',
        css: (c) => `background: transparent; box-shadow: inset 0 -0.32em 0 ${c}; padding: 0 0.1em; color: inherit; -webkit-box-decoration-break: clone; box-decoration-break: clone;`,
    },
    glow: {
        name: 'Свечение',
        css: (c) => `background: transparent; color: ${c}; text-shadow: 0 0 12px ${c}, 0 0 4px ${c}; font-weight: 700;`,
    },
    accent: {
        name: 'Акцент',
        css: (c) => `background: transparent; color: ${c}; font-weight: 800;`,
    },
};

/** Black or white text for a given background color (WCAG contrast). */
function pickReadableTextColor(bgHex) {
    const h = (bgHex || '#FBBF24').replace('#', '');
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 0.55 ? '#1a1a2e' : '#ffffff';
}

/** Inline style for highlight <mark> tags. styleId picks an entry from
 * HIGHLIGHT_STYLES; falls back to 'marker'. */
function markStyleAttr(color, styleId) {
    const safe = color || '#FBBF24';
    const def = HIGHLIGHT_STYLES[styleId] || HIGHLIGHT_STYLES.marker;
    return def.css(safe);
}
function applyMarkStyle(markEl, color, styleId) {
    markEl.setAttribute('style', markStyleAttr(color, styleId));
}

/** Re-stamp the current highlight style+color onto every existing <mark> in
 * all slides' titleHtml/bodyHtml so already-highlighted text updates when
 * the user changes style/color. */
function restyleAllHighlights() {
    const color = state.settings.highlightColor;
    const styleId = state.settings.highlightStyle || 'marker';
    const newAttr = markStyleAttr(color, styleId);
    const rewrite = (html) => {
        if (!html || !html.includes('<mark')) return html;
        return html.replace(/<mark\b[^>]*>/gi, `<mark style="${newAttr}">`);
    };
    state.slides.forEach(slide => {
        slide.titleHtml = rewrite(slide.titleHtml);
        slide.bodyHtml = rewrite(slide.bodyHtml);
    });
    renderSlide();
    renderThumbnails();
}

/* ===================== DECORATION MODS =====================
 * Per-decoration tweaks (opacity / outline-only) are stored in deco.mods
 * alongside the base css string. We apply them by post-processing the css
 * at render time rather than mutating the base — that way the user can
 * toggle outline-only on and off without losing the original fill color.
 */

/** Pull the first concrete color out of a CSS string. Used as the default
 * outline color when the user enables outline-only on a colored decor. */
function extractFirstColor(css) {
    if (!css) return null;
    // Hex
    const hex = css.match(/#[0-9a-fA-F]{3,8}\b/);
    if (hex) return hex[0];
    // rgba/rgb
    const rgb = css.match(/rgba?\([^)]+\)/);
    if (rgb) return rgb[0];
    // Named-ish via "color: word" inside gradient
    return null;
}

/** Build the final cssText for a decoration, applying its mods on top of
 * its base css. Returns a fragment ready to drop into el.style.cssText. */
function buildDecorCss(deco) {
    let css = deco.css || '';
    const mods = deco.mods || {};
    // Strip any pre-existing opacity declaration so ours wins predictably.
    if (typeof mods.opacity === 'number' && mods.opacity < 1) {
        css = css.replace(/(?:^|;)\s*opacity\s*:\s*[^;]+;?/g, ';');
        css += `;opacity:${mods.opacity}`;
    }
    if (mods.outlineOnly) {
        const color = mods.outlineColor || extractFirstColor(deco.css) || '#1a1a2e';
        const width = mods.outlineWidth || 3;
        // Kill any background fill / shadow so the outline truly shows the
        // background through it.
        css = css.replace(/(?:^|;)\s*background(?:-color|-image)?\s*:\s*[^;]+;?/g, ';');
        css = css.replace(/(?:^|;)\s*box-shadow\s*:\s*[^;]+;?/g, ';');
        css += `;background:transparent;border:${width}px solid ${color}`;
    }
    return css;
}

/** Clear per-slide drag overrides (titlePos/bodyPos/contentPos) on all
 * slides. Called when the user picks a layout/position preset so the preset
 * actually takes effect on previously-dragged text. */
function resetAllDraggedPositions() {
    state.slides.forEach(s => {
        s.titlePos = null;
        s.bodyPos = null;
        s.contentPos = null;
    });
}

/** Sync the sidebar's per-decoration controls panel with the currently
 * selected decoration. Hides the panel when nothing is selected. */
function syncDecorDetailPanel() {
    const panel = document.getElementById('decor-detail');
    if (!panel) return;
    const idx = state.selectedDecorIdx;
    const decos = state.settings.decorations;
    const deco = (idx !== null && decos && decos[idx]) ? decos[idx] : null;
    if (!deco) {
        panel.hidden = true;
        return;
    }
    panel.hidden = false;
    if (!deco.mods) deco.mods = {};
    const opacityInput = document.getElementById('decor-opacity');
    const opacityVal = document.getElementById('decor-opacity-val');
    const outlineToggle = document.getElementById('decor-outline-only');
    const outlineWidth = document.getElementById('decor-outline-width');
    const outlineWidthVal = document.getElementById('decor-outline-width-val');
    const outlineColor = document.getElementById('decor-outline-color');
    const outlineControls = document.getElementById('decor-outline-controls');
    const outlineColorRow = document.getElementById('decor-outline-color-row');
    const op = typeof deco.mods.opacity === 'number' ? Math.round(deco.mods.opacity * 100) : 100;
    if (opacityInput) opacityInput.value = op;
    if (opacityVal) opacityVal.textContent = `${op}%`;
    const outlineOn = !!deco.mods.outlineOnly;
    if (outlineToggle) outlineToggle.checked = outlineOn;
    if (outlineControls) outlineControls.hidden = !outlineOn;
    if (outlineColorRow) outlineColorRow.hidden = !outlineOn;
    const w = deco.mods.outlineWidth || 3;
    if (outlineWidth) outlineWidth.value = w;
    if (outlineWidthVal) outlineWidthVal.textContent = `${w}px`;
    const c = deco.mods.outlineColor || extractFirstColor(deco.css) || '#1a1a2e';
    // <input type=color> only accepts hex; coerce rgb(...) to hex roughly.
    if (outlineColor) outlineColor.value = /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#1a1a2e';
}

/** Apply a partial mods patch to the currently-selected decoration, then
 * re-render. Centralizes the "did the user change a slider" path. */
function patchSelectedDecorMods(patch) {
    const idx = state.selectedDecorIdx;
    const decos = state.settings.decorations;
    if (idx === null || !decos || !decos[idx]) return;
    if (!decos[idx].mods) decos[idx].mods = {};
    Object.assign(decos[idx].mods, patch);
    renderSlide();
    renderThumbnails();
    syncDecorDetailPanel();
}

/* ===================== STYLE SUMMARY ===================== */
function showStyleSummary(style) {
    let panel = $('#style-summary-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'style-summary-panel';
        panel.className = 'style-summary-panel';
        const uploadSection = $('#template-upload-section');
        if (uploadSection) {
            uploadSection.parentNode.insertBefore(panel, uploadSection.nextSibling);
        }
    }
    panel.style.display = 'block';

    const items = [];

    if (style.background) {
        const bgType = style.background.type;
        let bgPreview = '';
        if (bgType === 'solid') {
            bgPreview = `<span class="ss-color-swatch" style="background:${style.background.value}"></span> ${style.background.value}`;
        } else if (bgType === 'gradient') {
            bgPreview = `<span class="ss-color-swatch" style="background:${style.background.value}"></span> Градиент`;
        } else {
            bgPreview = `Фото: ${style.background.value || 'авто'}`;
        }
        items.push(`<div class="ss-item"><span class="ss-label">Фон</span><span class="ss-value">${bgPreview}</span></div>`);
    }

    if (style.titleStyle) {
        const ts = style.titleStyle;
        items.push(`<div class="ss-item"><span class="ss-label">Заголовок</span><span class="ss-value">${ts.fontFamily || 'Inter'}, ${ts.fontSize || 44}px, ${ts.fontWeight || '800'}</span></div>`);
        if (ts.color) {
            items.push(`<div class="ss-item"><span class="ss-label">Цвет заголовка</span><span class="ss-value"><span class="ss-color-swatch" style="background:${ts.color}"></span> ${ts.color}</span></div>`);
        }
    }

    if (style.bodyStyle) {
        const bs = style.bodyStyle;
        items.push(`<div class="ss-item"><span class="ss-label">Текст</span><span class="ss-value">${bs.fontFamily || 'Inter'}, ${bs.fontSize || 28}px</span></div>`);
        if (bs.color) {
            items.push(`<div class="ss-item"><span class="ss-label">Цвет текста</span><span class="ss-value"><span class="ss-color-swatch" style="background:${bs.color}"></span> ${bs.color}</span></div>`);
        }
    }

    if (style.layout) {
        const la = style.layout;
        items.push(`<div class="ss-item"><span class="ss-label">Макет</span><span class="ss-value">${la.verticalAlign || 'center'}, ${la.textAlign || 'center'}</span></div>`);
    }

    if (style.decorations && style.decorations.length > 0) {
        items.push(`<div class="ss-item"><span class="ss-label">Декор</span><span class="ss-value">${style.decorations.length} элемент(ов)</span></div>`);
    }

    panel.innerHTML = `
        <div class="ss-header">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11 6.5 7.5 3 6l3.5-1.5L8 1z" stroke="#7c3aed" stroke-width="1.2" stroke-linejoin="round" fill="#7c3aed" opacity="0.3"/></svg>
            <span>Обнаруженный стиль</span>
        </div>
        <div class="ss-grid">${items.join('')}</div>
    `;
}

function hideStyleSummary() {
    const panel = $('#style-summary-panel');
    if (panel) panel.style.display = 'none';
}

/* ===================== SYNC SIDEBAR CONTROLS ===================== */
function syncSidebarWithState() {
    const s = state.settings;

    // Sync font selects
    if (titleFontSelect) {
        addFontOptionIfMissing(titleFontSelect, s.titleFont);
        titleFontSelect.value = s.titleFont;
    }
    if (bodyFontSelect) {
        addFontOptionIfMissing(bodyFontSelect, s.bodyFont);
        bodyFontSelect.value = s.bodyFont;
    }

    // Sync range sliders
    if (fontSizeRange) {
        fontSizeRange.value = s.fontSize;
        fontSizeVal.textContent = s.fontSize;
    }
    if (titleSizeRange) {
        titleSizeRange.value = s.titleSize;
        titleSizeVal.textContent = s.titleSize;
    }

    // Sync overlay
    if (bgOverlayRange) {
        bgOverlayRange.value = s.overlayOpacity;
        bgOverlayVal.textContent = s.overlayOpacity + '%';
    }
    if (bgBlurRange) {
        bgBlurRange.value = s.bgBlur;
        bgBlurVal.textContent = s.bgBlur;
    }
    $$('.overlay-mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === s.overlayMode);
    });
    $$('.overlay-dir-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.dir === (s.overlayDirection || 'auto'));
    });

    // Sync alignment
    const activeAlign = s.align || state.selectedLayout.align;
    $$('.align-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.align === activeAlign);
    });

    // Sync text position
    const activePos = s.textPosition || state.selectedLayout.titlePos || 'center';
    $$('.position-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.position === activePos);
    });

    // Update color pickers
    const titleColorPicker = $('#title-color-picker');
    const bodyColorPicker = $('#body-color-picker');
    if (titleColorPicker && s.titleColorOverride) titleColorPicker.value = s.titleColorOverride;
    if (bodyColorPicker && s.bodyColorOverride) bodyColorPicker.value = s.bodyColorOverride;

    // Show/hide template photo slot section
    const slotSection = $('#template-slot-section');
    const slotPhotoControls = $('#slot-photo-controls');
    if (slotSection) {
        if (s.photoSlot) {
            slotSection.style.display = 'block';
            if (slotPhotoControls) slotPhotoControls.style.display = s.slotPhotoSrc ? 'flex' : 'none';
        } else {
            slotSection.style.display = 'none';
        }
    }
}

function addFontOptionIfMissing(selectEl, fontName) {
    if (!fontName) return;
    const exists = Array.from(selectEl.options).some(o => o.value === fontName);
    if (!exists) {
        const opt = document.createElement('option');
        opt.value = fontName;
        opt.textContent = fontName;
        selectEl.appendChild(opt);
    }
}

function syncLayoutCards() {
    $$('.layout-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.layout === state.selectedLayout.id);
    });
}

/* ===================== UNIVERSAL EDIT HISTORY =====================
 * Every meaningful user mutation (drag, resize, decor add/remove/modify,
 * layout/position change, color/font/background swap, etc.) snapshots
 * the relevant portion of state so the user can press «Назад» (Ctrl+Z
 * on desktop) and step backwards. Independent of AI history so each
 * operates on its own button.
 */
const EDIT_HISTORY_LIMIT = 50;

/* Deep-clone a value via JSON. Used for snapshotting slides/settings into
 * history so future mutations don't leak back into historical entries. */
function deepClone(v) {
    try { return JSON.parse(JSON.stringify(v)); }
    catch { return v; }
}

/* Build a snapshot of everything that user actions can mutate so undo
 * can fully restore. Cheap-ish because most fields are small. */
function snapshotEditState() {
    return {
        slides: deepClone(state.slides),
        settings: deepClone(state.settings),
        currentSlide: state.currentSlide,
        selectedLayout: deepClone(state.selectedLayout),
        selectedBg: deepClone(state.selectedBg),
        selectedDecorIdx: state.selectedDecorIdx,
        selectedTextEl: state.selectedTextEl,
    };
}

/* Push a snapshot onto editHistory. Callers do this BEFORE applying a
 * mutation so undo restores the pre-mutation state. */
let _editHistoryDebouncing = null;
function pushEditHistory(label) {
    if (!state.editHistory) state.editHistory = [];
    // Drop the oldest entries past the limit so memory is bounded.
    state.editHistory.push({
        label: label || 'Действие',
        snap: snapshotEditState(),
        timestamp: Date.now(),
    });
    if (state.editHistory.length > EDIT_HISTORY_LIMIT) {
        state.editHistory.splice(0, state.editHistory.length - EDIT_HISTORY_LIMIT);
    }
    updateUndoUi();
}

/* Debounced version for frequent events (text input, slider drag).
 * Coalesces a burst of changes into one history entry. */
function pushEditHistoryDebounced(label, delay = 500) {
    if (_editHistoryDebouncing) clearTimeout(_editHistoryDebouncing);
    // Take the snapshot NOW (pre-mutation state) so the first keystroke
    // is what we'd return to, not the last.
    const snap = snapshotEditState();
    _editHistoryDebouncing = setTimeout(() => {
        if (!state.editHistory) state.editHistory = [];
        state.editHistory.push({
            label: label || 'Действие',
            snap: snap,
            timestamp: Date.now(),
        });
        if (state.editHistory.length > EDIT_HISTORY_LIMIT) {
            state.editHistory.splice(0, state.editHistory.length - EDIT_HISTORY_LIMIT);
        }
        _editHistoryDebouncing = null;
        updateUndoUi();
    }, delay);
}

/* Undo the most recent action by restoring its snapshot. */
function undoLastEdit() {
    if (!state.editHistory || state.editHistory.length === 0) return;
    const entry = state.editHistory.pop();
    const s = entry.snap;
    state.slides = s.slides;
    state.settings = s.settings;
    state.currentSlide = Math.min(s.currentSlide, state.slides.length - 1);
    if (state.currentSlide < 0) state.currentSlide = 0;
    state.selectedLayout = s.selectedLayout;
    state.selectedBg = s.selectedBg;
    state.selectedDecorIdx = s.selectedDecorIdx;
    state.selectedTextEl = s.selectedTextEl != null ? s.selectedTextEl : null;
    // Force renderSlide to reload per-slide style from the restored slide.
    _lastRenderedSlideIdx = -1;
    renderSlide();
    renderThumbnails();
    if (typeof syncDecorDetailPanel === 'function') syncDecorDetailPanel();
    if (typeof syncSidebarWithState === 'function') syncSidebarWithState();
    updateUndoUi();
    showToast(`Откатил: ${entry.label}`);
}

/* Refresh undo button visibility + counter badge. */
function updateUndoUi() {
    const n = state.editHistory ? state.editHistory.length : 0;
    const btn = document.getElementById('btn-undo');
    const cnt = document.getElementById('undo-count');
    if (btn) btn.hidden = n === 0;
    if (cnt) cnt.textContent = n > 0 ? String(n) : '';
}

/* ===================== HIGHLIGHT HISTORY =====================
 * A focused undo stack just for highlight operations (applyHighlight,
 * autoHighlightAllSlides, _toggleMarkAtPoint, clearHighlights). Drives
 * the «Назад» button next to the highlight controls so the user can step
 * back through their highlights one by one without disturbing the global
 * editHistory or AI history. Snapshots only the per-slide title/body HTML
 * since highlights are purely an HTML-string mutation.
 */
const HIGHLIGHT_HISTORY_LIMIT = 50;
function pushHighlightHistory(label) {
    if (!state.highlightHistory) state.highlightHistory = [];
    state.highlightHistory.push({
        label: label || 'Выделение',
        slides: state.slides.map(s => ({
            titleHtml: s.titleHtml || null,
            bodyHtml: s.bodyHtml || null,
            title: s.title,
            body: s.body,
        })),
    });
    if (state.highlightHistory.length > HIGHLIGHT_HISTORY_LIMIT) {
        state.highlightHistory.splice(0, state.highlightHistory.length - HIGHLIGHT_HISTORY_LIMIT);
    }
    updateHighlightUndoUi();
}

function undoLastHighlight() {
    if (!state.highlightHistory || state.highlightHistory.length === 0) return;
    const entry = state.highlightHistory.pop();
    entry.slides.forEach((snap, i) => {
        if (!state.slides[i]) return;
        state.slides[i].titleHtml = snap.titleHtml;
        state.slides[i].bodyHtml = snap.bodyHtml;
        // Keep .title/.body in sync when present in the snapshot so an
        // undone _toggleMarkAtPoint also rolls back any innerText drift.
        if (snap.title != null) state.slides[i].title = snap.title;
        if (snap.body != null) state.slides[i].body = snap.body;
    });
    renderSlide();
    renderThumbnails();
    if (typeof syncEditMirrors === 'function') syncEditMirrors();
    updateHighlightUndoUi();
    showToast('Отменил: ' + entry.label);
}

function updateHighlightUndoUi() {
    const btn = document.getElementById('btn-undo-highlight');
    if (!btn) return;
    const n = state.highlightHistory ? state.highlightHistory.length : 0;
    btn.disabled = n === 0;
    btn.title = n > 0
        ? 'Отменить последнее выделение (' + n + ')'
        : 'Нет действий для отмены';
}

/* ===================== AI HISTORY =====================
 * Every AI mutation (split, format, auto-highlight) snapshots the
 * pre-mutation state.slides into state.aiHistory so the user can roll
 * back any one of them. History is capped to keep memory bounded.
 */
const AI_HISTORY_LIMIT = 12;

/** Deep-clone the slide array so future mutations don't bleed back into
 * historical entries. Slides are plain JSON-able objects. */
function cloneSlidesForHistory(slides) {
    try { return JSON.parse(JSON.stringify(slides)); }
    catch { return slides.map(s => ({ ...s })); }
}

/** Push a snapshot of the current slides onto the history stack with a
 * human-readable label. Caller does this before applying an AI mutation. */
function pushAiHistory(label) {
    if (!state.aiHistory) state.aiHistory = [];
    state.aiHistory.push({
        label: label || 'AI-изменение',
        slides: cloneSlidesForHistory(state.slides),
        timestamp: Date.now(),
    });
    if (state.aiHistory.length > AI_HISTORY_LIMIT) {
        state.aiHistory.splice(0, state.aiHistory.length - AI_HISTORY_LIMIT);
    }
    updateAiHistoryUi();
}

/** Restore slides to a snapshot. After restoring we also push the
 * pre-restore state onto history so the user can redo. */
function restoreAiHistory(idx) {
    if (!state.aiHistory || !state.aiHistory[idx]) return;
    const snapshot = state.aiHistory[idx];
    // Capture current state as a fresh "до отката" entry so the user can
    // bounce between variants.
    pushAiHistory('Текущая редакция');
    state.slides = cloneSlidesForHistory(snapshot.slides);
    if (state.currentSlide >= state.slides.length) state.currentSlide = 0;
    _lastRenderedSlideIdx = -1;
    renderSlide();
    renderThumbnails();
    showToast(`Возвращено: ${snapshot.label}`);
    updateAiHistoryUi();
}

/** Undo just the most recent AI mutation. */
function undoLastAiMutation() {
    if (!state.aiHistory || state.aiHistory.length === 0) return;
    const snapshot = state.aiHistory.pop();
    state.slides = cloneSlidesForHistory(snapshot.slides);
    if (state.currentSlide >= state.slides.length) state.currentSlide = 0;
    _lastRenderedSlideIdx = -1;
    renderSlide();
    renderThumbnails();
    showToast(`Откат: ${snapshot.label}`);
    updateAiHistoryUi();
}

/** Refresh the visibility / count of the toolbar buttons and, if open,
 * the history modal list. */
function updateAiHistoryUi() {
    const n = state.aiHistory ? state.aiHistory.length : 0;
    const undoBtn = document.getElementById('btn-ai-undo');
    const histBtn = document.getElementById('btn-ai-history');
    const cnt = document.getElementById('ai-undo-count');
    if (undoBtn) undoBtn.hidden = n === 0;
    if (histBtn) histBtn.hidden = n === 0;
    if (cnt) cnt.textContent = n > 0 ? String(n) : '';
    const list = document.getElementById('ai-history-list');
    const modal = document.getElementById('ai-history-modal');
    if (list && modal && !modal.hidden) renderAiHistoryList();
}

function renderAiHistoryList() {
    const list = document.getElementById('ai-history-list');
    if (!list) return;
    const items = (state.aiHistory || []).slice().reverse();
    if (items.length === 0) {
        list.innerHTML = '<div class="ai-history-empty">История пуста — сделайте AI-форматирование или AI-выделение, чтобы появились варианты.</div>';
        return;
    }
    list.innerHTML = items.map((it, revIdx) => {
        const realIdx = state.aiHistory.length - 1 - revIdx;
        const ageMs = Date.now() - it.timestamp;
        const ageStr = ageMs < 60_000 ? 'только что'
            : ageMs < 3600_000 ? `${Math.round(ageMs/60_000)} мин назад`
            : `${Math.round(ageMs/3600_000)} ч назад`;
        const firstTitle = it.slides[0]?.title || '(пусто)';
        return `
            <div class="ai-history-item" data-idx="${realIdx}">
                <div>
                    <div class="ai-history-item-label">${escapeHtml(it.label)}</div>
                    <div class="ai-history-item-time">${ageStr} · ${it.slides.length} слайд(ов)</div>
                    <div class="ai-history-item-preview">${escapeHtml(firstTitle)}</div>
                </div>
                <div class="ai-history-item-action">Вернуть</div>
            </div>`;
    }).join('');
    list.querySelectorAll('.ai-history-item').forEach(el => {
        el.addEventListener('click', () => {
            const idx = parseInt(el.dataset.idx, 10);
            restoreAiHistory(idx);
            closeAiHistoryModal();
        });
    });
}

function openAiHistoryModal() {
    const modal = document.getElementById('ai-history-modal');
    if (!modal) return;
    modal.hidden = false;
    renderAiHistoryList();
}
function closeAiHistoryModal() {
    const modal = document.getElementById('ai-history-modal');
    if (!modal) return;
    modal.hidden = true;
}

/* ===================== AI FORMATTING ===================== */
async function aiFormatSlides() {
    if (!state.slides.length) return;
    saveCurrentSlideEdits();

    const btnAi = $('#btn-ai-format');
    const origText = btnAi.innerHTML;
    btnAi.disabled = true;
    btnAi.innerHTML = '<span class="ai-spinner"></span> AI форматирует...';

    try {
        const userParts = [
            { text: 'Slides JSON:\n' + JSON.stringify(state.slides) },
        ];
        const data = await callGeminiJson(FORMAT_PROMPT, userParts);

        if (data.slides && data.slides.length > 0) {
            // Snapshot pre-mutation state so the user can roll back this
            // particular AI rewrite. We do this AFTER the API call succeeds
            // so failed calls don't clutter history.
            pushAiHistory('До AI-форматирования');
            state.slides = data.slides.map((s, i) => ({
                ...state.slides[i],
                title: s.title || state.slides[i]?.title || '',
                body: s.body || state.slides[i]?.body || '',
                titleHtml: null,
                bodyHtml: null,
            }));
            autoHighlightAllSlides({ skipHistory: true });
            showToast('AI отформатировал текст!');
        }
    } catch (err) {
        console.error('AI format error:', err);
        showToast('Ошибка AI: ' + err.message);
    }

    btnAi.disabled = false;
    btnAi.innerHTML = origText;
}

/* ===================== EXPORT ===================== */
async function exportSlide(index) {
    saveCurrentSlideEdits();
    const prevSlide = state.currentSlide;
    state.currentSlide = index;
    renderSlide();
    slideTitle.contentEditable = 'false';
    slideBody.contentEditable = 'false';
    const prevTransform = slideCanvas.style.transform;
    slideCanvas.style.transform = 'none';
    slideTitle.blur();
    slideBody.blur();
    await new Promise(r => setTimeout(r, 300));
    try {
        const { w, h } = getCanvasDimensions();
        const canvas = await html2canvas(slideCanvas, {
            width: w, height: h, scale: 1, useCORS: true, backgroundColor: null, logging: false,
        });
        const link = document.createElement('a');
        link.download = `slide-${index + 1}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    } catch (err) {
        showToast('\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0440\u0438 \u044d\u043a\u0441\u043f\u043e\u0440\u0442\u0435: ' + err.message);
    }
    slideTitle.contentEditable = 'true';
    slideBody.contentEditable = 'true';
    slideCanvas.style.transform = prevTransform;
    state.currentSlide = prevSlide;
    renderSlide();
}

async function exportAllSlides() {
    loadingOverlay.classList.add('visible');
    saveCurrentSlideEdits();
    const prevSlide = state.currentSlide;
    slideTitle.contentEditable = 'false';
    slideBody.contentEditable = 'false';
    const prevTransform = slideCanvas.style.transform;
    slideCanvas.style.transform = 'none';
    slideTitle.blur();
    slideBody.blur();
    try {
        for (let i = 0; i < state.slides.length; i++) {
            state.currentSlide = i;
            renderSlide();
            await new Promise(r => setTimeout(r, 300));
            const { w, h } = getCanvasDimensions();
            const canvas = await html2canvas(slideCanvas, {
                width: w, height: h, scale: 1, useCORS: true, backgroundColor: null, logging: false,
            });
            const link = document.createElement('a');
            link.download = `slide-${i + 1}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            await new Promise(r => setTimeout(r, 300));
        }
        showToast(`${state.slides.length} \u0441\u043b\u0430\u0439\u0434\u043e\u0432 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043e!`);
    } catch (err) {
        showToast('\u041e\u0448\u0438\u0431\u043a\u0430: ' + err.message);
    }
    slideTitle.contentEditable = 'true';
    slideBody.contentEditable = 'true';
    slideCanvas.style.transform = prevTransform;
    state.currentSlide = prevSlide;
    renderSlide();
    loadingOverlay.classList.remove('visible');
}

/* ===================== UTILS ===================== */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

/* ===================== TEXT ACTION POPOVER =====================
 * Small floating plate that appears above the slide title/body when the
 * user taps them. Offers three actions: edit (default contenteditable),
 * select (highlight the word at click point), move (switch the canvas
 * into move-mode with this text element selected). Designed not to steal
 * focus from the contentEditable target. */
let _popoverState = { targetKey: null, clickX: 0, clickY: 0 };

function _popoverEl() { return document.getElementById('text-action-popover'); }

function hideTextActionPopover() {
    const pop = _popoverEl();
    if (pop) pop.hidden = true;
    _popoverState.targetKey = null;
}

function showTextActionPopover(targetKey, clientX, clientY, anchorEl) {
    const pop = _popoverEl();
    if (!pop) return;
    _popoverState.targetKey = targetKey;
    _popoverState.clickX = clientX;
    _popoverState.clickY = clientY;
    // Position above the click point, clamped inside the viewport. The
    // popover uses `transform: translate(-50%, -100%)` so (left, top) is the
    // anchor point at the bottom-center of the plate.
    pop.hidden = false;
    // Measure after a frame so width is known.
    requestAnimationFrame(() => {
        const r = pop.getBoundingClientRect();
        const margin = 6;
        let top = clientY - margin;
        let left = clientX;
        // If we'd render above the viewport, flip below the click point.
        if (top - r.height < 4) {
            top = clientY + margin + r.height;
            pop.style.setProperty('--tap-flip', '1');
        } else {
            pop.style.removeProperty('--tap-flip');
        }
        // Clamp horizontally so the plate stays visible.
        const half = r.width / 2;
        const vw = window.innerWidth;
        if (left - half < 4) left = half + 4;
        if (left + half > vw - 4) left = vw - half - 4;
        pop.style.top = top + 'px';
        pop.style.left = left + 'px';
    });
}

/**
 * If the point (clientX, clientY) inside hostEl lands on an existing <mark>
 * element (or its descendant text), unwrap that mark and persist the change.
 * Returns 'removed' if a mark was unwrapped, null otherwise. Used by the
 * popover «Маркер» action to toggle a word's highlight on the second tap.
 */
function _toggleMarkAtPoint(clientX, clientY, hostEl) {
    const target = document.elementFromPoint(clientX, clientY);
    if (!target) return null;
    const markEl = target.closest && target.closest('mark');
    if (!markEl || !hostEl.contains(markEl)) return null;
    if (typeof pushEditHistory === 'function') pushEditHistory('До снятия выделения');
    if (typeof pushHighlightHistory === 'function') pushHighlightHistory('Снятие выделения со слова');
    // Replace the <mark>...</mark> with its inner contents in place.
    const parent = markEl.parentNode;
    while (markEl.firstChild) parent.insertBefore(markEl.firstChild, markEl);
    parent.removeChild(markEl);
    parent.normalize();
    const slide = state.slides[state.currentSlide];
    if (slide) {
        if (slideTitle.contains(parent) || parent === slideTitle) {
            slide.titleHtml = slideTitle.querySelector('mark') ? slideTitle.innerHTML : null;
            slide.title = slideTitle.innerText;
        } else if (slideBody.contains(parent) || parent === slideBody) {
            slide.bodyHtml = slideBody.querySelector('mark') ? slideBody.innerHTML : null;
            slide.body = slideBody.innerText;
        }
    }
    renderThumbnails();
    if (typeof syncEditMirrors === 'function') syncEditMirrors();
    return 'removed';
}

function _selectWordAtPoint(clientX, clientY, hostEl) {
    // Build a Range at the caret position under (x, y) and expand to the
    // word boundary on each side. Used by the "Выбрать" popover action.
    let caret = null;
    if (typeof document.caretRangeFromPoint === 'function') {
        caret = document.caretRangeFromPoint(clientX, clientY);
    } else if (typeof document.caretPositionFromPoint === 'function') {
        const p = document.caretPositionFromPoint(clientX, clientY);
        if (p) {
            caret = document.createRange();
            caret.setStart(p.offsetNode, p.offset);
            caret.setEnd(p.offsetNode, p.offset);
        }
    }
    if (!caret) return false;
    const node = caret.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    if (!hostEl.contains(node)) return false;
    const txt = node.nodeValue || '';
    let start = caret.startOffset;
    let end = caret.startOffset;
    const isWord = (ch) => /[\p{L}\p{N}_-]/u.test(ch);
    while (start > 0 && isWord(txt[start - 1])) start--;
    while (end < txt.length && isWord(txt[end])) end++;
    if (start === end) return false;
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    const sel = window.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(r);
    // captureEditorSelection() runs on 'selectionchange' but call it
    // explicitly to avoid the popover-click race.
    captureEditorSelection();
    return true;
}

function setupTextActionPopover() {
    const pop = _popoverEl();
    if (!pop) return;
    // Don't move focus when the user mousedowns a popover button — the
    // contentEditable target must keep its selection so "Выбрать" survives
    // and so the caret stays put for "Отредактировать".
    pop.querySelectorAll('.tap-btn').forEach(btn => {
        btn.addEventListener('mousedown', (ev) => ev.preventDefault());
        btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const action = btn.dataset.tapAction;
            const target = _popoverState.targetKey;
            const x = _popoverState.clickX;
            const y = _popoverState.clickY;
            const hostEl = target === 'title' ? slideTitle : slideBody;
            handleTextAction(action, target, hostEl, x, y);
            hideTextActionPopover();
        });
    });
    // The popover swallows its own clicks so the global "click outside =>
    // dismiss" handler below doesn't immediately close it.
    pop.addEventListener('pointerdown', (ev) => ev.stopPropagation());

    // Dismiss on any other interaction.
    document.addEventListener('pointerdown', (ev) => {
        if (pop.hidden) return;
        if (pop.contains(ev.target)) return;
        hideTextActionPopover();
    }, true);
    document.addEventListener('keydown', (ev) => {
        if (pop.hidden) return;
        if (ev.key === 'Escape') hideTextActionPopover();
    });
    window.addEventListener('scroll', hideTextActionPopover, true);
    window.addEventListener('resize', hideTextActionPopover);
}

function handleTextAction(action, target, hostEl, clickX, clickY) {
    if (!hostEl) return;
    if (action === 'edit') {
        // Make sure we're in edit mode and the element is contentEditable +
        // focused. Place the caret at the click point so the user can start
        // typing where they tapped.
        if (state.settings && state.settings.moveMode) {
            state.settings.moveMode = false;
            const be = $('#btn-mode-edit');
            const bm = $('#btn-mode-move');
            if (be) be.classList.add('active');
            if (bm) bm.classList.remove('active');
            renderSlide();
        }
        hostEl.contentEditable = 'true';
        hostEl.focus();
        try {
            const caret = (typeof document.caretRangeFromPoint === 'function')
                ? document.caretRangeFromPoint(clickX, clickY)
                : null;
            if (caret) {
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(caret);
            }
        } catch (_) {}
    } else if (action === 'select') {
        // Highlight the word under the click and capture as editorSelection so
        // the user can apply a highlight from the sidebar without a second
        // manual selection step.
        if (state.settings && state.settings.moveMode) {
            state.settings.moveMode = false;
            renderSlide();
        }
        hostEl.contentEditable = 'true';
        hostEl.focus();
        const ok = _selectWordAtPoint(clickX, clickY, hostEl);
        if (!ok) showToast('Не удалось выделить слово — попробуйте двойной клик');
        else showToast('Слово выделено — нажмите «Применить» в панели «Выделение»');
    } else if (action === 'mark') {
        // One-tap marker: highlight the single word under the cursor (or remove
        // an existing <mark> if the user tapped one). Uses the currently-
        // selected style+color from the sidebar.
        if (state.settings && state.settings.moveMode) {
            state.settings.moveMode = false;
            renderSlide();
        }
        hostEl.contentEditable = 'true';
        hostEl.focus();
        const removed = _toggleMarkAtPoint(clickX, clickY, hostEl);
        if (removed === 'removed') {
            showToast('Выделение снято');
            return;
        }
        const ok = _selectWordAtPoint(clickX, clickY, hostEl);
        if (!ok) {
            showToast('Не удалось выделить слово');
            return;
        }
        applyHighlight();
        const styleName = (HIGHLIGHT_STYLES[state.settings.highlightStyle || 'marker'] || HIGHLIGHT_STYLES.marker).name;
        showToast('Слово выделено в стиле «' + styleName + '»');
    } else if (action === 'move') {
        // Switch to move-mode with this text element selected so it's the
        // only thing draggable. Existing render logic gives it pointer-
        // events:auto, the bright outline and the resize handles.
        state.settings.moveMode = true;
        state.selectedTextEl = target;
        state.selectedDecorIdx = null;
        const be = $('#btn-mode-edit');
        const bm = $('#btn-mode-move');
        if (be) be.classList.remove('active');
        if (bm) bm.classList.add('active');
        renderSlide();
        showToast('Тяните блок мышью или пальцем');
    }
}

/* ===================== EDIT-PANEL MIRROR =====================
 * Two contenteditable divs at the bottom of the editor that mirror the
 * currently selected slide's title and body — *with* their highlight marks
 * intact. The user can:
 *   - read the same text + highlights as on the slide, in a calm, scrollable
 *     panel (no canvas scaling tricks).
 *   - select a fragment here and click «Применить» in the sidebar's
 *     "Выделение" section to highlight the same fragment on the slide.
 *   - edit the text here; the slide updates live, highlights are cleared
 *     (matches existing behaviour when inline editing the slide).
 */
const _mirrorRefs = { title: null, body: null };

function _getMirror(target) {
    if (target === 'title') return _mirrorRefs.title || (_mirrorRefs.title = document.getElementById('edit-title-mirror'));
    if (target === 'body')  return _mirrorRefs.body  || (_mirrorRefs.body  = document.getElementById('edit-body-mirror'));
    return null;
}

function _isInsideMirror(node) {
    const mt = _getMirror('title');
    const mb = _getMirror('body');
    if (mt && mt.contains(node)) return 'title';
    if (mb && mb.contains(node)) return 'body';
    return null;
}

function syncEditMirrors() {
    const slide = state.slides[state.currentSlide];
    if (!slide) return;
    const mt = _getMirror('title');
    const mb = _getMirror('body');
    // Don't blow away the caret while the user is actively typing in either
    // mirror — the input handler keeps slide state in sync, and we'll
    // re-render the mirror on the next blur/render that isn't sourced from
    // the mirror itself.
    if (mt && document.activeElement !== mt) {
        const html = slide.titleHtml || escapeHtml(slide.title || '');
        if (mt.innerHTML !== html) mt.innerHTML = html;
    }
    if (mb && document.activeElement !== mb) {
        const html = slide.bodyHtml || escapeHtml(slide.body || '');
        if (mb.innerHTML !== html) mb.innerHTML = html;
    }
}

function _plainTextOffsets(rootEl, range) {
    // Map a DOM Range inside rootEl to plain-text character offsets.
    // Works regardless of how text is nested (text nodes, marks, spans).
    try {
        const pre = document.createRange();
        pre.selectNodeContents(rootEl);
        pre.setEnd(range.startContainer, range.startOffset);
        const start = pre.toString().length;
        const len = range.toString().length;
        return { start, end: start + len };
    } catch (e) {
        return null;
    }
}

function _rangeFromOffsets(rootEl, start, end) {
    // Inverse of _plainTextOffsets: produce a Range inside rootEl that spans
    // the same plain-text characters.
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
    let acc = 0;
    let startNode = null, startOff = 0, endNode = null, endOff = 0;
    let node;
    while ((node = walker.nextNode())) {
        const len = node.nodeValue.length;
        if (!startNode && acc + len >= start) { startNode = node; startOff = start - acc; }
        if (acc + len >= end) { endNode = node; endOff = end - acc; break; }
        acc += len;
    }
    if (!startNode || !endNode) return null;
    const r = document.createRange();
    try {
        r.setStart(startNode, startOff);
        r.setEnd(endNode, endOff);
        return r;
    } catch (e) {
        return null;
    }
}

function _captureMirrorSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const r = sel.getRangeAt(0);
    if (r.collapsed) return false;
    const target = _isInsideMirror(r.commonAncestorContainer);
    if (!target) return false;
    // Map the mirror selection to a slide-DOM range so applyHighlight() can
    // operate on the slide.
    const mirror = _getMirror(target);
    const slideEl = target === 'title' ? slideTitle : slideBody;
    if (!mirror || !slideEl) return false;
    const offsets = _plainTextOffsets(mirror, r);
    if (!offsets || offsets.end <= offsets.start) return false;
    const slideRange = _rangeFromOffsets(slideEl, offsets.start, offsets.end);
    if (!slideRange) return false;
    editorSelection.range = slideRange;
    editorSelection.text = slideRange.toString().trim();
    editorSelection.target = target;
    editorSelection.slideIdx = state.currentSlide;
    // Visual hint that the mirror is the "source of truth" for this selection.
    document.querySelectorAll('.edit-mirror').forEach(m => m.classList.remove('has-active-selection'));
    mirror.classList.add('has-active-selection');
    updateSelectionPreviewBar();
    return true;
}

function setupEditMirrors() {
    const mt = _getMirror('title');
    const mb = _getMirror('body');
    [mt, mb].forEach(m => {
        if (!m) return;
        const target = m.dataset.target;
        // Editing the mirror is wired the same way as the inline slide
        // contentEditable: write back plain text to slide state and clear
        // any highlight HTML (highlights would be invalid after a text edit).
        m.addEventListener('input', () => {
            const slide = state.slides[state.currentSlide];
            if (!slide) return;
            if (typeof pushEditHistoryDebounced === 'function') {
                pushEditHistoryDebounced(target === 'title' ? 'До правки заголовка' : 'До правки текста', 700);
            }
            const txt = m.innerText;
            if (target === 'title') {
                slide.title = txt;
                slide.titleHtml = null;
                if (slideTitle) slideTitle.innerHTML = escapeHtml(txt);
            } else {
                slide.body = txt;
                slide.bodyHtml = null;
                if (slideBody) slideBody.innerHTML = escapeHtml(txt);
            }
            renderThumbnails();
        });
        // Tapping into a mirror clears the visual "active selection" badge on
        // siblings so it doesn't lie about which field owns the selection.
        m.addEventListener('focus', () => {
            document.querySelectorAll('.edit-mirror').forEach(x => {
                if (x !== m) x.classList.remove('has-active-selection');
            });
        });
    });
    // Whenever the user finishes a selection inside a mirror, propagate it
    // to editorSelection so the sidebar's «Применить» button works on it.
    document.addEventListener('selectionchange', () => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const r = sel.getRangeAt(0);
        if (r.collapsed) return;
        if (!_isInsideMirror(r.commonAncestorContainer)) {
            // Selection lives outside a mirror — clear the mirror badge.
            document.querySelectorAll('.edit-mirror').forEach(x => x.classList.remove('has-active-selection'));
            return;
        }
        _captureMirrorSelection();
    });
}

/* ===================== EVENT LISTENERS ===================== */
function init() {
    renderLayouts();
    renderGradients();
    renderSolids();
    renderTemplatePresets();
    renderDecorButtons();
    wireDecorActions();
    wireApiKeyModal();
    updateQuotaUi();
    setupPinchZoom();
    setupSwipeNavigation();
    setupMobileTabbar();
    setupTextActionPopover();
    setupEditMirrors();

    // Text input
    textInput.addEventListener('input', () => {
        const text = textInput.value;
        charCount.textContent = text.length;
        const slides = parseSlides(text);
        slideCountNum.textContent = slides.length;
        btnToStyle.disabled = slides.length === 0;
        if (btnAiSplit) btnAiSplit.disabled = text.trim().length < 20;
    });

    // Step navigation
    btnToStyle.addEventListener('click', () => {
        state.slides = parseSlides(textInput.value);
        if (state.slides.length === 0) return;
        // Pre-bake highlights so slides arrive in editor already styled.
        // skipHistory: this is the initial highlight, nothing meaningful to roll back to.
        autoHighlightAllSlides({ skipHistory: true });
        goToStep(2);
    });

    // AI split: rewrite raw text into clean slides, stripping any "Слайд N"
    // markers and polishing title/body. Works both for already-marked text
    // (respects boundaries) and unmarked text (AI decides where to split).
    if (btnAiSplit) {
        btnAiSplit.addEventListener('click', async () => {
            const raw = (textInput.value || '').trim();
            if (raw.length < 20) return;
            const origHtml = btnAiSplit.innerHTML;
            btnAiSplit.disabled = true;
            btnAiSplit.innerHTML = '<span class="ai-spinner"></span> AI разбивает...';
            try {
                const userParts = [{ text: 'Source text:\n' + raw }];
                const data = await callGeminiJson(SPLIT_PROMPT, userParts);
                if (data && Array.isArray(data.slides) && data.slides.length > 0) {
                    // Snapshot prior slides (if any) so the user can roll back
                    // an AI-driven split.
                    if (state.slides && state.slides.length) pushAiHistory('До AI-разбиения');
                    state.slides = data.slides.map(s => ({
                        title: (s.title || '').trim(),
                        body: (s.body || '').trim(),
                        titleHtml: null,
                        bodyHtml: null,
                    }));
                    // Rewrite the textarea to a clean canonical form so the
                    // user sees what AI produced (and can edit if needed).
                    const canonical = state.slides.map((s, i) =>
                        `Слайд ${i + 1}\n${s.title}${s.body ? '\n' + s.body : ''}`
                    ).join('\n\n');
                    textInput.value = canonical;
                    charCount.textContent = canonical.length;
                    slideCountNum.textContent = state.slides.length;
                    btnToStyle.disabled = false;
                    // AI split is itself a major mutation; we already snapshot above.
                    autoHighlightAllSlides({ skipHistory: true });
                    showToast(`AI разбил на ${state.slides.length} слайдов`);
                } else {
                    showToast('AI не вернул слайды. Попробуйте ещё раз.');
                }
            } catch (err) {
                console.error('AI split error:', err);
                showToast('Ошибка AI: ' + err.message);
            }
            btnAiSplit.disabled = (textInput.value.trim().length < 20);
            btnAiSplit.innerHTML = origHtml;
        });
    }

    btnBackToText.addEventListener('click', () => goToStep(1));

    btnToEditor.addEventListener('click', () => {
        state.currentSlide = 0;
        state.settings.align = state.settings.align || state.selectedLayout.align;
        // Sync all sidebar controls with current state
        syncSidebarWithState();
        if (state.selectedBg.type === 'photo') {
            photoControls.style.display = 'flex';
        } else {
            photoControls.style.display = 'none';
        }
        goToStep(3);
    });

    btnBackToStyle.addEventListener('click', () => {
        saveCurrentSlideEdits();
        goToStep(2);
    });

    // Background tabs
    $$('.bg-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            $$('.bg-tab').forEach(t => t.classList.remove('active'));
            $$('.bg-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            $(`#tab-${tab.dataset.tab}`).classList.add('active');
        });
    });

    // Category pills
    $$('.cat-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            $$('.cat-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            fetchPhotos(pill.dataset.query, true);
        });
    });

    // Photo search
    let searchTimeout;
    photoSearch.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const query = photoSearch.value.trim();
            if (query.length >= 2) {
                $$('.cat-pill').forEach(p => p.classList.remove('active'));
                fetchPhotos(query, true);
            }
        }, 500);
    });

    // Load more
    btnLoadMore.addEventListener('click', () => {
        state.pexels.page++;
        fetchPhotos(state.pexels.query, false);
    });

    // Slide navigation (animated on mobile)
    btnPrevSlide.addEventListener('click', () => navigateSlide(-1));
    btnNextSlide.addEventListener('click', () => navigateSlide(1));

    // Add slide
    btnAddSlide.addEventListener('click', () => {
        saveCurrentSlideEdits();
        state.slides.push({ title: '\u041d\u043e\u0432\u044b\u0439 \u0441\u043b\u0430\u0439\u0434', body: '\u0422\u0435\u043a\u0441\u0442 \u0441\u043b\u0430\u0439\u0434\u0430' });
        state.currentSlide = state.slides.length - 1;
        renderSlide(); renderThumbnails();
    });

    // Settings: format
    $$('.format-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.format-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.settings.ratio = btn.dataset.ratio;
            scaleCanvas(); renderSlide(); renderThumbnails();
        });
    });

    // Settings: fonts
    titleFontSelect.addEventListener('change', () => {
        state.settings.titleFont = titleFontSelect.value;
        renderSlide(); renderThumbnails();
    });
    bodyFontSelect.addEventListener('change', () => {
        state.settings.bodyFont = bodyFontSelect.value;
        renderSlide(); renderThumbnails();
    });

    // Settings: custom background image upload
    btnUploadBg.addEventListener('click', () => bgImageInput.click());
    bgImageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            state.selectedBg = { type: 'photo', value: ev.target.result, medium: ev.target.result };
            photoControls.style.display = 'flex';
            renderSlide(); renderThumbnails();
            showToast('\u0424\u043e\u0442\u043e \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u043e!');
        };
        reader.readAsDataURL(file);
    });

    bgOverlayRange.addEventListener('input', () => {
        state.settings.overlayOpacity = parseInt(bgOverlayRange.value);
        bgOverlayVal.textContent = bgOverlayRange.value + '%';
        renderSlide(); renderThumbnails();
    });

    if (bgBlurRange) {
        bgBlurRange.addEventListener('input', () => {
            state.settings.bgBlur = parseInt(bgBlurRange.value);
            bgBlurVal.textContent = bgBlurRange.value;
            renderSlide();
        });
    }

    $$('.overlay-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.overlay-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.settings.overlayMode = btn.dataset.mode;
            renderSlide(); renderThumbnails();
        });
    });

    $$('.overlay-dir-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.overlay-dir-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.settings.overlayDirection = btn.dataset.dir;
            renderSlide(); renderThumbnails();
        });
    });

    btnRemoveBg.addEventListener('click', () => {
        state.selectedBg = { type: 'gradient', value: GRADIENTS[0] };
        bgImageInput.value = '';
        photoControls.style.display = 'none';
        renderSlide(); renderThumbnails();
        showToast('\u0424\u043e\u0442\u043e \u0443\u0431\u0440\u0430\u043d\u043e');
    });

    // Template photo slot upload
    const slotImageInput = $('#slot-image-input');
    const btnUploadSlot = $('#btn-upload-slot');
    const slotPhotoControls = $('#slot-photo-controls');
    const btnRemoveSlot = $('#btn-remove-slot');
    if (btnUploadSlot && slotImageInput) {
        btnUploadSlot.addEventListener('click', () => slotImageInput.click());
        slotImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                state.settings.slotPhotoSrc = ev.target.result;
                if (slotPhotoControls) slotPhotoControls.style.display = 'flex';
                renderSlide(); renderThumbnails();
                showToast('\u0424\u043e\u0442\u043e \u0432\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u043e \u0432 \u0448\u0430\u0431\u043b\u043e\u043d!');
            };
            reader.readAsDataURL(file);
        });
    }
    if (btnRemoveSlot && slotImageInput) {
        btnRemoveSlot.addEventListener('click', () => {
            state.settings.slotPhotoSrc = null;
            slotImageInput.value = '';
            if (slotPhotoControls) slotPhotoControls.style.display = 'none';
            renderSlide(); renderThumbnails();
            showToast('\u0424\u043e\u0442\u043e \u0438\u0437 \u0448\u0430\u0431\u043b\u043e\u043d\u0430 \u0443\u0431\u0440\u0430\u043d\u043e');
        });
    }

    // Move / Edit mode toggle
    const btnModeEdit = $('#btn-mode-edit');
    const btnModeMove = $('#btn-mode-move');
    const setMode = (mode) => {
        state.settings.moveMode = (mode === 'move');
        if (btnModeEdit) btnModeEdit.classList.toggle('active', mode === 'edit');
        if (btnModeMove) btnModeMove.classList.toggle('active', mode === 'move');
        renderSlide();
        renderThumbnails();
    };
    if (btnModeEdit) btnModeEdit.addEventListener('click', () => setMode('edit'));
    if (btnModeMove) btnModeMove.addEventListener('click', () => setMode('move'));

    // Reset positions on current slide back to template defaults
    const btnResetPositions = $('#btn-reset-positions');
    if (btnResetPositions) {
        btnResetPositions.addEventListener('click', () => {
            if (!state.slides.length) return;
            const slide = state.slides[state.currentSlide];
            slide.contentPos = null;
            slide.titlePos = null;
            slide.bodyPos = null;
            renderSlide();
            renderThumbnails();
            showToast('\u041f\u043e\u0437\u0438\u0446\u0438\u0438 \u0441\u0431\u0440\u043e\u0448\u0435\u043d\u044b');
        });
    }

    // Settings: font size
    fontSizeRange.addEventListener('input', () => {
        state.settings.fontSize = parseInt(fontSizeRange.value);
        fontSizeVal.textContent = fontSizeRange.value;
        renderSlide();
    });
    titleSizeRange.addEventListener('input', () => {
        state.settings.titleSize = parseInt(titleSizeRange.value);
        titleSizeVal.textContent = titleSizeRange.value;
        renderSlide();
    });

    // Settings: alignment
    $$('.align-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.align-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.settings.align = btn.dataset.align;
            renderSlide();
            renderThumbnails();
        });
    });

    // Settings: text position. Clearing per-slide drag overrides here is
    // important — otherwise a previously-dragged title stays put and the
    // user thinks the preset is broken.
    $$('.position-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (typeof pushEditHistory === 'function') pushEditHistory('До смены позиции текста');
            $$('.position-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.settings.textPosition = btn.dataset.position;
            resetAllDraggedPositions();
            renderSlide();
            renderThumbnails();
        });
    });

    // Settings: slide number toggle
    showSlideNumber.addEventListener('change', () => {
        state.settings.showNumber = showSlideNumber.checked;
        renderSlide();
    });

    // Settings: author
    authorInput.addEventListener('input', () => {
        state.settings.author = authorInput.value;
        renderSlide();
    });

    // Edit-panel mirrors (input handlers wired in setupEditMirrors()).

    // Sync inline edits back to the mirror panels so they always reflect the
    // current slide content + highlights.
    slideTitle.addEventListener('input', () => {
        if (typeof pushEditHistoryDebounced === 'function') pushEditHistoryDebounced('До правки заголовка', 700);
        const slide = state.slides[state.currentSlide];
        if (!slide) return;
        slide.title = slideTitle.innerText;
        if (slideTitle.querySelector('mark')) slide.titleHtml = slideTitle.innerHTML;
        else slide.titleHtml = null;
        if (typeof syncEditMirrors === 'function') syncEditMirrors();
        renderThumbnails();
    });
    slideBody.addEventListener('input', () => {
        if (typeof pushEditHistoryDebounced === 'function') pushEditHistoryDebounced('До правки текста', 700);
        const slide = state.slides[state.currentSlide];
        if (!slide) return;
        slide.body = slideBody.innerText;
        if (slideBody.querySelector('mark')) slide.bodyHtml = slideBody.innerHTML;
        else slide.bodyHtml = null;
        if (typeof syncEditMirrors === 'function') syncEditMirrors();
        renderThumbnails();
    });

    // Tap-to-action popover for slide title/body. We only show it in edit
    // mode (in move-mode the existing click logic selects the element for
    // dragging and we don't want a competing UI).
    const _maybeShowPopoverFor = (key, hostEl, ev) => {
        if (!hostEl) return;
        if (state.settings && state.settings.moveMode) return;
        // Skip showing the plate when the user is actively dragging a
        // selection (mouseup with a non-collapsed selection) — that's a
        // standard text-selection gesture, not a request for the menu.
        const sel = window.getSelection();
        if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed) {
            const r = sel.getRangeAt(0);
            if (hostEl.contains(r.commonAncestorContainer)) return;
        }
        showTextActionPopover(key, ev.clientX, ev.clientY, hostEl);
    };
    slideTitle.addEventListener('click', (ev) => _maybeShowPopoverFor('title', slideTitle, ev));
    slideBody.addEventListener('click', (ev) => _maybeShowPopoverFor('body', slideBody, ev));
    // Hide the popover once the user starts typing — the menu has done its
    // job and the keypress signals a clear "edit" intent.
    slideTitle.addEventListener('keydown', hideTextActionPopover);
    slideBody.addEventListener('keydown', hideTextActionPopover);

    // Color pickers
    const titleColorPicker = $('#title-color-picker');
    const bodyColorPicker = $('#body-color-picker');
    const colorSection = $('#color-section');
    const btnResetColors = $('#btn-reset-colors');

    if (titleColorPicker) {
        titleColorPicker.addEventListener('input', () => {
            state.settings.titleColorOverride = titleColorPicker.value;
            renderSlide();
        });
    }
    if (bodyColorPicker) {
        bodyColorPicker.addEventListener('input', () => {
            state.settings.bodyColorOverride = bodyColorPicker.value;
            renderSlide();
        });
    }
    if (btnResetColors) {
        btnResetColors.addEventListener('click', () => {
            state.settings.titleColorOverride = null;
            state.settings.bodyColorOverride = null;
            renderSlide();
        });
    }

    // Highlight controls
    const btnHighlight = $('#btn-highlight');
    const highlightColorInput = $('#highlight-color');
    const btnClearHighlight = $('#btn-clear-highlight');
    const btnAiHighlight = $('#btn-ai-highlight');
    const selPreviewApply = $('#sel-preview-apply');

    // Prevent style controls from stealing focus from the contentEditable slide
    // text — this keeps the live DOM selection intact while the user reaches
    // for the chip/button. (mousedown fires before focus moves.) Touch is
    // handled separately by the saved Range fallback.
    const preserveFocusOnPointerDown = (el) => {
        if (!el) return;
        el.addEventListener('mousedown', (ev) => {
            // Color picker needs default behaviour to open the native picker.
            if (el.tagName === 'INPUT' && el.type === 'color') return;
            ev.preventDefault();
        });
    };

    if (btnAiHighlight) {
        btnAiHighlight.addEventListener('click', () => {
            saveCurrentSlideEdits();
            autoHighlightAllSlides();
        });
    }
    if (btnHighlight) {
        preserveFocusOnPointerDown(btnHighlight);
        btnHighlight.addEventListener('click', (e) => {
            e.preventDefault();
            applyHighlight();
        });
    }
    if (selPreviewApply) {
        preserveFocusOnPointerDown(selPreviewApply);
        selPreviewApply.addEventListener('click', (e) => {
            e.preventDefault();
            applyHighlight();
        });
    }
    if (highlightColorInput) {
        highlightColorInput.addEventListener('input', () => {
            state.settings.highlightColor = highlightColorInput.value;
            restyleAllHighlights();
        });
    }
    if (btnClearHighlight) {
        btnClearHighlight.addEventListener('click', clearHighlights);
    }
    const btnUndoHighlight = $('#btn-undo-highlight');
    if (btnUndoHighlight) {
        btnUndoHighlight.addEventListener('click', (e) => {
            e.preventDefault();
            undoLastHighlight();
        });
    }
    // Initial UI sync so the button starts disabled.
    updateHighlightUndoUi();

    // Highlight style chips — switch between marker / pill / underline / glow / accent.
    // If the user has a saved text selection, clicking a chip ALSO applies that
    // style as a new highlight to the saved selection (one tap = pick style +
    // highlight). Otherwise it only changes the style for future highlights
    // and restyles existing ones.
    const styleChipsContainer = $('#highlight-styles');
    if (styleChipsContainer) {
        styleChipsContainer.querySelectorAll('.highlight-style-chip').forEach(chip => {
            chip.classList.toggle('active', chip.dataset.style === (state.settings.highlightStyle || 'marker'));
            preserveFocusOnPointerDown(chip);
            chip.addEventListener('click', () => {
                const hadSelection = hasValidEditorSelection();
                const hasAnyMark = state.slides.some(s =>
                    (s.titleHtml && s.titleHtml.includes('<mark')) ||
                    (s.bodyHtml && s.bodyHtml.includes('<mark'))
                );
                if (typeof pushEditHistory === 'function') pushEditHistory('До смены стиля выделения');
                // Snapshot for the highlight-only undo button — only when
                // something is actually about to change visually (existing
                // marks present OR a new highlight will be applied below).
                if ((hasAnyMark || hadSelection) && typeof pushHighlightHistory === 'function') {
                    pushHighlightHistory('Смена стиля выделения');
                }
                state.settings.highlightStyle = chip.dataset.style;
                styleChipsContainer.querySelectorAll('.highlight-style-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                restyleAllHighlights();
                if (hadSelection) {
                    // Apply the just-picked style to whatever the user had
                    // selected on the canvas — saves them a second tap on
                    // "Применить".
                    applyHighlight();
                }
            });
        });
    }

    // Style choice toggle (template vs manual)
    const btnUploadCard = $('#btn-upload-template-card');
    const btnManualStyle = $('#btn-manual-style');
    const templateSection = $('#template-upload-section');
    const manualSection = $('#manual-style-section');

    if (btnUploadCard && btnManualStyle) {
        btnUploadCard.addEventListener('click', (e) => {
            // Don't trigger file input from the card click — we handle that in upload area
            e.preventDefault();
            btnUploadCard.classList.add('active');
            btnManualStyle.classList.remove('active');
            if (templateSection) templateSection.style.display = 'block';
            if (manualSection) manualSection.style.display = 'none';
        });

        btnManualStyle.addEventListener('click', () => {
            btnManualStyle.classList.add('active');
            btnUploadCard.classList.remove('active');
            if (templateSection) templateSection.style.display = 'none';
            if (manualSection) manualSection.style.display = 'block';
        });
    }

    // "Применить ко всем" — broadcast current slide's style + bg to every
    // other slide.
    const btnApplyStyleToAll = $('#btn-apply-style-to-all');
    if (btnApplyStyleToAll) {
        btnApplyStyleToAll.addEventListener('click', () => {
            applyCurrentStyleToAllSlides();
        });
    }

    // AI format
    const btnAiFormat = $('#btn-ai-format');
    if (btnAiFormat) {
        btnAiFormat.addEventListener('click', aiFormatSlides);
    }

    // Universal undo (covers all non-AI actions). Wired to a top-of-editor
    // toolbar button + Ctrl+Z / Cmd+Z keyboard shortcut.
    const btnUndo = $('#btn-undo');
    if (btnUndo) btnUndo.addEventListener('click', undoLastEdit);

    // Ctrl+Z / Cmd+Z global handler — but skip when the user is typing in a
    // contentEditable (slide-title/body) or input/textarea, because the
    // browser's native text undo should take priority there.
    document.addEventListener('keydown', (e) => {
        if (!(e.key === 'z' || e.key === 'Z')) return;
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.shiftKey || e.altKey) return;
        const active = document.activeElement;
        if (active && (
            active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.isContentEditable
        )) return;
        // Only act in the editor (step 3); ignore on the other steps to
        // avoid surprising the user during text input or template selection.
        const step3 = document.getElementById('step-3');
        if (!step3 || !step3.classList.contains('active')) return;
        e.preventDefault();
        undoLastEdit();
    });

    // AI undo + history modal
    const btnAiUndo = $('#btn-ai-undo');
    if (btnAiUndo) btnAiUndo.addEventListener('click', undoLastAiMutation);
    const btnAiHistory = $('#btn-ai-history');
    if (btnAiHistory) btnAiHistory.addEventListener('click', openAiHistoryModal);
    const aiHistoryModal = $('#ai-history-modal');
    if (aiHistoryModal) {
        aiHistoryModal.querySelectorAll('[data-close]').forEach(el => {
            el.addEventListener('click', closeAiHistoryModal);
        });
    }
    // Initial UI sync (history may be empty, hides the buttons).
    updateAiHistoryUi();
    updateUndoUi();

    // Template upload
    const templateUploadArea = $('#template-upload-area');
    const templateImageInput = $('#template-image-input');
    const templatePreviewImg = $('#template-preview-img');
    const templateUploadContent = $('#template-upload-content');
    const templateUploadPreview = $('#template-upload-preview');
    const btnAnalyze = $('#btn-analyze-template');
    const btnRemoveTemplate = $('#btn-remove-template');

    if (templateUploadArea) {
        templateUploadArea.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            templateImageInput.click();
        });

        // Drag and drop
        templateUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            templateUploadArea.classList.add('drag-over');
        });
        templateUploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            templateUploadArea.classList.remove('drag-over');
        });
        templateUploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            templateUploadArea.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                handleTemplateFile(file, templatePreviewImg, templateUploadContent, templateUploadPreview);
            }
        });
    }

    if (templateImageInput) {
        templateImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            handleTemplateFile(file, templatePreviewImg, templateUploadContent, templateUploadPreview);
        });
    }

    if (btnAnalyze) {
        btnAnalyze.addEventListener('click', (e) => {
            e.stopPropagation();
            analyzeTemplate();
        });
    }

    if (btnRemoveTemplate) {
        btnRemoveTemplate.addEventListener('click', (e) => {
            e.stopPropagation();
            templateFile = null;
            templateImageInput.value = '';
            templatePreviewImg.src = '';
            templateUploadContent.style.display = 'flex';
            templateUploadPreview.style.display = 'none';
            templateUploadArea.classList.remove('template-style-applied');
            const badge = templateUploadArea.querySelector('.template-style-badge');
            if (badge) badge.remove();
            state.templateStyle = null;
            state.settings.titleColorOverride = null;
            state.settings.bodyColorOverride = null;
            state.settings.decorations = null;
            state.settings.photoSlot = null;
            state.settings.slotPhotoSrc = null;
            state.settings.cardOverlay = null;
            state.settings.textRegion = null;
            state.settings.titleTransform = null;
            state.settings.titleLetterSpacing = null;
            state.settings.titleWeight = null;
            state.settings.bodyWeight = null;
            state.settings.bodyLineHeight = null;
            // Reset fonts and sizes to defaults
            state.settings.titleFont = 'Montserrat';
            state.settings.bodyFont = 'Inter';
            state.settings.titleSize = 44;
            state.settings.fontSize = 28;
            state.settings.overlayOpacity = 50;
            state.settings.overlayMode = 'darken';
            state.settings.overlayDirection = 'auto';
            state.settings.bgBlur = 0;
            state.selectedLayout = LAYOUTS[0];
            syncLayoutCards();
            hideStyleSummary();
        });
    }

    // Export
    btnExportAll.addEventListener('click', exportAllSlides);
    btnExportCurrent.addEventListener('click', () => exportSlide(state.currentSlide));

    // Keyboard navigation
    document.addEventListener('keydown', e => {
        if (document.activeElement === textInput || document.activeElement === authorInput) return;
        if (document.activeElement === photoSearch) return;
        if (slideTitle.contains(document.activeElement) || slideBody.contains(document.activeElement)) return;
        if (e.key === 'ArrowLeft' && state.currentSlide > 0) {
            saveCurrentSlideEdits(); state.currentSlide--; renderSlide(); renderThumbnails();
        } else if (e.key === 'ArrowRight' && state.currentSlide < state.slides.length - 1) {
            saveCurrentSlideEdits(); state.currentSlide++; renderSlide(); renderThumbnails();
        }
    });

    window.addEventListener('resize', () => {
        if ($('#step-3').classList.contains('active')) scaleCanvas();
        reflowEditPanelForViewport();
    });

    reflowEditPanelForViewport();
}

/* On mobile (≤900px) the edit-panel is moved out of .editor-main so
 * .editor-main can be position:sticky cleanly, with .edit-panel and
 * .editor-sidebar as in-flow siblings below it. On wider viewports the
 * panel goes back inside .editor-main where the desktop CSS expects it. */
function reflowEditPanelForViewport() {
    const editPanel = document.getElementById('edit-panel');
    const editorMain = document.querySelector('.editor-main');
    const editorLayout = document.querySelector('.editor-layout');
    if (!editPanel || !editorMain || !editorLayout) return;
    const isMobile = window.innerWidth <= 900;
    if (isMobile) {
        // edit-panel should be a direct child of editor-layout, just after editor-main
        if (editPanel.parentNode !== editorLayout) {
            editorLayout.insertBefore(editPanel, editorMain.nextSibling);
        }
    } else {
        // edit-panel belongs inside editor-main on desktop
        if (editPanel.parentNode !== editorMain) {
            editorMain.appendChild(editPanel);
        }
    }
}

document.addEventListener('DOMContentLoaded', init);
