const fs = require('fs').promises;
const path = require('path');
const { stringify } = require('csv-stringify/sync');
const cron = require('node-cron');  // Import node-cron
const USERS_FILE = path.join(__dirname, 'users.csv');

// Function to check if a user has expired
function hasUserExpired(expirationDate) {
  if (!expirationDate) return false;

  const currentDate = new Date();
  const expiration = new Date(expirationDate);

  return currentDate > expiration;
}

console.log("Entered in the cron file");
// Function to remove expired users
async function removeExpiredUsers() {
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
      const expirationDate = user[6]; // expirationDate is stored in the 7th column
      return !hasUserExpired(expirationDate);
    });

    console.log("Cron Job inited");
    // Write valid users back to the CSV file
    const header = ['id', 'name', 'phone', 'package', 'password', 'delay', 'expirationDate', 'timePassed', 'role'];
    const updatedContent = stringify([header, ...validUsers], { header: false });

    await fs.writeFile(USERS_FILE, updatedContent);
    console.log(`✅ Expired users removed. ${validUsers.length} users remain.`);
  } catch (err) {
    console.error("❌ Error removing expired users:", err);
  }
}

// Schedule the cron job to run every day at midnight
cron.schedule('*/10 * * * *', () => {
  console.log('🕰️ Running cron job: Checking and removing expired users...');
  removeExpiredUsers();
});

// Optionally, you can add more frequent schedules, e.g., hourly
// cron.schedule('0 * * * *', () => { removeExpiredUsers(); });

