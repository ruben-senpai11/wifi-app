const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const { stringify } = require('csv-stringify/sync');
const cron = require('node-cron');  // Import node-cron
const USERS_FILE = path.join(__dirname, 'users.csv');
const TEKRADIUS_USERS_FILE = path.join(__dirname, 'TekRADIUS-User.csv');
const isWindows = process.platform === 'win32';
const { exec } = require('child_process');


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

// Function to check if a user has expired
function hasUserExpired(expirationDate) {
  if (!expirationDate) return false;

  const currentDate = new Date();
  const expiration = new Date(expirationDate);

  return currentDate > expiration;
}

console.log("Con Job Inited");

// Function to remove expired users
async function removeCsvUsers() {
  try {
    // Read users from CSV file
    const fileContent = await fs.readFile(USERS_FILE, 'utf8');
    let users = fileContent
      .trim()
      .split('\n')
      .slice(1)  // Skip header
      .map(line => line.split(','));

    // Filter out expired users
    const validUsers = users.filter(user => {
      const expirationDate = user[6]; // expirationDate is stored in the 7th 
      return !hasUserExpired(expirationDate);
    });

    // Write valid users back to the CSV file
    const header = ['id', 'name', 'phone', 'package', 'password', 'delay', 'expirationDate', 'timePassed', 'role', 'ip'];
    const updatedContent = stringify([header, ...validUsers], { header: false });

    await fs.writeFile(USERS_FILE, updatedContent);
    console.log(`✅ Users removed from Local database. ${validUsers.length} users remain.`);
  } catch (err) {
    console.error("❌ Error removing expired users:", err);
  }
}

// Schedule the cron job to run every day at midnight
cron.schedule('*/10 * * * *', () => {
  console.log('🕰️ Running cron job: Checking and removing expired users...');
  removeCsvUsers();
});

// Optionally, you can add more frequent schedules, e.g., hourly
// cron.schedule('0 * * * *', () => { removeCsvUsers(); });

