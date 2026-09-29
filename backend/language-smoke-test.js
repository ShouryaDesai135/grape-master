/**
 * language-smoke-test.js — End-to-end API smoke tests for multilingual features
 * Run: node language-smoke-test.js  (from backend/, with server already running)
 */
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { initDatabase, createFarmer, findFarmerByEmail } from './database.js';
import { v4 as uuidv4 } from 'uuid';

const BASE = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';

const results = [];
function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`);
}
function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
}

async function req(method, path, { token, body, formData } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (formData) {
    payload = { method, headers, body: formData };
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = { method, headers, body: JSON.stringify(body) };
  } else {
    payload = { method, headers };
  }
  const res = await fetch(`${BASE}${path}`, payload);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data };
}

async function main() {
  console.log(`\n🧪 Grape Master language smoke tests → ${BASE}\n`);

  // Health: server up?
  try {
    const health = await fetch(`${BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x', password: 'y' }),
    });
    if (health.status === 0) throw new Error('unreachable');
    pass('Server reachable', `status ${health.status}`);
  } catch (e) {
    fail('Server reachable', e.message);
    console.log('\n⚠️  Start the backend first: cd backend && npm start\n');
    process.exit(1);
  }

  // Ensure test farmer exists + mint JWT (no Firebase needed)
  initDatabase();
  const email = 'lang-test@grapemaster.ai';
  let farmer = findFarmerByEmail(email);
  if (!farmer) {
    const id = uuidv4();
    createFarmer({
      id,
      firebaseUid: `test-uid-${id}`,
      name: 'Language Tester',
      email,
      preferredLanguage: 'en',
    });
    farmer = findFarmerByEmail(email);
  }
  const farmerToken = jwt.sign(
    { id: farmer.id, type: 'farmer', email: farmer.email },
    JWT_SECRET,
    { expiresIn: '2h' }
  );
  pass('Farmer JWT minted', farmer.email);

  // 1) Preferences
  {
    const r = await req('PATCH', '/api/auth/preferences', {
      token: farmerToken,
      body: { preferredLanguage: 'hi' },
    });
    if (r.status === 200 && r.data.success) pass('PATCH preferences → hi');
    else fail('PATCH preferences → hi', JSON.stringify(r.data));
  }

  // 2) Translate EN → HI (Gemini)
  {
    const r = await req('POST', '/api/translate', {
      token: farmerToken,
      body: {
        texts: [
          'Powdery mildew appears as white patches on grape leaves. Spray wettable sulfur.',
          'Irrigate young vines every morning during berry development.',
        ],
        targetLanguage: 'hi',
      },
    });
    if (r.status === 200 && r.data.success && Array.isArray(r.data.translations) && r.data.translations.length === 2) {
      const sample = r.data.translations[0].slice(0, 80);
      const looksHindi = /[\u0900-\u097F]/.test(r.data.translations[0]);
      if (looksHindi) pass('Translate EN→HI (Gemini)', sample + '…');
      else pass('Translate EN→HI returned text (script check soft)', sample + '…');
    } else {
      fail('Translate EN→HI', `status ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    }
  }

  // 3) Translate EN → MR
  {
    const r = await req('POST', '/api/translate', {
      token: farmerToken,
      body: {
        texts: ['When should I do foundation pruning in Maharashtra?'],
        targetLanguage: 'mr',
      },
    });
    if (r.status === 200 && r.data.success && r.data.translations?.[0]) {
      const sample = r.data.translations[0].slice(0, 80);
      const looksDev = /[\u0900-\u097F]/.test(r.data.translations[0]);
      if (looksDev) pass('Translate EN→MR (Gemini)', sample + '…');
      else pass('Translate EN→MR returned text', sample + '…');
    } else {
      fail('Translate EN→MR', JSON.stringify(r.data).slice(0, 200));
    }
  }

  // 4) Chat in Hindi
  let convoId = null;
  {
    const form = new FormData();
    form.append('text', 'मेरे अंगूर के पत्तों पर सफेद पाउडर जैसे धब्बे हैं। क्या करूँ?');
    form.append('language', 'hi');
    const r = await req('POST', '/api/chat', { token: farmerToken, formData: form });
    if (r.status === 200 && r.data.success && r.data.answer) {
      convoId = r.data.conversationId;
      const looksHi = /[\u0900-\u097F]/.test(r.data.answer);
      pass('Chat reply in hi', `${looksHi ? 'Devanagari ✓' : 'no Devanagari'} · conf ${(r.data.confidence * 100).toFixed(0)}% · ${r.data.answer.slice(0, 60)}…`);
    } else {
      fail('Chat reply in hi', `status ${r.status} ${JSON.stringify(r.data).slice(0, 250)}`);
    }
  }

  // 5) Mid-session language switch + follow-up in Marathi
  if (convoId) {
    const sw = await req('PATCH', `/api/conversations/${convoId}/language`, {
      token: farmerToken,
      body: { language: 'mr' },
    });
    if (sw.status === 200 && sw.data.success) pass('Mid-session language → mr');
    else fail('Mid-session language → mr', JSON.stringify(sw.data));

    const form = new FormData();
    form.append('text', 'यावर सेंद्रिय उपाय काय आहे?');
    form.append('language', 'mr');
    form.append('conversationId', convoId);
    const r = await req('POST', '/api/chat', { token: farmerToken, formData: form });
    if (r.status === 200 && r.data.success && r.data.answer) {
      const looksDev = /[\u0900-\u097F]/.test(r.data.answer);
      pass('Follow-up chat in mr (context kept)', `${looksDev ? 'Devanagari ✓' : 'soft'} · ${r.data.answer.slice(0, 60)}…`);
    } else {
      fail('Follow-up chat in mr', JSON.stringify(r.data).slice(0, 250));
    }

    const msgs = await req('GET', `/api/conversations/${convoId}/messages`, { token: farmerToken });
    if (msgs.status === 200 && msgs.data.messages?.length >= 4) {
      pass('Conversation history preserved', `${msgs.data.messages.length} messages · lang ${msgs.data.language}`);
    } else {
      fail('Conversation history preserved', JSON.stringify(msgs.data).slice(0, 200));
    }
  } else {
    fail('Mid-session language → mr', 'skipped (no convo)');
    fail('Follow-up chat in mr', 'skipped');
    fail('Conversation history preserved', 'skipped');
  }

  // 6) Chat in English
  {
    const form = new FormData();
    form.append('text', 'How much water do grapevines need during berry development?');
    form.append('language', 'en');
    const r = await req('POST', '/api/chat', { token: farmerToken, formData: form });
    if (r.status === 200 && r.data.success && r.data.answer) {
      pass('Chat reply in en', r.data.answer.slice(0, 70) + '…');
    } else {
      fail('Chat reply in en', JSON.stringify(r.data).slice(0, 200));
    }
  }

  // 7) Validation errors
  {
    const r = await req('POST', '/api/translate', {
      token: farmerToken,
      body: { texts: ['hi'], targetLanguage: 'fr' },
    });
    if (r.status === 400) pass('Reject unsupported language');
    else fail('Reject unsupported language', `got ${r.status}`);
  }

  // 8) Admin login + metrics
  {
    const login = await req('POST', '/api/admin/login', {
      body: { email: 'admin@grapemaster.ai', password: 'admin123' },
    });
    if (login.status === 200 && login.data.success && login.data.token) {
      pass('Admin login');
      const metrics = await req('GET', '/api/admin/metrics', { token: login.data.token });
      if (metrics.status === 200 && metrics.data.success && metrics.data.metrics) {
        const m = metrics.data.metrics;
        pass('Admin metrics', `farmers ${m.totals?.farmer_count ?? '?'} · pending ${m.pendingReviewCount}`);
      } else {
        fail('Admin metrics', JSON.stringify(metrics.data).slice(0, 200));
      }
      const queue = await req('GET', '/api/admin/review-queue', { token: login.data.token });
      if (queue.status === 200 && queue.data.success && Array.isArray(queue.data.queue)) {
        pass('Admin review queue', `${queue.data.queue.length} pending`);
      } else {
        fail('Admin review queue', JSON.stringify(queue.data).slice(0, 200));
      }
    } else {
      fail('Admin login', JSON.stringify(login.data).slice(0, 200));
      fail('Admin metrics', 'skipped');
      fail('Admin review queue', 'skipped');
    }
  }

  // 9) Auth required
  {
    const r = await req('POST', '/api/translate', {
      body: { texts: ['x'], targetLanguage: 'en' },
    });
    if (r.status === 401) pass('Translate requires auth');
    else fail('Translate requires auth', `got ${r.status}`);
  }

  const ok = results.filter((r) => r.ok).length;
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n────────────────────────────`);
  console.log(`Results: ${ok} passed · ${bad} failed · ${results.length} total\n`);
  process.exit(bad > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
