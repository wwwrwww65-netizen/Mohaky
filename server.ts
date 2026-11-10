import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets directly (css, js, images, zip, etc.)
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/img', express.static(path.join(__dirname, 'img')));

// Session simulation state for the MikroTik Hotspot
interface SessionState {
  isLoggedIn: boolean;
  username: string;
  speed: string;
  domain: string;
  bytesIn: number;
  bytesOut: number;
  remainBytes: number;
  startTime: number;
  ip: string;
  mac: string;
}

let sessionState: SessionState = {
  isLoggedIn: false,
  username: '777723089',
  speed: '512K/1M',
  domain: '512K/1M|0|pm|all|*no**|non***',
  bytesIn: 18454937,
  bytesOut: 75239424,
  remainBytes: 2147483648, // 2 GB
  startTime: Date.now() - 3600000,
  ip: '192.168.88.25',
  mac: '44:65:7F:8A:2B:11',
};

// Variable to store card string for auto-login when applying services from status.html
let pendingAutoLogin: string | null = null;

// Periodic simulated byte counter increment
setInterval(() => {
  if (sessionState.isLoggedIn) {
    sessionState.bytesIn += Math.floor(Math.random() * 50000) + 10000;
    sessionState.bytesOut += Math.floor(Math.random() * 120000) + 25000;
    if (sessionState.remainBytes > 0) {
      sessionState.remainBytes = Math.max(0, sessionState.remainBytes - 130000);
    }
  }
}, 2000);

// Helper for human-readable byte formats
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

// Helper for uptime format
function getUptimeString(startTime: number): string {
  const diffSecs = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(diffSecs / 3600);
  const minutes = Math.floor((diffSecs % 3600) / 60);
  const seconds = diffSecs % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// Function to render MikroTik template with variables dynamically without touching files on disk
function renderMikrotikTemplate(filePath: string, req: express.Request): string {
  let content = fs.readFileSync(filePath, 'utf-8');

  const uptime = getUptimeString(sessionState.startTime);
  const bytesInNice = formatBytes(sessionState.bytesIn);
  const bytesOutNice = formatBytes(sessionState.bytesOut);
  const remainBytesNice = formatBytes(sessionState.remainBytes);
  const errorMsg = (req.query.error as string) || '';

  // Process MikroTik conditionals $(if ...)...$(endif)
  if (errorMsg) {
    content = content.replace(/\$\(if error\)([\s\S]*?)\$\(endif\)/gi, '$1');
  } else {
    content = content.replace(/\$\(if error\)[\s\S]*?\$\(endif\)/gi, '');
  }

  content = content.replace(/\$\(if chap-id\)[\s\S]*?\$\(endif\)/gi, '');
  content = content.replace(/\$\(if refresh-timeout\)[\s\S]*?\$\(endif\)/gi, '');
  content = content.replace(/\$\(if advert-pending == 'yes'\)[\s\S]*?\$\(endif\)/gi, '');
  content = content.replace(/\$\(if login-by == 'trial'\)[\s\S]*?\$\(endif\)/gi, '');
  content = content.replace(/\$\(if session-time-left\)[\s\S]*?\$\(endif\)/gi, '');
  content = content.replace(/\$\(if blocked == 'yes'\)[\s\S]*?\$\(endif\)/gi, '');
  content = content.replace(/\$\(if popup == 'true'\)[\s\S]*?\$\(endif\)/gi, '');
  content = content.replace(/\$\(if popup\)[\s\S]*?\$\(endif\)/gi, '');
  content = content.replace(/\$\(if login-by-mac != 'yes'\)/gi, '');
  content = content.replace(/\$\(if login-by == 'trial'\)/gi, '');
  content = content.replace(/\$\(elif\s+[^)]+\)/gi, '');
  content = content.replace(/\$\(else\)/gi, '');
  content = content.replace(/\$\(endif\)/gi, '');

  // Replace MikroTik variables
  const replacements: Record<string, string> = {
    'http://a.com': '/status',
    'a.com': 'status',
    '$(link-login)': pendingAutoLogin && filePath.endsWith('logout.html')
      ? `/login?username=${encodeURIComponent(pendingAutoLogin)}`
      : '/login',
    '$(link-login-only)': '/login',
    '$(link-status)': '/status',
    '$(link-logout)': '/logout',
    '$(link-orig)': '/status',
    '$(link-orig-esc)': '/status',
    '$(link-redirect)': '/status',
    '$(link-redirect-esc)': '/status',
    '$(username)': (filePath.endsWith('login.html') || filePath.endsWith('index.html'))
      ? (sessionState.isLoggedIn ? sessionState.username : '')
      : sessionState.username,
    '$(uptime)': uptime,
    '$(bytes-in-nice)': bytesInNice,
    '$(bytes-out-nice)': bytesOutNice,
    '$(bytes-in)': String(sessionState.bytesIn),
    '$(bytes-out)': String(sessionState.bytesOut),
    '$(limit-bytes-total)': String(sessionState.bytesIn + sessionState.bytesOut + sessionState.remainBytes),
    '$(remain-bytes-total-nice)': remainBytesNice,
    '$(remain-bytes-total)': String(sessionState.remainBytes),
    '$(session-time-left)': '4h 15m',
    '$(ip)': sessionState.ip,
    '$(mac)': sessionState.mac,
    '$(domain)': sessionState.domain,
    '$(error)': errorMsg,
    '$(hostname)': 'a.net',
  };

  for (const [key, val] of Object.entries(replacements)) {
    content = content.split(key).join(val);
  }

  // Clean any remaining unparsed MikroTik $(...) variable tags safely without touching JavaScript code
  content = content.replace(/\$\([a-zA-Z0-9_-]+\)/g, '');

  // In-memory fallback if HTML uses onclick="return rem();" without modifying any files on disk
  if (content.includes('rem()')) {
    const remScript = '<script>if(typeof window.rem!=="function"){window.rem=function(){if(typeof saveVoucher==="function")saveVoucher();if(typeof saveSpeed==="function")saveSpeed();return true;};}</script>';
    if (content.includes('</head>')) {
      content = content.replace('</head>', remScript + '</head>');
    } else if (content.includes('</body>')) {
      content = content.replace('</body>', remScript + '</body>');
    } else {
      content = remScript + content;
    }
  }

  return content;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const list: Record<string, string> = {};
  if (!header) return list;
  header.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (name) {
      const rawVal = rest.join('=').trim();
      try {
        list[name] = decodeURIComponent(rawVal);
      } catch (e) {
        list[name] = rawVal;
      }
    }
  });
  return list;
}

