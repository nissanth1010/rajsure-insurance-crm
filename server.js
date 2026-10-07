import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const supabaseUrl = process.env.SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const geminiKey = process.env.GEMINI_API_KEY || '';
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const storageBucket = process.env.STORAGE_BUCKET || 'documents';

const supabaseServer = supabaseUrl && anonKey ? createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false }
}) : null;

const supabaseAdmin = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
}) : null;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.GEMINI_MAX_FILE_BYTES || 10 * 1024 * 1024) }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'RajSure Insurance CRM' }));

app.get('/api/config', (_req, res) => {
  res.json({
    supabaseUrl: supabaseUrl || null,
    supabaseAnonKey: anonKey || null,
    aiConfigured: Boolean(geminiKey),
    serviceRoleConfigured: Boolean(serviceRoleKey),
    storageBucket,
    appName: 'RajSure Insurance CRM'
  });
});

async function requireUser(req, res, next) {
  if (!supabaseServer) return res.status(503).json({ error: 'Supabase is not configured on the server.' });
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing access token.' });
  const { data, error } = await supabaseServer.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired session.' });
  req.user = data.user;
  req.accessToken = token;
  next();
}

function authedClient(accessToken) {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

app.get('/api/me', requireUser, async (req, res) => {
  const client = authedClient(req.accessToken);
  const { data: profile, error } = await client.from('profiles').select('*').eq('id', req.user.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: req.user, profile });
});

app.post('/api/ai/extract', requireUser, upload.single('file'), async (req, res) => {
  if (!geminiKey) return res.status(503).json({ error: 'AI not configured', code: 'AI_NOT_CONFIGURED' });
  if (!req.file) return res.status(400).json({ error: 'Please upload a file.' });

  const mime = req.file.mimetype || 'application/octet-stream';
  const allowed = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
  if (!allowed.has(mime)) return res.status(415).json({ error: 'Supported files: PDF, JPG, PNG, WEBP, HEIC, HEIF.' });

  const prompt = `You are an insurance CRM extraction assistant for RajSure Insurance. Extract data from the uploaded document/image and return ONLY valid JSON. Never invent values. Use null when not visible. Keep dates in YYYY-MM-DD where possible. Return this schema exactly:
{
  "document_type": "car_policy|health_policy|kyc|quotation|invoice|other|null",
  "customer": {"full_name": null, "phone": null, "email": null, "address": null, "date_of_birth": null},
  "policy": {"policy_number": null, "insurance_type": "car|health|null", "provider": null, "start_date": null, "expiry_date": null, "premium": null, "vehicle_number": null, "vehicle_model": null, "sum_insured": null},
  "confidence": 0,
  "notes": []
}`;

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mime, data: req.file.buffer.toString('base64') } }
      ]
    }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiKey)}`;
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const raw = await response.text();
    if (!response.ok) return res.status(502).json({ error: 'Gemini request failed.', details: raw.slice(0, 500) });
    const parsed = JSON.parse(raw);
    const text = parsed?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    let data;
    try { data = JSON.parse(text); } catch { data = { raw_text: text }; }
    res.json({ data, model: geminiModel });
  } catch (error) {
    res.status(500).json({ error: 'AI extraction failed.', details: error.message });
  }
});

app.post('/api/admin/create-staff', requireUser, async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server.' });
  const { email, password, full_name, role = 'staff' } = req.body || {};
  if (!email || !password || !full_name) return res.status(400).json({ error: 'email, password and full_name are required.' });
  const client = authedClient(req.accessToken);
  const { data: me, error: meError } = await client.from('profiles').select('role').eq('id', req.user.id).single();
  if (meError || me?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name, role: role === 'admin' ? 'admin' : 'staff' } });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ user: data.user });
});

app.get(/.*/, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(port, '0.0.0.0', () => {
  console.log(`RajSure Insurance CRM running at http://localhost:${port}`);
  console.log(`Supabase configured: ${Boolean(supabaseUrl && anonKey)}`);
  console.log(`Gemini configured: ${Boolean(geminiKey)} (${geminiModel})`);
  console.log(`Service role configured: ${Boolean(serviceRoleKey)}`);
});
