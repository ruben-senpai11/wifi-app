const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const { stringify } = require('csv-stringify/sync');

const port = 3000;
const USERS_FILE = path.join(__dirname, 'server/users.csv');
const RADIUS_USERS_FILE = path.join(__dirname, 'radius', 'users');

async function ensureFileExists(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, stringify([], { header: true, columns: ['id', 'name', 'phone', 'password'] }));
  }
}

async function registerUser(req, res) {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  
  req.on('end', async () => {
    try {
      const { name, phone } = JSON.parse(body);
      const password = Math.random().toString(36).slice(-8); // Generate a random password
      const sanitizedPhone = phone.replace(/\s+/g, ''); // Remove spaces from phone number

      if (!name || !sanitizedPhone) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'All fields are required' }));
      }

      await ensureFileExists(USERS_FILE);
      let users = await fs.readFile(USERS_FILE, 'utf8');
      users = users.split('\n').filter(line => line).map(line => line.split(','));

      if (users.find(user => user[0] === sanitizedPhone)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'User already exists' }));
      }

      users.push([sanitizedPhone, name, password]);
      await fs.writeFile(USERS_FILE, stringify(users, { header: true, columns: ['id', 'name', 'password'] }));

      // Add user credentials to FreeRADIUS users file
      const radiusEntry = `"${sanitizedPhone}" Cleartext-Password := "${password}"\n`; 
      await fs.appendFile(RADIUS_USERS_FILE, radiusEntry);

      exec('systemctl restart freeradius', (error, stdout, stderr) => {
        if (error) console.error(`❌ Error restarting FreeRADIUS: ${error.message}`);
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Registration successful!', password }));
    } catch (err) {
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

  fs.readFile(filePath)
    .then(content => {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    })
    .catch(err => {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/html' });
      res.end(err.code === 'ENOENT' ? '<h1>404 Page not found!</h1>' : `Server Error: ${err.code}`, 'utf-8');
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
