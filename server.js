const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const { stringify } = require('csv-stringify/sync');

const port = 3000;
const USERS_FILE = path.join(__dirname, 'server/users.csv');
const RADIUS_USERS_FILE = path.join(__dirname, 'radius/users');
const RADIUS_CONTAINER = 'freeradius-1'; // Change this if your container has a different name
const RADIUS_SECRET = 'testing123';

async function ensureFileExists(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, stringify([], { header: true, columns: ['id', 'name', 'phone', 'package', 'password'] }));
  }
}

async function registerUser(req, res) {
  console.log("✅ Processing Registration...");

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
      const { name, phone, package } = JSON.parse(body);
      const password = Math.random().toString(36).slice(-8);

      if (!name || !phone || !package) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'All fields are required' }));
      }

      await ensureFileExists(USERS_FILE);
      let users = await fs.readFile(USERS_FILE, 'utf8');
      users = users.split('\n').filter(line => line).map(line => line.split(','));
      
      const cleanPhone = phone.replace(/\s+/g, '');
      if (users.some(user => user[2] === cleanPhone)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Phone number already registered' }));
      }

      const id = Date.now().toString();
      users.push([id, name, cleanPhone, package, password]);
      await fs.writeFile(USERS_FILE, stringify(users, { header: true, columns: ['id', 'name', 'phone', 'package', 'password'] }));

      // Add user to FreeRADIUS inside Docker
      const radiusEntry = `"${cleanPhone}" Cleartext-Password := "${password}"\n`;
      await fs.appendFile(RADIUS_USERS_FILE, radiusEntry);

      console.log("🔄 Restarting FreeRADIUS in Docker...");
      exec(`docker exec ${RADIUS_CONTAINER} service freeradius restart`, async (error, stdout, stderr) => {
        if (error || stderr) {
          console.error(`❌ FreeRADIUS restart error: ${error || stderr}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'FreeRADIUS failed to restart' }));
        }

        console.log("✅ FreeRADIUS restarted successfully!");
        
        // Verify user authentication
        exec(`docker exec ${RADIUS_CONTAINER} radtest "${cleanPhone}" "${password}" localhost 0 ${RADIUS_SECRET}`, (authError, authStdout, authStderr) => {
          if (authError || authStderr) {
            console.error(`❌ Authentication test failed: ${authError || authStderr}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'User registration failed authentication' }));
          }

          console.log("✅ User authenticated successfully!");
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Registration successful!', password }));
        });
      });
    } catch (err) {
      console.error("❌ Registration Error:", err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  });
}

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

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/register') {
    registerUser(req, res);
  } else {
    serveStaticFiles(req, res);
  }
});

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
server.listen(port, LOCAL_IP, () => {
  console.log(`🚀 Server running at http://${LOCAL_IP}:${port}`);
});
