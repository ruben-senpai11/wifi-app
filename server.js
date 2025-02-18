const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const bcrypt = require('bcrypt');
const { stringify, parse } = require('csv-stringify/sync');

const port = 2025;
const USERS_FILE = path.join(__dirname, 'server/users.csv');
const SALT_ROUNDS = 10;
require('./server/usersCleaner.js')

// Ensure file exists and setup the header for CSV
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

// Register User API with encrypted passwords and role management
async function registerUser(req, res) {
  console.log("✅ Processing Registration...");

  res.setHeader('Access-Control-Allow-Origin', 'wifi.home');
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

      const password = generatePassword(8); // Generates a secure 8-character password
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

      // Define package delays
      const packageDelays = {
        'kwaabo': '2 heures',
        'waaba': '12h',
        'semaine': '24h',
        '2Semaines': '55h',
        'mois': '120h',
        'illimite': 'Illimité'
      };

      const delay = packageDelays[package]; // Get the delay from the selected package
      const expirationDate = calculateExpirationDate(delay);
      const timePassed = expirationDate ? '0' : '0'; // Assuming time passed is 0 when registering

      const role = users.length === 0 ? 'admin' : 'user'; // First user is admin, others are user

      const newUser = stringify([[id, name, cleanPhone, package, hashedPassword, delay, expirationDate, timePassed, role]], { header: false });

      await fs.appendFile(USERS_FILE, newUser);

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

// Login User API with encrypted password validation and role-based redirect
async function loginUser(req, res) {
  console.log("✅ Processing Login...");

  res.setHeader('Access-Control-Allow-Origin', 'wifi.home');
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

      // console.log(`✅ User logged in: ${cleanPhone}`);

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

      const expirationDate = new Date(user[6]);
      const frExpirationDate = expirationDate.toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });

      const passedTime = user[7] > 0 ? new Date(user[7]) : 0;
      const remainingTime = parseInt(user[5]) - (passedTime ? passedTime.getHours() : 0);

      // Role-based redirect
      const role = user[8]; // User's role from the CSV
      if (role === 'admin') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          message: 'Login successful',
          redirect: 'dashboard', // Redirect to admin dashboard
        }));
      } else {
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
      }

    } catch (err) {
      console.error("❌ Login Error:", err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  });
}

// Get All Users API
async function getAllUsers(req, res) {
  //console.log("✅ Fetching all users...");

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
      .slice(1) // Ignore the header when getting users
      .map(line => line.split(','));const usersData = users.map(user => {
        // Ensure expirationDate is a valid Date object
        let formattedExpirationDate = null;
        if (user[6]) {
          const expirationDate = new Date(user[6]);
          if (!isNaN(expirationDate)) {
            formattedExpirationDate = expirationDate.toLocaleString("fr-FR", {
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
          expirationDate: formattedExpirationDate, // Now this will be formatted properly or null if invalid
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


// Serve static frontend files
function serveStaticFiles(req, res) {
  let filePath = path.join(__dirname, req.url === '/' ? 'public/index.html' : req.url);

  if (req.url === '/dashboard') {
    filePath = path.join(__dirname, 'public/dashboard.html');
  }

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
  };
  const contentType = mimeTypes[ext] || 'text/plain';

  fs.readFile(filePath, 'utf-8')
    .then(content => {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    })
    .catch(err => {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/html' });
      res.end(err.code === 'ENOENT' ? '<h1>404 Page Not Found</h1>' : `Server Error: ${err.code}`, 'utf-8');
    });
}


// Create HTTP server
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/register') {
    registerUser(req, res);
  } else if (req.method === 'POST' && req.url === '/login') {
    loginUser(req, res);
  } else if (req.method === 'GET' && req.url === '/users') {
    getAllUsers(req, res);
  } else {
    serveStaticFiles(req, res);
  }
});

// Bind server to WiFi network & local IP
server.listen(port, LOCAL_IP, () => {
  console.log(`🚀 Server running at http://${LOCAL_IP}:${port}`);
  console.log(`🌐 Access the portal at http://wifi.home:2025/`);
});

