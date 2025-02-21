const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { stringify } = require('csv-stringify/sync');
const net = require('net');
const { exec } = require('child_process');
const isWindows = process.platform === 'win32';

require('./server/usersCleaner')

const port = 2025;
const USERS_FILE = path.join(__dirname, 'server/users.csv');
const ALLTIME_USERS_FILE = path.join(__dirname, 'server/allTimeUsers.csv');
const SALT_ROUNDS = 10;
const JWT_SECRET = 'e9ff19feccd320df5813ffbf02187c7f8ac1f25bada287cb7923fc245c87fd96'; // Use a strong secret key in production
const JWT_EXPIRATION = '1h'; // Session expires in one hour
const SESSION_COOKIE_NAME = 'session_token';


/**
 * Blocks internet access for all clients.
 * For Linux: Uses sudo iptables to drop any forwarded packets whose destination is not the server's local IP.
 * For Windows: Uses netsh to add a firewall rule blocking outbound traffic.
 */
function blockAllClients() {
  if (isWindows) {
    // Windows: Block all outbound traffic (you may need to specify the WiFi adapter/profile as needed).
    exec(`netsh advfirewall firewall add rule name="BlockAllClients" dir=out action=block remoteip=any`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error blocking traffic on Windows: ${error.message}`);
        return;
      }
      console.log('🚫 All client internet access blocked (Windows).');
    });
  } else {
    // Linux: Get local IP and block all traffic not destined for it.
    const localIP = getLocalIP();
    // Corrected command: Place "!" before -d and specify /32 for the single IP.
    exec(`sudo iptables -I FORWARD -s 0.0.0.0/0 ! -d ${localIP}/32 -j DROP`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error blocking traffic: ${error.message}`);
        return;
      }
      console.log('🚫 All client internet access blocked.');
    });
  }
}


/**
 * Allows internet access for a specific client IP.
 * For Linux: Removes the DROP rule for that client.
 * For Windows: Adds an allow rule for that client which takes precedence.
 *
 * @param {string} clientIP - The client's IP address to unblock.
 */
function allowClient(clientIP) {
  if (isWindows) {
    // Windows: Add a rule to allow outbound traffic for the specific client IP.
    exec(`netsh advfirewall firewall add rule name="AllowClient ${clientIP}" dir=out action=allow remoteip=${clientIP}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error allowing traffic for ${clientIP} on Windows: ${error.message}`);
        return;
      }
      console.log(`✅ Internet access allowed for ${clientIP} (Windows)`);
    });
  } else {
    const localIP = getLocalIP();
    // Linux: Remove the DROP rule for the specific client IP.
    exec(`sudo iptables -D FORWARD -s ${clientIP} ! -d ${localIP}/32 -j DROP`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error unblocking traffic for ${clientIP}: ${error.message}`);
        return;
      }
      console.log(`✅ Internet access allowed for ${clientIP}`);
    });
  }
}

/**
 * (Optional) Blocks internet access for a specific client IP.
 * This function can be used if you need to re-block an individual client.
 *
 * @param {string} clientIP - The client's IP address to block.
 */
function blockClient(clientIP) {
  if (isWindows) {
    // Windows: Add a rule to block outbound traffic for the specific client IP.
    exec(`netsh advfirewall firewall add rule name="BlockClient ${clientIP}" dir=out action=block remoteip=${clientIP}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error blocking traffic for ${clientIP} on Windows: ${error.message}`);
        return;
      }
      console.log(`🚫 Internet access blocked for ${clientIP} (Windows)`);
    });
  } else {
    const localIP = getLocalIP();
    exec(`sudo iptables -I FORWARD -s ${clientIP} ! -d ${localIP}/32 -j DROP`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error blocking traffic for ${clientIP}: ${error.message}`);
        return;
      }
      console.log(`🚫 Internet access blocked for ${clientIP}`);
    });
  }
}

// --- Helper Functions ---

// Ensure the CSV file exists with headers.
async function ensureFileExists(filePath) {
  try {
    await fs.access(filePath);
    const content = await fs.readFile(filePath, 'utf8');
    if (!content.trim()) {
      await fs.writeFile(filePath, stringify([], { header: true, columns: ['id', 'name', 'phone', 'package', 'password', 'delay', 'expirationDate', 'timePassed', 'role', 'ip'] }));
    }
  } catch {
    await fs.writeFile(filePath, stringify([], { header: true, columns: ['id', 'name', 'phone', 'package', 'password', 'delay', 'expirationDate', 'timePassed', 'role', 'ip'] }));
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
      console.log("delay in hour: ", hours);
      console.log("now in hour: ", now.getHours());
      expirationDate.setHours(now.getHours() + hours);
      console.log("the sum: ", now.getHours() + hours);
      console.log("will return: ", expirationDate.toISOString());
    } else {
      expirationDate = null;
    }

    return expirationDate ? expirationDate.toISOString() : null;
  }
