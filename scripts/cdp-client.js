const fs = require('fs');
const path = require('path');

const CDP_HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:9333';

async function getFerryPage() {
  const res = await fetch(`${CDP_HTTP}/json/list`);
  const pages = await res.json();
  const page = pages.find((p) => p.url.includes('5173') || p.title === 'Ferry');
  if (!page) {
    throw new Error('Could not find Ferry target page on ' + CDP_HTTP);
  }
  return page;
}

class CdpConnection {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 1;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.callbacks.has(data.id)) {
        const { resolve, reject } = this.callbacks.get(data.id);
        this.callbacks.delete(data.id);
        if (data.error) {
          reject(new Error(data.error.message || JSON.stringify(data.error)));
        } else {
          resolve(data.result);
        }
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function withClient(fn) {
  const page = await getFerryPage();
  const client = new CdpConnection(page.webSocketDebuggerUrl);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

async function evalInPage(client, expression) {
  const res = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (res.exceptionDetails) {
    const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text || JSON.stringify(res.exceptionDetails);
    throw new Error(desc);
  }
  return res.result?.value;
}

async function main() {
  const [,, cmd, ...args] = process.argv;

  if (!cmd || cmd === 'help') {
    console.log(`Usage: node scripts/cdp-client.js <command> [args]
Commands:
  screenshot <outPath>             - Capture screenshot to PNG file
  eval <jsCode>                    - Evaluate JS expression in renderer
  dom                              - Dump text structure and interactive elements
  click <selector>                 - Click element matching querySelector
  type <selector> <text>           - Set value of input and dispatch input/change events
  key <keyName>                    - Dispatch keyboard event (e.g. Escape, Enter, Tab)
  hotkey <ctrl/meta/alt> <key>     - Dispatch key combo (e.g. Control k)
`);
    return;
  }

  await withClient(async (client) => {
    if (cmd === 'screenshot') {
      const outPath = args[0] || 'screenshot.png';
      const resolved = path.resolve(outPath);
      const fsDir = path.dirname(resolved);
      if (!fs.existsSync(fsDir)) fs.mkdirSync(fsDir, { recursive: true });
      const res = await client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(resolved, Buffer.from(res.data, 'base64'));
      console.log(`Saved screenshot to: ${resolved}`);
    } else if (cmd === 'eval') {
      const code = args.join(' ');
      const val = await evalInPage(client, code);
      console.log(typeof val === 'object' ? JSON.stringify(val, null, 2) : val);
    } else if (cmd === 'dom') {
      const info = await evalInPage(client, `(() => {
        const title = document.title;
        const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
          text: b.innerText.trim() || b.getAttribute('aria-label') || b.title || b.className,
          visible: b.offsetParent !== null,
          disabled: b.disabled
        }));
        const inputs = Array.from(document.querySelectorAll('input, select, textarea')).map(i => ({
          tag: i.tagName.toLowerCase(),
          type: i.type,
          placeholder: i.placeholder,
          value: i.value,
          visible: i.offsetParent !== null
        }));
        const modals = Array.from(document.querySelectorAll('[role="dialog"], .dialog, [aria-modal="true"]')).map(m => ({
          title: m.querySelector('h2, h3, [role="heading"]')?.innerText || 'Untitled Dialog',
          visible: m.offsetParent !== null
        }));
        return {
          title,
          url: location.href,
          buttons: buttons.filter(b => b.visible),
          inputs: inputs.filter(i => i.visible),
          modals: modals.filter(m => m.visible),
          bodySnippet: document.body.innerText.slice(0, 1000)
        };
      })()`);
      console.log(JSON.stringify(info, null, 2));
    } else if (cmd === 'click') {
      const sel = args[0];
      const clicked = await evalInPage(client, `(() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return { found: false };
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { found: true, tag: el.tagName, text: el.innerText };
      })()`);
      console.log('Click result:', clicked);
    } else if (cmd === 'type') {
      const sel = args[0];
      const text = args.slice(1).join(' ');
      const typed = await evalInPage(client, `(() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return { found: false };
        el.focus();
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { found: true, value: el.value };
      })()`);
      console.log('Type result:', typed);
    } else if (cmd === 'key') {
      const key = args[0];
      await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key });
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key });
      console.log(`Dispatched key: ${key}`);
    } else if (cmd === 'hotkey') {
      const modifier = args[0]; // 'Control', 'Alt', 'Shift', 'Meta'
      const key = args[1];
      let modifiers = 0;
      if (modifier.toLowerCase().includes('ctrl') || modifier.toLowerCase().includes('control')) modifiers |= 2;
      if (modifier.toLowerCase().includes('alt')) modifiers |= 1;
      if (modifier.toLowerCase().includes('shift')) modifiers |= 8;
      if (modifier.toLowerCase().includes('meta')) modifiers |= 4;

      await client.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers, key });
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key });
      console.log(`Dispatched hotkey: ${modifier}+${key}`);
    } else {
      console.error(`Unknown command: ${cmd}`);
    }
  });
}

main().catch(err => {
  console.error('CDP Client Error:', err);
  process.exit(1);
});
