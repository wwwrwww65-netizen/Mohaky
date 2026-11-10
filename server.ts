import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Port 3000 is required for AI Studio dev server. Avoid process.env.PORT which may be 8080 in container runtime
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve any static files/directories placed in root (css, js, img, assets, fonts, etc.)
app.use(express.static(__dirname));

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

// Variable to store card string for auto-login when applying services
let pendingAutoLogin: string | null = null;

// Periodic simulated byte counter increment when logged in
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

// Parse incoming HTTP Cookies
function parseCookies(header: string | undefined): Record<string, string> {
  const list: Record<string, string> = {};
  if (!header) return list;
  header.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.split('=');
    const trimmed = name?.trim();
    if (trimmed) {
      const rawVal = rest.join('=').trim();
      try {
        list[trimmed] = decodeURIComponent(rawVal);
      } catch (e) {
        list[trimmed] = rawVal;
      }
    }
  });
  return list;
}

// Function to render MikroTik template with variables dynamically
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

  // Replace MikroTik standard variables
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
    '$(username)': sessionState.username,
    '$(uptime)': uptime,
    '$(bytes-in-nice)': bytesInNice,
    '$(bytes-out-nice)': bytesOutNice,
    '$(bytes-in)': String(sessionState.bytesIn),
    '$(bytes-out)': String(sessionState.bytesOut),
    '$(remain-bytes-total-nice)': remainBytesNice,
    '$(remain-bytes-total)': String(sessionState.remainBytes),
    '$(session-time-left)': '4h 15m',
    '$(ip)': sessionState.ip,
    '$(mac)': sessionState.mac,
    '$(domain)': sessionState.domain,
    '$(error)': errorMsg,
  };

  for (const [key, val] of Object.entries(replacements)) {
    content = content.split(key).join(val);
  }

  // Clean any remaining unparsed MikroTik $(...) variable tags safely without touching JavaScript code
  content = content.replace(/\$\([a-zA-Z0-9_-]+\)/g, '');

  return content;
}

