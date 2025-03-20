const { app, BrowserWindow, screen, Menu, Tray, ipcMain, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let tray;
let activeKeys = new Set();

// Custom shortcut function to simulate keypresses
function simulateKeypress(keyCode) {
  // Create a script that will simulate a keypress using AppleScript (macOS only)
  if (process.platform === 'darwin') {
    const { execSync } = require('child_process');
    try {
      let script;
      
      switch(keyCode) {
        case 'space':
          script = 'tell application "System Events" to key code 49'; // Space
          break;
        case 'escape':
          script = 'tell application "System Events" to key code 53'; // Escape
          break;
        case 'enter':
          script = 'tell application "System Events" to key code 36'; // Return
          break;
        case 'up':
          script = 'tell application "System Events" to key code 126'; // Up arrow
          break;
        case 'down':
          script = 'tell application "System Events" to key code 125'; // Down arrow
          break;
        default:
          console.log('Unsupported key:', keyCode);
          return;
      }
      
      execSync(`osascript -e '${script}'`);
      console.log(`Simulated key: ${keyCode}`);
    } catch (error) {
      console.error('Error executing AppleScript:', error);
      
      // If error is related to permissions, show a message in the window
      if (error.message.includes('not allowed assistive access')) {
        mainWindow.webContents.executeJavaScript(`
          document.getElementById('last-action').textContent = 'Error: Please enable accessibility permissions';
        `);
      }
    }
  } else {
    console.log('Keyboard simulation currently only supported on macOS');
  }
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js')
    },
    show: true
  });

  mainWindow.loadFile('index.html');
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open DevTools in development mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
  
  try {
    // Create compact mode menu item
    const contextMenu = Menu.buildFromTemplate([
      { 
        label: 'Show/Hide Window', 
        click: () => {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
          }
        } 
      },
      { type: 'separator' },
      { 
        label: 'Always on Top', 
        type: 'checkbox',
        checked: false,
        click: (menuItem) => {
          mainWindow.setAlwaysOnTop(menuItem.checked);
        }
      },
      { type: 'separator' },
      { 
        label: 'Quit', 
        click: () => {
          app.quit();
        } 
      }
    ]);
    
    // Create a simple icon for the tray - using a 16x16 transparent icon with default Electron app icon
    const icon = nativeImage.createEmpty();
    // Use the Electron default app icon as a fallback
    
    // Create tray icon with the empty icon
    tray = new Tray(icon);
    tray.setToolTip('Gesture to Shortcut');
    tray.setContextMenu(contextMenu);
    
    // Show window when tray icon is clicked
    tray.on('click', () => {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
      }
    });
  } catch (error) {
    console.error('Error setting up tray icon:', error);
  }
}

// Handle keyboard shortcuts through IPC from renderer
ipcMain.on('trigger-keyboard', (event, key) => {
  console.log('Triggering key:', key);
  try {
    simulateKeypress(key);
  } catch (error) {
    console.error('Error typing key:', error);
  }
});

// Handle minimize to tray event
ipcMain.on('minimize-to-tray', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
}); 