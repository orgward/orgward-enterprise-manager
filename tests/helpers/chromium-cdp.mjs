import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readDevToolsPort(profile, child) {
  const activePort = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Chromium exited before opening DevTools (${child.exitCode}).`);
    try {
      const [port] = (await readFile(activePort, 'utf8')).trim().split('\n');
      if (/^\d+$/.test(port ?? '')) return Number(port);
    } catch { /* Chromium has not written its ephemeral DevTools port yet. */ }
    await sleep(50);
  }
  throw new Error('Timed out waiting for Chromium DevTools port.');
}

export async function withHeadlessChromium(url, run, { sessionId = null } = {}) {
  const profile = await mkdtemp(path.join(tmpdir(), 'orgward-chromium-'));
  const chrome = process.env.CHROME_BIN || '/usr/bin/google-chrome';
  const child = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--disable-background-networking', '--disable-extensions', '--no-first-run',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
  ], { detached: true, stdio: 'ignore' });
  let socket;
  try {
    const port = await readDevToolsPort(profile, child);
    const targetsResponse = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await targetsResponse.json();
    const target = targets.find((entry) => entry.type === 'page');
    if (!target?.webSocketDebuggerUrl) throw new Error('Chromium did not expose a page target.');

    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result ?? {});
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Browser evaluation failed.');
      return result.result?.value;
    };
    const waitFor = async (expression, description, timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await sleep(50);
      }
      throw new Error(`Timed out waiting for browser condition: ${description}`);
    };
    const press = async (key, code, windowsVirtualKeyCode) => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode });
      if (key === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', key, code, text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    const setSession = async (value) => {
      if (!value) throw new Error('A persisted OIDC session is required for the browser journey.');
      const cookie = await send('Network.setCookie', { name: 'ow_session', value,
        url: new URL(url).origin, httpOnly: true, sameSite: 'Lax' });
      if (!cookie.success) throw new Error('Chromium rejected the test OIDC session cookie.');
    };
    if (sessionId) await setSession(sessionId);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init = {}) => {
        const requestUrl = typeof input === 'string' ? input : input.url;
        return originalFetch(input, init).then((response) => {
          const pathname = new URL(requestUrl, location.href).pathname;
          if (pathname.endsWith('/intent-evaluation-acceptances')) {
            try { window.__orgwardAcceptanceRequest = JSON.parse(init.body); } catch { /* The response assertion reports missing request data. */ }
            response.clone().json().then((body) => { window.__orgwardAcceptanceResponse = body; });
          }
          if (pathname.endsWith('/process-run-evidence-reviews')) {
            try { window.__orgwardReviewRequest = JSON.parse(init.body); } catch { /* The response assertion reports missing request data. */ }
            response.clone().json().then((body) => { window.__orgwardReviewResponse = body; });
          }
          if (pathname === '/auth/session') response.clone().json()
            .then((body) => { window.__orgwardSessionResponse = body; });
          return response;
        });
      };
    })();` });
    await send('Page.navigate', { url });
    await waitFor("document.readyState === 'complete' && document.querySelector('#sdlc-app')", 'SDLC page load');
    await run({ send, evaluate, waitFor, press, setSession });
  } finally {
    try { socket?.close(); } catch { /* Chromium shutdown is best effort after assertions. */ }
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* The browser may already have exited. */ }
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        sleep(1500),
      ]);
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* The process group is already gone. */ }
    }
    await rm(profile, { recursive: true, force: true });
  }
}
