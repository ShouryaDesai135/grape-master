import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../server.js';
import { initDatabase, createFarmer, createAdmin, findFarmerById, getDb } from '../database.js';
import { initEmbeddingEngine } from '../services/embeddingEngine.js';
import { reloadVectorCache } from '../services/vectorStore.js';

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';

/**
 * In-process Express request dispatcher (invokes `app.handle` without opening a TCP port).
 */
function invokeApp({ method = 'GET', url = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method.toUpperCase();
    req.url = url;
    req.originalUrl = url;
    req.headers = {
      'content-type': 'application/json',
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    };
    req.connection = { remoteAddress: '127.0.0.1' };
    req.socket = { remoteAddress: '127.0.0.1' };
    req.ip = '127.0.0.1';
    req.body = body;
    // Mark body as already parsed so express.json() passes through cleanly
    req._body = body !== null;
    req.get = (name) => req.headers[name.toLowerCase()];
    req.header = req.get;

    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    res.locals = {};
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
    res.getHeader = (k) => res.headers[k.toLowerCase()];
    res.removeHeader = (k) => { delete res.headers[k.toLowerCase()]; };
    res.header = (k, v) => { res.setHeader(k, v); return res; };
    res.set = res.header;
    res.status = (code) => { res.statusCode = code; return res; };
    res.attachment = (filename) => { res.setHeader('content-disposition', `attachment; filename="${filename}"`); return res; };
    res.json = (data) => {
      res.setHeader('content-type', 'application/json');
      resolve({ status: res.statusCode, headers: res.headers, body: data });
      return res;
    };
    res.send = (data) => {
      let parsed = data;
      if (typeof data === 'string' && res.getHeader('content-type')?.includes('application/json')) {
        try { parsed = JSON.parse(data); } catch { /* keep raw */ }
      }
      resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      return res;
    };
    res.end = (data) => {
      resolve({ status: res.statusCode, headers: res.headers, body: data });
    };

    try {
      app.handle(req, res, (err) => {
        if (err) reject(err);
        else resolve({ status: 404, headers: res.headers, body: { error: 'Not found' } });
      });
    } catch (err) {
      reject(err);
    }
  });
}

