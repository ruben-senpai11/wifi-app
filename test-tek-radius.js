const radius = require("radius");
const dgram = require("dgram");

const RADIUS_SERVER = "192.168.1.100"; // Change to your TekRADIUS IP
const RADIUS_PORT = 1812;
const SHARED_SECRET = "myTekSecret"; // Get from TekRADIUS settings
const USERNAME = "testuser";
const PASSWORD = "testpass";

const packet = radius.encode({
  code: "Access-Request",
  secret: SHARED_SECRET,
  attributes: [
    ["User-Name", USERNAME],
    ["User-Password", PASSWORD],
    ["NAS-IP-Address", "127.0.0.1"],
  ],
});

const client = dgram.createSocket("udp4");

client.send(packet, 0, packet.length, RADIUS_PORT, RADIUS_SERVER, (err) => {
  if (err) console.error("Error:", err);
  else console.log("✅ TekRADIUS authentication request sent!");
  client.close();
});
