const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { stringify } = require('csv-stringify/sync');
const net = require('net');

const port = 2025;
const USERS_FILE = path.join(__dirname, 'server/users.csv');
const TEKRADIUS_USERS_FILE = path.join(__dirname, 'server/TekRADIUS-User.csv');
const SALT_ROUNDS = 10;
const JWT_SECRET = 'e9ff19feccd320df5813ffbf02187c7f8ac1f25bada287cb7923fc245c87fd96'; // Use a strong secret key in production
const JWT_EXPIRATION = '1h'; // Session expires in one hour
const SESSION_COOKIE_NAME = 'session_token';

// --- Helper Functions ---

// Ensure the CSV file exists with headers.
async function ensureFileExists(filePath) {
  try {
    await fs.access(filePath);
    const content = await fs.readFile(filePath, 'utf8');
    if (!content.trim()) {
      await fs.writeFile(filePath, stringify([], { header: true, columns: ['id', 'name', 'phone', 'package', 'password', 'delay', 'expirationDate', 'timePassed', 'role'] }));
    }
  } catch {
    await fs.writeFile(filePath, stringify([], { header: true, columns: ['id', 'name', 'phone', 'package', 'password', 'delay', 'expirationDate', 'timePassed', 'role'] }));
  }
}


// --- Helper: Simple cookie parser (if not using a full library) ---
function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURI(parts.join('='));
  });
  return list;
}

// --- API Handlers ---

