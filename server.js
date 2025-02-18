const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { stringify } = require('csv-stringify/sync');

const port = 2025;  // Use port 80 for captive portals
const USERS_FILE = path.join(__dirname, 'server/users.csv');

// Ensure file exists
async function ensureFileExists(filePath) {
  try {

    await fs.access(filePath);
    const content = await fs.readFile(filePath, 'utf8');

    if (!content.trim()) {
      await fs.writeFile(filePath, stringify([], { header: true, columns: ['id', 'name', 'phone', 'package', 'password', 'delay', 'expirationDate', 'timePassed'] }));
    }
  } catch {
    await fs.writeFile(filePath, stringify([], { header: true, columns: ['id', 'name', 'phone', 'package', 'password', 'delay', 'expirationDate', 'timePassed'] }));
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

// Register User API
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

    if (delay.includes('jour')) {  // if it's in days (e.g., '30 jours')
      const days = parseInt(delay);
      expirationDate.setDate(now.getDate() + days);
    } else if (delay.includes('h')) {  // if it's in hours (e.g., '120h')
      const hours = parseInt(delay);
      expirationDate.setHours(now.getHours() + hours);
    } else {
      // Default to no expiration if it doesn't match any known format
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

      if (!name || !phone || !package) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'All fields are required' }));
      }

      await ensureFileExists(USERS_FILE);
      let fileContent = await fs.readFile(USERS_FILE, 'utf8');

      let users = fileContent
        .trim()
        .split('\n')
        .slice(1) // Ignore the header when checking existing users
        .map(line => line.split(','));

      const cleanPhone = phone.replace(/\s+/g, '');
      if (users.some(user => user[2] === cleanPhone)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Ce numéro a déjà un forfait actif !' }));
      }

      const id = Date.now().toString();

      // Define the delay for each package (duration)
      const packageDelays = {
        'kwaabo': '2 heures',
        'waaba': '12h',
        'semaine': '24h',
        '2Semaines': '55h',
        'mois': '120h',
        'illimite': 'Illimité'
      };

      /*
      const packageDelays = {
        'kwaabo': '1 jour',
        'waaba': '3 jours',
        'semaine': '7 jours',
        '2Semaines': '14 jours',
        'mois': '30 jours',
        'illimite': '30 jours'
      };
      */


      const delay = packageDelays[package]; // Get the delay from the selected package
      const expirationDate = calculateExpirationDate(delay);
      const timePassed = expirationDate ? '0' : '0'; // Assuming time passed is 0 when registering

      const newUser = stringify([[id, name, cleanPhone, package, password, delay, expirationDate, timePassed]], { header: false });

      // Append the new user to the file
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


async function loginUser(req, res) {
  console.log("✅ Processing Login...");

  res.setHeader('Access-Control-Allow-Origin', '*');
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

      let users = fileContent
        .trim()
        .split('\n')
        .slice(1) // Skip header row
        .map(line => line.split(','));

      const cleanPhone = phone.replace(/\s+/g, '');
      const user = users.find(user => user[2] === cleanPhone && user[4] === password);

      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Numéro de téléphone ou mot de passe incorrect !' }));
      }

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


      const passedTime = user[7]>0 ? new Date(user[7]) : 0;
      const delay = parseInt(user[5]);
      const remainingTime = delay - (passedTime ? passedTime.getHours() : 0);


      /*
      if (expirationDate > currentDate) {
        const remainingTimeInMs = expirationDate - currentDate;
        const remainingTimeInHours = Math.floor(remainingTimeInMs / (1000 * 60 * 60)); // Convert ms to hours
        // const expirationHour = remainingTimeInHours.getHours();
        remainingTime = `${remainingTimeInHours} heures restantes`;
      } else {
        remainingTime = 'Expiré';
      }
      */

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


// Serve static frontend files
function serveStaticFiles(req, res) {
  let filePath = path.join(__dirname, req.url === '/' ? 'public/index.html' : req.url);
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
  } else {
    serveStaticFiles(req, res);
  }
});

// Bind server to WiFi network & local IP
server.listen(port, LOCAL_IP, () => {
  console.log(`🚀 Server running at http://${LOCAL_IP}:${port}`);
  console.log(`🌐 Access the portal at http://wifi.home:2025/`);
});