// /login routes (GET and POST)
function handleAuth(rawUser: string, rawSpeed: string, req: express.Request, res: express.Response) {
  let user = (rawUser || '777723089').trim();
  let domain = '512K/1M|0|pm|all|*no**|non***';
  let speed = rawSpeed || '512K/1M';

  // Decode URI components if encoded (e.g. from hotCookie or query string)
  try {
    user = decodeURIComponent(user);
  } catch (e) {}

  // If username contains the MikroTik domain suffix from rem(): e.g. "777723089@1M/4M|0|pm|all|*yes**|non***"
  if (user.includes('@')) {
    const parts = user.split('@');
    user = parts[0];
    domain = parts[1];
    speed = domain.split('|')[0];
  } else if (speed.startsWith('@')) {
    domain = speed.slice(1);
    speed = domain.split('|')[0];
  }

  const cleanUser = user.trim();

  // Test Card 1: Used on another device (الكرت مستخدم في جهاز آخر)
  if (cleanUser === '999' || cleanUser.toLowerCase().includes('used')) {
    return res.redirect('/login?error=simultaneous%20session%20limit%20reached');
  }

  // Test Card 2: Expired card / uptime limit (انتهى رصيد هذا الكرت)
  if (cleanUser === '888' || cleanUser.toLowerCase().includes('expired')) {
    return res.redirect('/login?error=uptime%20limit%20reached');
  }

  // Test Card 3: Profile expired (انتهت صلاحية الرصيد)
  if (cleanUser === '777' || cleanUser.toLowerCase().includes('profile')) {
    return res.redirect('/login?error=no%20valid%20profile%20found');
  }

  // Test Card 4: User not found (المستخدم غير موجود)
  if (cleanUser === '000' || cleanUser.toLowerCase().includes('notfound')) {
    return res.redirect('/login?error=user%20not%20found');
  }

  // Test Card 5: Tied to another MAC (مخصص لجهاز آخر)
  if (cleanUser === '111' || cleanUser.toLowerCase().includes('mac')) {
    return res.redirect('/login?error=invalid%20Calling-Station-Id');
  }

  sessionState.isLoggedIn = true;
  sessionState.username = user;
  sessionState.speed = speed;
  sessionState.domain = domain;
  sessionState.startTime = Date.now();
  pendingAutoLogin = null;

  res.cookie('hotspot_is_logged_in', '1', { path: '/' });
  res.cookie('uname', encodeURIComponent(user + (domain ? '@' + domain : '')), { path: '/', maxAge: 259200000 });

  // Serve intermediary page alogin.html as per README.md lifecycle map
  const aloginPath = path.join(__dirname, 'alogin.html');
  if (fs.existsSync(aloginPath)) {
    const rendered = renderMikrotikTemplate(aloginPath, req);
    return res.setHeader('Content-Type', 'text/html; charset=UTF-8').send(rendered);
  }
  return res.redirect('/status');
}