test('API Gateway Unit 4: /health, /ready, /api/languages, /api/nlp/check, Farmer Profile, Chat, Regional Analytics, Review Revoke & Account Erasure', async () => {
  initDatabase();
  await initEmbeddingEngine();
  reloadVectorCache();

  // 1. /health and /ready probes
  const health = await invokeApp({ method: 'GET', url: '/health' });
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');

  const ready = await invokeApp({ method: 'GET', url: '/ready' });
  assert.equal(ready.status, 200);
  assert.equal(ready.body.ready, true);
  assert.ok(ready.body.vectorStore.chunksLoaded >= 1400);

  // 2. /api/languages & /api/nlp/check
  const langs = await invokeApp({ method: 'GET', url: '/api/languages' });
  assert.equal(langs.status, 200);
  assert.equal(langs.body.languages.length, 3);

  const nlpCheck = await invokeApp({
    method: 'POST',
    url: '/api/nlp/check',
    body: { text: 'my grape leaf have white spot wht spary', language: 'en' },
  });
  assert.equal(nlpCheck.status, 200);
  assert.equal(nlpCheck.body.hasChanges, true);
  assert.equal(nlpCheck.body.corrected, 'My grape leaves have white spots what should I spray?');

  // 3. Create test farmer & admin tokens
  const uid = uuidv4().slice(0, 8);
  const farmerId = `farmer-api-${uid}`;
  const adminId = `admin-api-${uid}`;
  createFarmer({
    id: farmerId,
    firebaseUid: `fb-api-${uid}`,
    name: 'Nashik Farmer',
    email: `nashik.${uid}@example.com`,
    preferredLanguage: 'mr',
    region: 'Nashik',
  });
  createAdmin({
    id: adminId,
    email: `admin.${uid}@example.com`,
    passwordHash: 'hash',
    fullName: 'Dr. Viticulture',
    role: 'admin',
  });

  const farmerToken = jwt.sign({ id: farmerId, type: 'farmer', email: `nashik.${uid}@example.com`, name: 'Nashik Farmer' }, JWT_SECRET, { expiresIn: '1h' });
  const adminToken = jwt.sign({ id: adminId, type: 'admin', role: 'admin', email: `admin.${uid}@example.com` }, JWT_SECRET, { expiresIn: '1h' });

  // 4. PATCH /api/auth/preferences (Vineyard profile + consent)
  const prefsRes = await invokeApp({
    method: 'PATCH',
    url: '/api/auth/preferences',
    headers: { Authorization: `Bearer ${farmerToken}` },
    body: {
      preferredLanguage: 'mr',
      region: 'Nashik',
      variety: 'Thompson Seedless',
      pruningType: 'गोडी बहार छाटणी',
      pruningDate: '2026-10-15',
      consentGiven: true,
    },
  });
  assert.equal(prefsRes.status, 200);
  assert.equal(prefsRes.body.preferences.region, 'Nashik');
  assert.equal(prefsRes.body.preferences.variety, 'Thompson Seedless');
  assert.equal(prefsRes.body.preferences.consentGiven, true);

  // 5. POST /api/chat (Marathi query with spelling typo -> auto-corrected + grounded RAG reply)
  const chatRes = await invokeApp({
    method: 'POST',
    url: '/api/chat',
    headers: { Authorization: `Bearer ${farmerToken}` },
    body: {
      text: 'पानावर पांढरा भुरी आली आहे कोनती फवारनी घ्याव',
      language: 'mr',
    },
  });
  assert.equal(chatRes.status, 200);
  assert.equal(chatRes.body.success, true);
  assert.equal(chatRes.body.language, 'mr');
  assert.equal(chatRes.body.correctedQuery, 'पानावर पांढरी भुरी आली आहे कोणती फवारणी घ्यावी?');
  assert.ok(chatRes.body.answer.length > 20);
  assert.ok(typeof chatRes.body.ragConfidence === 'number');

  // 6. POST /api/feedback (downvote to ensure message is in review queue for admin flow test)
  const fbRes = await invokeApp({
    method: 'POST',
    url: '/api/feedback',
    headers: { Authorization: `Bearer ${farmerToken}` },
    body: { messageId: chatRes.body.messageId, rating: -1 },
  });
  assert.equal(fbRes.status, 200);

  // 7. GET /api/admin/metrics (verify faqsByRegionAndLanguage and accuracyMetrics — PDF §7)
  const metricsRes = await invokeApp({
    method: 'GET',
    url: '/api/admin/metrics',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(metricsRes.status, 200);
  const m = metricsRes.body.metrics;
  assert.ok(Array.isArray(m.faqsByRegionAndLanguage));
  assert.ok(m.faqsByRegionAndLanguage.some((q) => q.region === 'Nashik'));
  assert.ok(m.accuracyMetrics);
  assert.ok(Array.isArray(m.accuracyMetrics.byLanguage));
  assert.ok(m.totals.kb_chunk_count >= 1400);

  // 8. Admin Review Approval -> Immediate KB Indexing -> Revocation
  const queueRes = await invokeApp({
    method: 'GET',
    url: '/api/admin/review-queue',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const ourItem = queueRes.body.queue.find((q) => q.user_query?.includes('भुरी'));
  assert.ok(ourItem, 'Downvoted farmer message should appear in pending review queue');

  const beforeChunks = ready.body.vectorStore.chunksLoaded;
  const approveRes = await invokeApp({
    method: 'POST',
    url: '/api/admin/review',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      queueId: ourItem.id,
      status: 'approved',
      correctedAnswer: 'भुरी नियंत्रणासाठी हेक्साकोनाझोल 5% SC @ 1 मि.ली./लिटर फवारावे.',
    },
  });
  assert.equal(approveRes.status, 200);

  const revokeRes = await invokeApp({
    method: 'POST',
    url: `/api/admin/review/${ourItem.id}/revoke`,
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(revokeRes.status, 200);
  assert.equal(revokeRes.body.revokedId, ourItem.id);
  assert.equal(revokeRes.body.activeChunks, beforeChunks);

  // 9. DELETE /api/auth/account (Data Privacy Right-to-Erasure — PDF §10)
  const delRes = await invokeApp({
    method: 'DELETE',
    url: '/api/auth/account',
    headers: { Authorization: `Bearer ${farmerToken}` },
  });
  assert.equal(delRes.status, 200);
  assert.equal(findFarmerById(farmerId), undefined);
  getDb().prepare('DELETE FROM admins WHERE id = ?').run(adminId);
});