/*
  function ProceedPayment(name, phone, amount, package) {

    // Initialize FedaPay widget
    let widget = FedaPay.init({
      public_key: 'pk_live_YSlxSSpIrQssqOUVEOSD-iNe'
    });

    // Pass dynamic attributes to FedaPay widget
    widget.open({
      transaction: {
        amount: parseInt(amount),
        description: `Forfait: ${package}`,
      },
      customer: {
        lastname: name,
        phone_number: phone,
      }
    });

    console.log("Payment data:", {
      name: name,
      phone: phone,
      amount: amount,
      package: package
    });
  }
*/
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', async () => {
    try {
      const { name, phone, amount, package } = JSON.parse(body);

      //ProceedPayment(name, phone, amount, package)

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
        return res.end(JSON.stringify({ error: 'Ce numéro a déjà un forfait actif ! Vous pouvez en écrire un autre' }));
      }

      const id = Date.now().toString();

      // Package delays
      const packageDelays = {
        'kwaabo': '1 jour',
        'waaba': '3 jours',
        'semaine': '7 jours',
        '2Semaines': '14 jours',
        'mois': '30 jours',
        'illimite': '30 jours'
      };

      const delay = packageDelays[package];
      const expirationDate = calculateExpirationDate(delay);
      const timePassed = '0'; // Starting at 0

      const role = users.length === 0 ? 'admin' : 'user'; // First user becomes admin

      const clientIP = req.socket.remoteAddress; // or req.connection.remoteAddress depending on your Node version
      console.log("clientIP: ", clientIP);
      const newUser = stringify([[id, name, cleanPhone, package, hashedPassword, delay, expirationDate, timePassed, role, clientIP]], { header: false });
      await fs.appendFile(USERS_FILE, newUser);

      // Ensure ALLTIME user file exists
      await ensureFileExists(ALLTIME_USERS_FILE);
      // Append to ALLTIME user file
      await fs.appendFile(ALLTIME_USERS_FILE, newUser);

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

      // At the end of a successful login in your loginUser function:
      const clientIP = req.socket.remoteAddress; // or req.connection.remoteAddress depending on your Node version
      console.log("clientIP: ", clientIP);
      allowClient(clientIP);

      // Define the packages with their corresponding titles, durations, and delays
      const packageDetails = {
        'kwaabo': { titre: 'Express', duree: '2 heures', delay: 2, timePassed: 0 },
        'waaba': { titre: 'Habitué', duree: '12h', delay: 12, timePassed: 0 },
        'semaine': { titre: 'Client Fidèle', duree: '24h', delay: 24, timePassed: 0 },
        '2Semaines': { titre: 'Semaines (Client de la maison)', duree: '55h', delay: 55, timePassed: 0 },
        'mois': { titre: 'Expert', duree: '120h', delay: 120, timePassed: 0 },
        'illimite': { titre: 'Sans Limites', duree: 'Illimité', delay: -1, timePassed: 0 }
      };

      const userPackage = user[3]; // Package is stored in user[3]
      const package = packageDetails[userPackage];

      if (!package) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Package not found' }));
      }

      // Retrieve expiration date and time passed from CSV data
      const delay = new Date(user[5]);
      const expirationDate = new Date(user[6]);
      const passedTime = user[7];
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

      console.log("passedTime: ", passedTime);
      let remainingTime = 0;
      if (passedTime <= 0) {
        remainingTime = user[5]
        console.log("remainingTime ! 0: ", remainingTime);
      }
      else if (expirationDate > currentDate) {
        const remainingTimeDefault = expirationDate - passedTime;
        const remainingTimeInMs = expirationDate - currentDate;
        const remainingTimeInHours = Math.floor(remainingTimeInMs / (1000 * 60 * 60)); 
        // const expirationHour = remainingTimeInHours.getHours();
        remainingTime = remainingTimeDefault.toLocaleString("fr-FR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false, // Ensures 24-hour format;
        })
        console.log("remainingTime ! calculated: ", remainingTime);
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
        delay: user[5],
        expirationDate: formattedExpirationDate,
        timePassed: user[7],
        clientIP: user[9]
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
  console.log("token: ", token);
  if (!token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: "Vous n'êtes pas autorisé à voir cette page ! Veuillez-vous connecter à nouveau si vous êtes l'administrateur " }));
  } else {

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
      return res.end(JSON.stringify({ error: "Vous n'êtes pas autorisé à voir cette page ! Veuillez-vous connecter à nouveau si vous êtes l'administrateur " }));
  }
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
    '.svg': 'image/svg',
    '.json': 'application/json'
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  try {
    // For images and other binary files, read as a buffer
    if (['.png', '.jpg', '.ico', '.svg'].includes(ext)) {
      const content = await fs.readFile(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } else {
      const content = await fs.readFile(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  } catch (err) {
    const filePath = path.join(__dirname, 'public/404.html');
    const content = await fs.readFile(filePath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(content, 'utf8');
  }
}


// --- Create HTTP Server ---
const server = http.createServer((req, res) => {
  console.log(`Request received: ${req.method} ${req.url}`);
  if (req.method === 'POST' && req.url === '/register') {
    registerUser(req, res);
  } else if (req.method === 'POST' && req.url === '/login') {
    loginUser(req, res);
  } else if (req.method === 'GET' && (req.url === '/users' || req.url === '/public/users')) {
    getAllUsers(req, res);
  } else if (req.method === 'GET' && (req.url === '/dashboard.html' || req.url === '/public/dashboard.html')) {
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
  blockAllClients();
});

