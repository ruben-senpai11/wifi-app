
/**
 * Blocks internet access for all clients.
 * For Linux: Uses sudo iptables to drop any forwarded packets whose destination is not the server's local IP.
 * For Windows: Uses netsh to add a firewall rule blocking outbound traffic.
 */
function blockAllClients() {
  if (isWindows) {
    // Windows: Block all outbound traffic (you may need to specify the WiFi adapter/profile as needed).
    exec(`netsh advfirewall firewall add rule name="BlockAllClients" dir=out action=block remoteip=0.0.0.0/0`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error blocking traffic on Windows: ${error.message}`);
        return;
      }
      console.log('🚫 All client internet access blocked (Windows).');
    });
  } else {
    // Linux: Get local IP and block all traffic not destined for it.
    const localIP = getLocalIP();
    // Corrected command: Place "!" before -d and specify /32 for the single IP.
    exec(`sudo iptables -I FORWARD -s 0.0.0.0/0 ! -d ${localIP}/32 -j DROP`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error blocking traffic: ${error.message}`);
        return;
      }
      console.log('🚫 All client internet access blocked.');
    });
  }
}


/**
 * Allows internet access for a specific client IP.
 * For Linux: Removes the DROP rule for that client.
 * For Windows: Adds an allow rule for that client which takes precedence.
 *
 * @param {string} clientIP - The client's IP address to unblock.
 */
function allowClient(clientIP) {
  if (isWindows) {
    // Windows: Add a rule to allow outbound traffic for the specific client IP.
    exec(`netsh advfirewall firewall add rule name="AllowClient ${clientIP}" dir=out action=allow remoteip=${clientIP}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error allowing traffic for ${clientIP} on Windows: ${error.message}`);
        return;
      }
      console.log(`✅ Internet access allowed for ${clientIP} (Windows)`);
    });
  } else {
    const localIP = getLocalIP();
    // Linux: Remove the DROP rule for the specific client IP.
    exec(`sudo iptables -D FORWARD -s ${clientIP} ! -d ${localIP}/32 -j DROP`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error unblocking traffic for ${clientIP}: ${error.message}`);
        return;
      }
      console.log(`✅ Internet access allowed for ${clientIP}`);
    });
  }
}

/**
 * (Optional) Blocks internet access for a specific client IP.
 * This function can be used if you need to re-block an individual client.
 *
 * @param {string} clientIP - The client's IP address to block.
 */
function blockClient(clientIP) {
  if (isWindows) {
    // Windows: Add a rule to block outbound traffic for the specific client IP.
    exec(`netsh advfirewall firewall add rule name="BlockClient ${clientIP}" dir=out action=block remoteip=${clientIP}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error blocking traffic for ${clientIP} on Windows: ${error.message}`);
        return;
      }
      console.log(`🚫 Internet access blocked for ${clientIP} (Windows)`);
    });
  } else {
    const localIP = getLocalIP();
    exec(`sudo iptables -I FORWARD -s 0.0.0.0/0 ! -d ${localIP} -j DROP`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error blocking traffic for ${clientIP}: ${error.message}`);
        return;
      }
      console.log(`🚫 Internet access blocked for ${clientIP}`);
    });
  }
}