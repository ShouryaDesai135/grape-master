import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import {
  initVisionEngine,
  validateImageFile,
  analyzeImage,
  isVisionReady,
  isSubjectGateReady,
} from '../services/visionEngine.js';
import { structuredFallback, getSubjectFollowUpQuestions } from '../services/llmSynthesizer.js';
import {
  initDatabase,
  createFarmer,
  deleteFarmerAndData,
  createConversation,
  insertMessage,
  addToReviewQueue,
  submitReview,
  exportRetrainingDataset,
} from '../database.js';
import { runRetrainingPipeline } from '../scripts/retrain_pipeline.js';

const LEAF_IMAGE = 'C:/Users/Shourya/.gemini/antigravity/brain/a55d3e30-5b45-438c-b834-678386d89709/grape_powdery_leaf_1787062296171.jpg';
const SCREENSHOT_IMAGE = 'C:/Users/Shourya/.gemini/antigravity/brain/a55d3e30-5b45-438c-b834-678386d89709/media__1790164394682.png';

test('Vision Engine: validateImageFile checks real magic bytes and rejects fake images', async () => {
  const validLeaf = await validateImageFile(LEAF_IMAGE);
  assert.equal(validLeaf.valid, true);
  assert.equal(validLeaf.format, 'jpeg');

  const validPng = await validateImageFile(SCREENSHOT_IMAGE);
  assert.equal(validPng.valid, true);
  assert.equal(validPng.format, 'png');

  const fakeImg = path.join(os.tmpdir(), `fake_leaf_${Date.now()}.jpg`);
  fs.writeFileSync(fakeImg, 'This is plain text pretending to be a JPEG file');
  const invalidCheck = await validateImageFile(fakeImg);
  assert.equal(invalidCheck.valid, false);
  fs.unlinkSync(fakeImg);
});

test('Vision Engine: CLIP Subject Gate + 7-Class Leaf CNN classifies grape leaf vs non-crop screenshot', async () => {
  await initVisionEngine();
  assert.equal(isVisionReady(), true);
  assert.equal(isSubjectGateReady(), true);

  // 1. Real grape powdery mildew leaf -> routed to 7-class CNN
  const leafDiag = await analyzeImage(LEAF_IMAGE);
  assert.equal(leafDiag.subjectType, 'grape_leaf');
  assert.equal(leafDiag.notLeaf, false);
  assert.ok(leafDiag.prediction);
  assert.ok(Array.isArray(leafDiag.alternatives) && leafDiag.alternatives.length === 3);

  // 2. Non-crop UI screenshot -> gated by CLIP as 'other' (notLeaf: true)
  const screenDiag = await analyzeImage(SCREENSHOT_IMAGE);
  assert.equal(screenDiag.subjectType, 'other');
  assert.equal(screenDiag.notLeaf, true);
});

test('Structured Fallback: 3-bullet conversational structure + fruit/pest/soil follow-up questions', () => {
  const sampleChunks = [
    {
      question: 'पानांवर पांढरी भुरी दिसते आहे',
      answer: 'हेक्साकोनाझोल 5% SC @ 1 मि.ली./लिटर किंवा पाण्यात मिसळणारे सल्फर 80% WP @ 2 ग्रॅम/लिटर फवारावे.',
    },
    {
      question: 'भुरी प्रतिबंध कसा करावा?',
      answer: 'बागेत हवा खेळती राहील याची काळजी घ्यावी आणि अतिरिक्त नत्र देणे टाळावे.',
    },
  ];

  // Leaf diagnosis in Marathi -> 3 bullets
  const leafOut = structuredFallback(
    sampleChunks,
    { subjectType: 'grape_leaf', prediction: 'Powdery Mildew', confidence: 0.91 },
    'mr'
  );
  assert.match(leafOut, /• 🔍 \*\*निदान \/ आढावा:\*\*/);
  assert.match(leafOut, /• 💊 \*\*शिफारस केलेली फवारणी \/ उपाय:\*\*/);
  assert.match(leafOut, /• 🛡️ \*\*प्रतिबंधात्मक काळजी व टीप:\*\*/);

  // Berry bunch triage -> includes 3 clarifying questions in Marathi
  const berryOut = structuredFallback(
    sampleChunks,
    { subjectType: 'grape_berries', subjectLabel: 'Grape Berries / Bunch', confidence: 0.55, needsFollowUp: true },
    'mr'
  );
  assert.match(berryOut, /Grape Berries \/ Bunch/);
  assert.match(berryOut, /१\. मण्यांवर पुसली जाणारी पांढरी पावडर/);
  assert.match(berryOut, /२\. मणी तडकत आहेत/);

  // Soil triage -> includes soil-type follow-up questions in English
  const soilFollowUp = getSubjectFollowUpQuestions('soil', 'en');
  assert.match(soilFollowUp, /Black Cotton/);
  assert.match(soilFollowUp, /Calcareous/);
});

test('Retraining Pipeline & exportRetrainingDataset() SQL fix (PDF §5, §9)', async () => {
  initDatabase();
  const uid = uuidv4().slice(0, 8);
  const farmerId = `farmer-test-${uid}`;
  const convoId = `convo-test-${uid}`;
  const farmerMsgId = `fmsg-${uid}`;
  const botMsgId = `bmsg-${uid}`;

  createFarmer({
    id: farmerId,
    firebaseUid: `fb-${uid}`,
    name: 'Test Farmer',
    email: `farmer.${uid}@example.com`,
    preferredLanguage: 'mr',
    region: 'Nashik',
  });
  createConversation({ id: convoId, farmerId, title: 'भुरी प्रश्न', language: 'mr' });
  insertMessage({
    id: farmerMsgId,
    conversationId: convoId,
    sender: 'farmer',
    content: 'माझ्या द्राक्ष घडावर पांढरी बुरशी आली आहे कोणते औषध फवारावे?',
    imagePath: LEAF_IMAGE,
  });
  insertMessage({
    id: botMsgId,
    conversationId: convoId,
    sender: 'bot',
    content: 'Initial low confidence bot reply',
    cnnPrediction: 'Downy Mildew',
    cnnConfidence: 0.48,
    ragConfidence: 0.52,
    finalConfidence: 0.50,
    isFlagged: true,
    intent: 'treatment',
  });

  const qRow = addToReviewQueue({ messageId: botMsgId });
  const queueId = qRow.lastInsertRowid || qRow.id;
  submitReview({
    queueId,
    correctedAnswer: 'घडावरील भुरीसाठी मायक्लोबुटानिल 10% WP @ 0.4 ग्रॅम/लिटर फवारावे.',
    reviewedBy: null,
    status: 'approved',
    diagnosisWrong: true,
    correctedClass: 'powdery_mildew',
  });

  const exported = exportRetrainingDataset();
  const match = exported.find((r) => r.review_id === Number(queueId));
  assert.ok(match, 'Approved review should appear in exportRetrainingDataset()');
  // Verify the SQL fix: original_query MUST be the farmer's question, NOT the bot's reply!
  assert.equal(match.original_query, 'माझ्या द्राक्ष घडावर पांढरी बुरशी आली आहे कोणते औषध फवारावे?');
  assert.equal(match.bot_response, 'Initial low confidence bot reply');
  assert.equal(match.corrected_class, 'powdery_mildew');

  // Run retraining pipeline
  const summary = await runRetrainingPipeline({ ensureEmbedder: false });
  assert.ok(summary.approvedExpertReviews >= 1);
  assert.ok(summary.totalRelabeledImages >= 1);

  // Clean up test farmer data
  deleteFarmerAndData(farmerId);
});