// /login routes (GET and POST)
app.get(['/login', '/login.html'], (req, res) => {
  const isCallBack = req.query.var === 'callBack';
  if (isCallBack) {
    return res.json({
      logged_in: sessionState.isLoggedIn ? 'yes' : 'no',
      username: sessionState.username,
      mac: sessionState.mac,
      ip: sessionState.ip,
      uptime: getUptimeString(sessionState.startTime),
      bytes_in: String(sessionState.bytesIn),
      bytes_out: String(sessionState.bytesOut),
      remain_bytes_total: String(sessionState.remainBytes),
      remain_bytes_total_nice: formatBytes(sessionState.remainBytes),
    });
  }

  // Support direct GET login as used by hotCookie.min.js (login?username=...&password=...)
  if (req.query.username) {
    return handleAuth(req.query.username as string, (req.query.speed as string) || '', req, res);
  }

  // If pending auto-login is set from service customizer, re-authenticate immediately
  if (pendingAutoLogin && !req.query.error && req.query.stay !== 'true') {
    return handleAuth(pendingAutoLogin, '', req, res);
  }

  // If no error parameter, check if browser has a valid stored card in cookies from rem()
  const cookies = parseCookies(req.headers.cookie);
  const cookieUname = cookies['uname'] || cookies['uname_raw'];
  const hasError = req.query.error;

  if (cookieUname && cookieUname !== '' && !hasError && req.query.stay !== 'true') {
    return handleAuth(cookieUname, '', req, res);
  }

  const loginFile = path.join(__dirname, 'login.html');
  if (fs.existsSync(loginFile)) {
    const rendered = renderMikrotikTemplate(loginFile, req);
    return res.setHeader('Content-Type', 'text/html; charset=UTF-8').send(rendered);
  }
  return res.status(404).send('login.html not found');
});

app.post(['/login', '/login.html'], (req, res) => {
  const username = (req.body.username as string) || (req.query.username as string) || '777723089';
  const speed = (req.body.speed as string) || (req.query.speed as string) || '';
  return handleAuth(username, speed, req, res);
});

// /status routes
app.get(['/status', '/status.html'], (req, res) => {
  const isCallBack = req.query.var === 'callBack';
  if (isCallBack) {
    return res.json({
      logged_in: sessionState.isLoggedIn ? 'yes' : 'no',
      username: sessionState.username,
      mac: sessionState.mac,
      ip: sessionState.ip,
      uptime: getUptimeString(sessionState.startTime),
      bytes_in: String(sessionState.bytesIn),
      bytes_out: String(sessionState.bytesOut),
      bytes_in_nice: formatBytes(sessionState.bytesIn),
      bytes_out_nice: formatBytes(sessionState.bytesOut),
      remain_bytes_total: String(sessionState.remainBytes),
      remain_bytes_total_nice: formatBytes(sessionState.remainBytes),
    });
  }

  const statusFile = path.join(__dirname, 'status.html');
  if (fs.existsSync(statusFile)) {
    const rendered = renderMikrotikTemplate(statusFile, req);
    return res.setHeader('Content-Type', 'text/html; charset=UTF-8').send(rendered);
  }
  return res.status(404).send('status.html not found');
});

