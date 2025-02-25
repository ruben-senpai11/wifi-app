
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
      
      // NEW: Track active user login time for timePassed updates.
      activeUsers[cleanPhone] = { loginTime: Date.now(), clientIP: clientIP };

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

  // NEW: Remove active user(s) matching the current client's IP.
  for (const phone in activeUsers) {
    if (activeUsers[phone].clientIP === req.socket.remoteAddress) {
      delete activeUsers[phone];
    }
  }

  // Clear the cookie by setting an expired date.
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Logged out successfully' }));
}
