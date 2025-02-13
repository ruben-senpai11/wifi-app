const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { stringify } = require('csv-stringify/sync');

const port = 3000;
const USERS_FILE = path.join(__dirname, 'users.csv');

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/register') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const { name, email, phone } = JSON.parse(body);
        if (!name || !email || !phone) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'All fields are required' }));
          return;
        }

        const id = Date.now().toString();
        const newUser = { id, name, email, phone };

        let users = [];
        if (fs.existsSync(USERS_FILE)) {
          users = fs.readFileSync(USERS_FILE, 'utf8')
            .split('\n')
            .filter(line => line)
            .map(line => line.split(','));
        }

        if (!users.find(user => user[1] === email)) {
          users.push([id, name, email, phone]);
          fs.writeFileSync(USERS_FILE, stringify(users, { header: true, columns: ['id', 'name', 'email', 'phone'] }));
          console.log(`✅ User ${name} added to ${USERS_FILE}`);

          // Run wifi-manager.js
          exec('node wifi-manager.js', (error, stdout, stderr) => {
            if (error) console.error(`❌ Error running wifi-manager.js: ${error.message}`);
            if (stdout) console.log(stdout);
            if (stderr) console.error(stderr);
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Registration successful!' }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'User already exists' }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    });
  } else {
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    const ext = path.extname(filePath);
    let contentType = 'text/html';
    if (ext === '.css') contentType = 'text/css';
    if (ext === '.js') contentType = 'text/javascript';
    if (ext === '.png') contentType = 'image/png';
    if (ext === '.jpg') contentType = 'image/jpeg';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end('<h1>404 Page non trouvée !</h1>', 'utf-8');
        } else {
          res.writeHead(500);
          res.end('Server Error: ' + err.code, 'utf-8');
        }
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });
  }
});

server.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