// Fallback HTML Dashboard when user hasn't yet provided login.html
function getSimulatorDashboardHtml(req: express.Request): string {
  const errorParam = (req.query.error as string) || '';
  const currentStatus = sessionState.isLoggedIn ? 'متصل (Logged In)' : 'غير متصل (Disconnected)';
  const statusBadgeColor = sessionState.isLoggedIn ? '#10b981' : '#f59e0b';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>محاكي شبكات ميكروتك - MikroTik Hotspot Simulator</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #0f172a;
      color: #f1f5f9;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px 16px;
    }
    .container {
      width: 100%;
      max-width: 820px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .header-card {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .badge {
      align-self: flex-start;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      animation: pulse 1.8s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
      70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }
    h1 { font-size: 24px; font-weight: 700; color: #f8fafc; }
    p.lead { color: #94a3b8; font-size: 15px; line-height: 1.6; }
    
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 14px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .card-title {
      font-size: 17px;
      font-weight: 600;
      color: #38bdf8;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
    }
    .stat-item {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .stat-label { font-size: 12px; color: #94a3b8; }
    .stat-val { font-size: 15px; font-weight: 600; color: #f1f5f9; direction: ltr; text-align: right; }
    
    .test-form {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }
    .input-text {
      flex: 1;
      min-width: 180px;
      background: #0f172a;
      border: 1px solid #475569;
      color: #fff;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
    }
    .input-text:focus { border-color: #38bdf8; }
    .btn {
      padding: 10px 18px;
      border-radius: 8px;
      border: none;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .btn-primary { background: #38bdf8; color: #0f172a; }
    .btn-primary:hover { background: #0284c7; color: #fff; }
    .btn-danger { background: #ef4444; color: #fff; }
    .btn-danger:hover { background: #dc2626; }
    .btn-secondary { background: #334155; color: #f8fafc; }
    .btn-secondary:hover { background: #475569; }

    .files-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 10px;
    }
    .file-badge {
      background: #0f172a;
      border: 1px dashed #475569;
      border-radius: 8px;
      padding: 10px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #cbd5e1;
    }
    .file-badge code { color: #38bdf8; font-weight: 600; font-family: monospace; }
    
    .chips-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 6px;
    }
    .chip {
      background: #0f172a;
      border: 1px solid #334155;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      color: #94a3b8;
      text-decoration: none;
      cursor: pointer;
    }
    .chip:hover { border-color: #38bdf8; color: #38bdf8; }
    
    .alert-error {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-card">
      <div class="badge">
        <span class="badge-dot"></span>
        سيرفر المحاكي قيد التشغيل (Port 3000)
      </div>
      <h1>محاكي بوابات ميكروتك هوتسبوت (MikroTik Hotspot Simulator)</h1>
      <p class="lead">
        تم إفراغ ملفات المشروع السابق بنجاح، والسيرفر يعمل الآن كمحاكي مستقل بالكامل وجاهز لاستقبال ملفات مشروعك الجديد. بمجرد إضافة ملفات الهوتسبوت الجديدة (مثل <code>login.html</code> أو <code>status.html</code> أو مجلدات التنسيقات)، سيتم عرضها وتشغيلها ومحاكاتها تلقائياً وبشكل فوري!
      </p>
    </div>

    ${errorParam ? `
    <div class="alert-error">
      ⚠️ رسالة خطأ الميكروتك المحاكية: <strong>${errorParam}</strong>
    </div>` : ''}

    <div class="card">
      <div class="card-title">
        <span>⚡ حالة جلسة الميكروتك المحاكية الحالية</span>
        <span style="font-size: 12px; color: ${statusBadgeColor}; margin-right: auto;">${currentStatus}</span>
      </div>
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-label">المستخدم ($(username))</span>
          <span class="stat-val">${sessionState.username}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">عنوان الأي بي ($(ip))</span>
          <span class="stat-val">${sessionState.ip}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">عنوان الماك ($(mac))</span>
          <span class="stat-val">${sessionState.mac}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">وقت الاتصال ($(uptime))</span>
          <span class="stat-val">${getUptimeString(sessionState.startTime)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">التنزيل ($(bytes-out-nice))</span>
          <span class="stat-val">${formatBytes(sessionState.bytesOut)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">الرصيد المتبقي</span>
          <span class="stat-val">${formatBytes(sessionState.remainBytes)}</span>
        </div>
      </div>

      <div style="margin-top: 10px; display: flex; gap: 10px; flex-wrap: wrap;">
        ${sessionState.isLoggedIn ? `
          <a href="/logout" class="btn btn-danger">تسجيل خروج ($(link-logout))</a>
        ` : `
          <form action="/login" method="POST" class="test-form" style="width: 100%;">
            <input type="text" name="username" class="input-text" placeholder="أدخل رقم الكرت (مثال: 777723089)" value="777723089" required />
            <input type="hidden" name="speed" value="512K/1M" />
            <button type="submit" class="btn btn-primary">تجربة تسجيل الدخول ($(link-login))</button>
          </form>
        `}
      </div>

      <div style="margin-top: 10px;">
        <span style="font-size: 13px; color: #94a3b8;">كروت تجريبية لمحاكاة أخطاء الميكروتك:</span>
        <div class="chips-container">
          <a href="/login?username=999" class="chip">كرت 999 (مستخدم بجهاز آخر)</a>
          <a href="/login?username=888" class="chip">كرت 888 (انتهاء الوقت/الرصيد)</a>
          <a href="/login?username=777" class="chip">كرت 777 (انتهاء صلاحية البروفايل)</a>
          <a href="/login?username=000" class="chip">كرت 000 (مستخدم غير موجود)</a>
          <a href="/login?username=111" class="chip">كرت 111 (مقيد بجهاز آخر)</a>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">📁 الملفات المتوافقة مع المحاكي عند إضافتها:</div>
      <div class="files-list">
        <div class="file-badge">📄 <code>login.html</code> صفحة الدخول الأساسية</div>
        <div class="file-badge">📊 <code>status.html</code> صفحة بيانات الجلسة</div>
        <div class="file-badge">🚪 <code>logout.html</code> صفحة تسجيل الخروج</div>
        <div class="file-badge">🔀 <code>alogin.html</code> صفحة التحويل بعد الدخول</div>
        <div class="file-badge">📢 <code>radvert.html</code> صفحة الإعلانات</div>
        <div class="file-badge">📡 <code>rlogin.html</code> بروتوكول WISPr</div>
        <div class="file-badge">🎨 مجلدات <code>css/</code> و <code>js/</code> و <code>img/</code></div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// Fallback HTML Status page when user hasn't yet provided status.html
function getSimulatorStatusHtml(): string {
  const uptime = getUptimeString(sessionState.startTime);
  const bytesInNice = formatBytes(sessionState.bytesIn);
  const bytesOutNice = formatBytes(sessionState.bytesOut);
  const remainBytesNice = formatBytes(sessionState.remainBytes);

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>حالة الاتصال - MikroTik Hotspot</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f1f5f9; padding: 24px 16px; display: flex; justify-content: center; }
    .box { width: 100%; max-width: 600px; background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
    h2 { font-size: 20px; color: #38bdf8; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    td { padding: 10px; border-bottom: 1px solid #334155; font-size: 14px; }
    td:last-child { direction: ltr; text-align: right; font-weight: 600; color: #38bdf8; }
    .btn { padding: 10px 20px; border-radius: 8px; border: none; font-weight: 600; cursor: pointer; text-decoration: none; text-align: center; }
    .btn-danger { background: #ef4444; color: #fff; }
    .btn-back { background: #334155; color: #f8fafc; }
  </style>
</head>
<body>
  <div class="box">
    <h2>معلومات اتصال الهوتسبوت (Status)</h2>
    <table>
      <tr><td>اسم المستخدم ($(username))</td><td>${sessionState.username}</td></tr>
      <tr><td>عنوان الأي بي ($(ip))</td><td>${sessionState.ip}</td></tr>
      <tr><td>عنوان الماك ($(mac))</td><td>${sessionState.mac}</td></tr>
      <tr><td>وقت الاتصال ($(uptime))</td><td>${uptime}</td></tr>
      <tr><td>استهلاك التنزيل ($(bytes-out-nice))</td><td>${bytesOutNice}</td></tr>
      <tr><td>استهلاك الرفع ($(bytes-in-nice))</td><td>${bytesInNice}</td></tr>
      <tr><td>الرصيد المتبقي ($(remain-bytes-total-nice))</td><td>${remainBytesNice}</td></tr>
    </table>
    <div style="display: flex; gap: 10px; margin-top: 10px;">
      <a href="/logout" class="btn btn-danger" style="flex: 1;">تسجيل خروج</a>
      <a href="/login" class="btn btn-back" style="flex: 1;">العودة للرئيسية</a>
    </div>
  </div>
</body>
</html>`;
}

// Authentication processor for GET & POST logins
function handleAuth(rawUser: string, rawSpeed: string, req: express.Request, res: express.Response) {
  let user = (rawUser || '777723089').trim();
  let domain = '512K/1M|0|pm|all|*no**|non***';
  let speed = rawSpeed || '512K/1M';

  // Decode URI components if encoded
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

  // Serve intermediary page alogin.html if present
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

  // Support direct GET login as used by MikroTik and hotCookie (login?username=...&password=...)
  if (req.query.username) {
    return handleAuth(req.query.username as string, (req.query.speed as string) || '', req, res);
  }

  // If pending auto-login is set from service customizer, re-authenticate immediately
  if (pendingAutoLogin && !req.query.error && req.query.stay !== 'true') {
    return handleAuth(pendingAutoLogin, '', req, res);
  }

  // If no error parameter, check if browser has a valid stored card in cookies
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
  
  // Return the Simulator Dashboard if login.html is not yet created
  return res.setHeader('Content-Type', 'text/html; charset=UTF-8').send(getSimulatorDashboardHtml(req));
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
  
  return res.setHeader('Content-Type', 'text/html; charset=UTF-8').send(getSimulatorStatusHtml());
});

// /logout routes
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

// /alogin and /rlogin routes
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
    const statusFile = path.join(__dirname, 'status.html');
    if (fs.existsSync(statusFile)) {
      return res.redirect('/status');
    }
  }
  const loginFile = path.join(__dirname, 'login.html');
  if (fs.existsSync(loginFile)) {
    const rendered = renderMikrotikTemplate(loginFile, req);
    return res.setHeader('Content-Type', 'text/html; charset=UTF-8').send(rendered);
  }
  return res.setHeader('Content-Type', 'text/html; charset=UTF-8').send(getSimulatorDashboardHtml(req));
});

// Simulator API endpoints for tests or inspection
app.get('/api/session', (req, res) => {
  res.json({
    sessionState,
    uptime: getUptimeString(sessionState.startTime),
    bytesInNice: formatBytes(sessionState.bytesIn),
    bytesOutNice: formatBytes(sessionState.bytesOut),
    remainBytesNice: formatBytes(sessionState.remainBytes),
  });
});

app.post('/api/session/reset', (req, res) => {
  sessionState.isLoggedIn = false;
  sessionState.username = '777723089';
  sessionState.bytesIn = 1000000;
  sessionState.bytesOut = 5000000;
  sessionState.remainBytes = 2147483648;
  sessionState.startTime = Date.now();
  pendingAutoLogin = null;
  res.clearCookie('hotspot_is_logged_in', { path: '/' });
  res.clearCookie('uname', { path: '/' });
  res.json({ success: true, message: 'Session reset successfully' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[MikroTik Hotspot Simulator] Running on http://0.0.0.0:${PORT}`);
});

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[MikroTik Hotspot Simulator] Port ${PORT} already in use. Please check running processes.`);
  } else {
    console.error('[MikroTik Hotspot Simulator] Server error:', err);
  }
});

process.on('uncaughtException', (err) => {
  console.error('[MikroTik Hotspot Simulator] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[MikroTik Hotspot Simulator] Unhandled Rejection at:', promise, 'reason:', reason);
});
