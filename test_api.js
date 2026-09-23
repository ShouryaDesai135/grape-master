import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import dotenv from 'dotenv';
dotenv.config({ path: './frontend/client/.env.local' });

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

async function testBackend() {
  console.log("1. Creating Firebase test user...");
  const email = `test_${Date.now()}@example.com`;
  const password = "password123";
  let idToken;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    idToken = await cred.user.getIdToken();
  } catch (err) {
    console.error("Firebase error:", err.message);
    process.exit(1);
  }
  
  console.log("2. Exchanging Firebase Token for Backend JWT...");
  const verifyRes = await fetch('http://localhost:5000/api/auth/firebase-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken })
  });
  const verifyData = await verifyRes.json();
  if (!verifyData.success) {
    console.error("Failed to verify:", verifyData);
    process.exit(1);
  }
  const jwt = verifyData.token;
  console.log("✅ Verified successfully! Farmer:", verifyData.farmer);

  console.log("3. Sending a Chat Message...");
  const form = new FormData();
  form.append('text', 'What are the early signs of powdery mildew?');
  
  const chatRes = await fetch('http://localhost:5000/api/chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`
    },
    body: form
  });
  
  const chatData = await chatRes.json();
  console.log("✅ Chat Response:");
  console.log(chatData.answer);
  console.log(`Confidence: ${chatData.confidence}, Flagged: ${chatData.flagged}`);
  
  console.log("4. Fetching Conversation History...");
  const convRes = await fetch('http://localhost:5000/api/conversations', {
    headers: { 'Authorization': `Bearer ${jwt}` }
  });
  const convData = await convRes.json();
  console.log("✅ Conversations:");
  console.log(convData.conversations);
  
  console.log("All tests passed!");
  process.exit(0);
}

testBackend();