// /logout routes with intermediary logout.html page as per README.md
app.all(['/logout', '/logout.html'], (req, res) => {
  const isApplying = req.query.apply_services === '1' || req.body?.apply_services === '1';
  let targetUname = (req.query.uname as string) || (req.body?.uname as string) || '';

  if (!targetUname) {
    const cookies = parseCookies(req.headers.cookie);
    targetUname = cookies['uname'] || cookies['uname_raw'] || '';
  }

  if (isApplying || (targetUname && targetUname !== '' && !req.query.disconnect && req.query.stay !== 'true')) {
    try {
      targetUname = decodeURIComponent(targetUname);
    } catch (e) {}
    pendingAutoLogin = targetUname;
    if (targetUname.includes('@')) {
      const parts = targetUname.split('@');
      sessionState.username = parts[0];
      sessionState.domain = parts[1];
      sessionState.speed = parts[1].split('|')[0];
    }
    res.cookie('uname', encodeURIComponent(targetUname), { path: '/', maxAge: 259200000 });
  } else {
    // Normal logout or disconnect
    pendingAutoLogin = null;
    sessionState.isLoggedIn = false;
    res.clearCookie('hotspot_is_logged_in', { path: '/' });
    res.clearCookie('uname', { path: '/' });
    res.clearCookie('uname_raw', { path: '/' });
  }

  const logoutFile = path.join(__dirname, 'logout.html');
  if (fs.existsSync(logoutFile)) {
    const rendered = renderMikrotikTemplate(logoutFile, req);
    return res.setHeader('Content-Type', 'text/html; charset=UTF-8').send(rendered);
  }
  return res.redirect('/login');
});

// /alogin and /rlogin routes with intermediary alogin.html as per README.md
app.all(['/alogin', '/alogin.html'], (req, res) => {
  const aloginPath = path.join(__dirname, 'alogin.html');
  if (fs.existsSync(aloginPath)) {
    const rendered = renderMikrotikTemplate(aloginPath, req);
    return res.setHeader('Content-Type', 'text/html; charset=UTF-8').send(rendered);
  }
  return res.redirect('/status');
});

app.get(['/rlogin', '/rlogin.html'], (req, res) => {
  const rloginPath = path.join(__dirname, 'rlogin.html');
  if (fs.existsSync(rloginPath)) {
    return res.sendFile(rloginPath);
  }
  res.redirect('/login');
});

// Root URL handler
app.get(['/', '/index.html'], (req, res) => {
  if (sessionState.isLoggedIn) {
    return res.redirect('/status');
  }
  const targetFile = (req.path === '/index.html' && fs.existsSync(path.join(__dirname, 'index.html')))
    ? path.join(__dirname, 'index.html')
    : (fs.existsSync(path.join(__dirname, 'login.html')) ? path.join(__dirname, 'login.html') : path.join(__dirname, 'index.html'));
  if (fs.existsSync(targetFile)) {
    const rendered = renderMikrotikTemplate(targetFile, req);
    return res.setHeader('Content-Type', 'text/html; charset=UTF-8').send(rendered);
  }
  return res.status(404).send('Portal not found');
});

// Serve any other static files/directories placed in root (css, js, img, assets, fonts, etc.) after template routes
app.use(express.static(__dirname, { index: false }));

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Hotspot Server] Running on http://0.0.0.0:${PORT}`);
});

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Hotspot Server] Port ${PORT} already in use.`);
  } else {
    console.error('[Hotspot Server] Server error:', err);
  }
});

process.on('uncaughtException', (err) => {
  console.error('[Hotspot Server] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Hotspot Server] Unhandled Rejection at:', promise, 'reason:', reason);
});
