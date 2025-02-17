const { app, BrowserWindow } = require("electron");
const path = require("path");
const { exec } = require("child_process");
const sudo = require("electron-sudo"); // For Windows Admin prompt
const fs = require("fs");
const os = require("os");

let mainWindow;

// Function to launch the Docker server using Docker Compose (requires admin rights on Windows)
function launchDockerServer(callback) {
  if (os.platform() === "win32") {
    // On Windows, ask for administrator privileges
    sudo.exec("docker-compose up --build", (error, stdout, stderr) => {
      if (error || stderr) {
        console.error(`❌ Error launching Docker server: ${error || stderr}`);
        return;
      }
      console.log(`✅ Docker server output: ${stdout}`);
      callback(stdout);  // Send server output (URL, etc.) to the renderer process
    });
  } else {
    // On Linux, if user has Docker privileges (no sudo needed after setup)
    exec("docker-compose up --build", (error, stdout, stderr) => {
      if (error || stderr) {
        console.error(`❌ Error launching Docker server: ${error || stderr}`);
        return;
      }
      console.log(`✅ Docker server output: ${stdout}`);
      callback(stdout);
    });
  }
}

// Function to launch Node.js server
function launchNodeServer(callback) {
  exec("node server.js", (error, stdout, stderr) => {
    if (error || stderr) {
      console.error(`❌ Error launching Node.js server: ${error || stderr}`);
      return;
    }
    console.log(`✅ Node.js server output: ${stdout}`);
    callback(stdout);
  });
}

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 450,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Launch both servers
  launchNodeServer((serverOutput) => {
    mainWindow.webContents.send('serverStatus', `Node.js Server is running: ${serverOutput}`);
  });

  launchDockerServer((dockerOutput) => {
    mainWindow.webContents.send('serverStatus', `Docker Server is running: ${dockerOutput}`);
  });

  mainWindow.loadURL('data:text/html,<html><body><h1>Server Info</h1><div id="server-status"></div><script>window.electron.receive("serverStatus", (data) => {document.getElementById("server-status").textContent = data;});</script></body></html>');

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