// Register User API (unchanged)
async function registerUser(req, res) {
  console.log("✅ Processing Registration...");

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  function generatePassword(length = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += chars[Math.floor(Math.random() * chars.length)];
    }
    return password;
  }

  function calculateExpirationDate(delay) {
    const now = new Date();
    let expirationDate = new Date(now);

    if (delay.includes('jour')) {
      const days = parseInt(delay);
      expirationDate.setDate(now.getDate() + days);
    } else if (delay.includes('h')) {
      const hours = parseInt(delay);
      expirationDate.setHours(now.getHours() + hours);
    } else {
      expirationDate = null;
    }

    return expirationDate ? expirationDate.toISOString() : null;
  }


  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', async () => {
    try {
      const { name, phone, package } = JSON.parse(body);

      const password = generatePassword(8);
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      if (!name || !phone || !package) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'All fields are required' }));
      }

      await ensureFileExists(USERS_FILE);
      let fileContent = await fs.readFile(USERS_FILE, 'utf8');
      let users = fileContent.trim().split('\n').slice(1).map(line => line.split(','));

      const cleanPhone = phone.replace(/\s+/g, '');
      if (users.some(user => user[2] === cleanPhone)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Ce numéro a déjà un forfait actif !' }));
      }

      const id = Date.now().toString();

      // Package delays
      const packageDelays = {
        'kwaabo': '2 heures',
        'waaba': '12h',
        'semaine': '24h',
        '2Semaines': '55h',
        'mois': '120h',
        'illimite': 'Illimité'
      };

      const delay = packageDelays[package];
      const expirationDate = calculateExpirationDate(delay);
      const timePassed = '0'; // Starting at 0

      const role = users.length === 0 ? 'admin' : 'user'; // First user becomes admin

      const newUser = stringify([[id, name, cleanPhone, package, hashedPassword, delay, expirationDate, timePassed, role]], { header: false });
      await fs.appendFile(USERS_FILE, newUser);


      // Ensure TekRADIUS user file exists
      await ensureFileExists(TEKRADIUS_USERS_FILE);

      // Append to TekRADIUS user file
      const radiusUser = `${phone},${password},User-Password,==,${password},Expiration,=${calculateExpirationDate(package)}\n`;
      await fs.appendFile(TEKRADIUS_USERS_FILE, radiusUser);

      console.log(`✅ User registered: ${cleanPhone}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Registration successful!', password }));
    } catch (err) {
      console.error("❌ Registration Error:", err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  });
}


// --- Login User API with improved security ---
async function loginUser(req, res) {
  console.log("✅ Processing Login...");

  res.setHeader('Access-Control-Allow-Origin', 'wifi.home'); // adjust as needed
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', async () => {
    try {
      const { phone, password } = JSON.parse(body);
      if (!phone || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'All fields are required' }));
      }

      await ensureFileExists(USERS_FILE);
      let fileContent = await fs.readFile(USERS_FILE, 'utf8');
      let users = fileContent.trim().split('\n').slice(1).map(line => line.split(','));
      const cleanPhone = phone.replace(/\s+/g, '');
      const user = users.find(user => user[2] === cleanPhone);

      if (!user || !(await bcrypt.compare(password, user[4]))) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Numéro de téléphone ou mot de passe incorrect !' }));
      }

      // Forwarding login requests to TekRADIUS
      const client = new net.Socket();
      client.connect(1812, '127.0.0.1', () => {
        client.write(`User-Name=${phone},User-Password=${password}`);
      });
      
      // For admin, create a JWT and set it as an HttpOnly cookie.
      const role = user[8];
      if (role === 'admin') {
        const token = jwt.sign({ id: user[0], role }, JWT_SECRET, { expiresIn: JWT_EXPIRATION });
        // For local testing over HTTP, we omit the Secure flag. In production (HTTPS), add Secure.
        res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          message: 'Login successful',
          redirect: 'dashboard'
        }));
      }

      // For non-admin users, return their info.
      console.log(`✅ User logged in: ${cleanPhone}`);

      // Define the packages with their corresponding titles, durations, and delays
      const packageDetails = {
        'kwaabo': { titre: 'Express', duree: '2 heures', delay: 2, expirationDate: 2, timePassed: 0 },
        'waaba': { titre: 'Habitué', duree: '12h', delay: 12, expirationDate: 12, timePassed: 0 },
        'semaine': { titre: 'Client Fidèle', duree: '24h', delay: 24, expirationDate: 24, timePassed: 0 },
        '2Semaines': { titre: 'Semaines (Client de la maison)', duree: '55h', delay: 55, expirationDate: 55, timePassed: 0 },
        'mois': { titre: 'Expert', duree: '120h', delay: 120, expirationDate: 120, timePassed: 0 },
        'illimite': { titre: 'Sans Limites', duree: 'Illimité', delay: -1, expirationDate: -1, timePassed: 0 }
      };

      const userPackage = user[3]; // Package is stored in user[3]
      const package = packageDetails[userPackage];

      if (!package) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Package not found' }));
      }

      // Retrieve expiration date and time passed from CSV data
      const expirationDate = new Date(user[6]);
      const frExpirationDate = expirationDate.toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false, // Ensures 24-hour format
      });

      const currentDate = new Date();

      let remainingTime = '';
      if (expirationDate > currentDate) {
        const remainingTimeInMs = expirationDate - currentDate;
        const remainingTimeInHours = Math.floor(remainingTimeInMs / (1000 * 60 * 60)); // Convert ms to hours
        // const expirationHour = remainingTimeInHours.getHours();
        remainingTime = `${remainingTimeInHours} heures restantes`;
      } else {
        remainingTime = 'Expiré';
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        message: 'Login successful',
        name: user[1],
        phone: user[2],
        package: user[3],
        titre: package.titre,
        duree: package.duree,
        remainingTime: remainingTime,
        expirationDate: frExpirationDate,
      }));
    } catch (err) {
      console.error("❌ Login Error:", err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  });
}


// Get All Users API (unchanged except for CORS settings)
async function getAllUsers(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'wifi.home');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    await ensureFileExists(USERS_FILE);
    const fileContent = await fs.readFile(USERS_FILE, 'utf8');
    let users = fileContent
      .trim()
      .split('\n')
      .slice(1)
      .map(line => line.split(','));

    const usersData = users.map(user => {
      let formattedExpirationDate = null;
      if (user[6]) {
        const expDate = new Date(user[6]);
        if (!isNaN(expDate)) {
          formattedExpirationDate = expDate.toLocaleString("fr-FR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          });
        }
      }
      return {
        id: user[0],
        name: user[1],
        phone: user[2],
        package: user[3],
        role: user[8],
        expirationDate: formattedExpirationDate,
        timePassed: user[7],
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ users: usersData }));
  } catch (err) {
    console.error("❌ Error fetching users:", err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
}


// --- Protected Dashboard Route ---
async function serveDashboard(req, res) {
  // Parse cookies from the request
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  console.log(token);
  if (!token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized: No session token' }));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Forbidden: Admins only' }));
    }
    // Serve the dashboard HTML if authenticated
    const filePath = path.join(__dirname, 'public/dashboard.html');
    const content = await fs.readFile(filePath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(content, 'utf8');
  } catch (err) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized: Invalid or expired token' }));
  }
}

// Logout API: Clears the session cookie
async function logoutUser(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'wifi.home'); // Adjust as needed
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Clear the cookie by setting an expired date.
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Logged out successfully' }));
}


// Serve static files (for other routes)
async function serveStaticFiles(req, res) {
  let filePath = path.join(__dirname, req.url === '/' ? 'public/index.html' : req.url);
  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.json': 'application/json'
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  try {
    // For images and other binary files, read as a buffer
    if (['.png', '.jpg', '.ico'].includes(ext)) {
      const content = await fs.readFile(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } else {
      const content = await fs.readFile(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/html' });
    res.end(err.code === 'ENOENT' ? '<h1>404 Page Not Found</h1>' : `Server Error: ${err.code}`, 'utf-8');
  }
}


// --- Create HTTP Server ---
const server = http.createServer((req, res) => {
  console.log(`Request received: ${req.method} ${req.url}`);
  if (req.method === 'POST' && req.url === '/register') {
    registerUser(req, res);
  } else if (req.method === 'POST' && req.url === '/login') {
    loginUser(req, res);
  } else if (req.method === 'GET' && req.url === '/users') {
    getAllUsers(req, res);
  } else if (req.method === 'GET' && req.url === '/dashboard') {
    serveDashboard(req, res);
  } else if (req.method === 'GET' && req.url === '/logout') {
    logoutUser(req, res);
  } else {
    serveStaticFiles(req, res);
  }
});


// Get the local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}
const LOCAL_IP = getLocalIP();


// Bind server to WiFi network & local IP
server.listen(port, LOCAL_IP, () => {
  console.log(`🚀 Server running at http://${LOCAL_IP}:${port}`);
  console.log(`🌐 Access the portal at http://wifi.home:2025/`);
});

