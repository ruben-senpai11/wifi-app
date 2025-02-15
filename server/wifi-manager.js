const fs = require("fs");
const path = require("path");

const USERS_FILE = path.join(__dirname, "users.csv");
const RADIUS_USERS_FILE = path.join(__dirname, "radius/users");

// Sync the users.csv with FreeRADIUS users file
const syncUsers = () => {
  const users = fs.readFileSync(USERS_FILE, "utf8").split("\n").filter(Boolean);
  const radiusUsers = users.map(line => {
    const [name, email, phone, package, password] = line.split(",");
    return `${phone}  Cleartext-Password := "${password}"`;
  }).join("\n");

  fs.writeFileSync(RADIUS_USERS_FILE, radiusUsers);
  console.log("FreeRADIUS users updated.");
};

syncUsers();
