const fs = require('fs');
const crypto = require('crypto');
const csv = require('csv-parser');
const { stringify } = require('csv-stringify/sync');

const USERS_FILE = 'users.csv';
const CREDENTIALS_FILE = 'credentials.csv';
const RADIUS_FILE = 'radius_users.csv';

function loadCSV(file) {
    if (!fs.existsSync(file)) return [];
    return new Promise((resolve, reject) => {
        const data = [];
        fs.createReadStream(file)
            .pipe(csv())
            .on('data', (row) => data.push(row))
            .on('end', () => resolve(data))
            .on('error', reject);
    });
}

function saveCSV(file, data, headers) {
    const csvData = stringify(data, { header: true, columns: headers });
    fs.writeFileSync(file, csvData);
}

function generatePassword() {
    return crypto.randomBytes(8).toString('hex');
}

async function updateCredentials() {
    const users = await loadCSV(USERS_FILE);
    let credentials = await loadCSV(CREDENTIALS_FILE);
    let credentialsMap = new Map(credentials.map((user) => [user.id, user]));

    const updatedCredentials = [];
    const updatedRadius = [];

    for (const user of users) {
        if (!credentialsMap.has(user.id)) {
            user.password = generatePassword();
            console.log(`✅ New user added: ${user.name}, Password: ${user.password}`);
        } else {
            user.password = credentialsMap.get(user.id).password;
        }
        updatedCredentials.push(user);
        updatedRadius.push({ username: user.name, password: user.password });
    }

    saveCSV(CREDENTIALS_FILE, updatedCredentials, ['id', 'name', 'password']);
    saveCSV(RADIUS_FILE, updatedRadius, ['username', 'password']);

    console.log("🔄 WiFi credentials updated successfully.");
}

// Run the update function
updateCredentials().catch(console.error);
