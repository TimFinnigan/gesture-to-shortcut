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
          script = 'tell application "System Events" to key code 116'; // Page Up
          break;
        case 'down':
          script = 'tell application "System Events" to key code 121'; // Page Down
          break;
        case 'left':
          script = 'tell application "System Events" to key code 123'; // Left arrow
          break;
        case 'tab':
          script = 'tell application "System Events" to keystroke tab'; // Tab
          break;
        case 'zoom-in':
          script = 'tell application "System Events" to keystroke "+" using {command down}'; // Cmd+Plus
          break;
        case 'zoom-out':
          script = 'tell application "System Events" to keystroke "-" using {command down}'; // Cmd+Minus
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

// Function to control mouse movement via AppleScript
function moveMouseToPosition(x, y) {
  if (process.platform === 'darwin') {
    const { execSync } = require('child_process');
    try {
      // Log the position values
      console.log(`Moving mouse to: x=${Math.round(x)}, y=${Math.round(y)}`);
      
      // Try the standard AppleScript approach first
      try {
        const script = `tell application "System Events" to set mouse position to {${Math.round(x)}, ${Math.round(y)}}`;
        console.log(`Executing AppleScript: ${script}`);
        execSync(`osascript -e '${script}'`);
      } catch (firstError) {
        console.error('First approach failed:', firstError);
        
        // Fall back to a shell script approach using cliclick if available
        try {
          execSync(`which cliclick`);
          console.log('Using cliclick as fallback');
          execSync(`cliclick m:${Math.round(x)},${Math.round(y)}`);
        } catch (secondError) {
          console.error('Could not find cliclick, mouse control may not work:', secondError);
          
          // As a last resort, try to create a temporary bash script to move the mouse
          try {
            const tmpScript = path.join(app.getPath('temp'), 'mouse_move.sh');
            fs.writeFileSync(tmpScript, `
              #!/bin/bash
              osascript -e 'tell application "System Events" to set mouse position to {${Math.round(x)}, ${Math.round(y)}}'
            `);
            fs.chmodSync(tmpScript, '755');
            execSync(tmpScript);
            fs.unlinkSync(tmpScript);
          } catch (finalError) {
            console.error('All mouse control methods failed:', finalError);
          }
        }
      }
    } catch (error) {
      console.error('Error moving mouse:', error);
      
      // If error is related to permissions, show a message in the window
      if (error.message.includes('not allowed assistive access')) {
        mainWindow.webContents.executeJavaScript(`
          document.getElementById('last-action').textContent = 'Error: Please enable mouse control permissions';
        `);
      }
    }
  } else {
    console.log('Mouse control currently only supported on macOS');
  }
}

// Function to perform mouse click
function performMouseClick(button = 'left') {
  if (process.platform === 'darwin') {
    const { execSync } = require('child_process');
    try {
      console.log(`Performing mouse ${button} click`);
      
      // Try the standard AppleScript first
      try {
        const script = `tell application "System Events" to click ${button} button of mouse`;
        console.log(`Executing AppleScript: ${script}`);
        execSync(`osascript -e '${script}'`);
      } catch (firstError) {
        console.error('Standard click failed:', firstError);
        
        // Try cliclick if available (common utility for macOS mouse control)
        try {
          execSync(`which cliclick`);
          console.log('Using cliclick as fallback');
          
          const clickType = button === 'right' ? 'rc' : 'c';
          // Click at current position
          execSync(`cliclick ${clickType}:.`);
        } catch (secondError) {
          console.error('Could not find cliclick, mouse click may not work:', secondError);
          
          // As a last resort, try to create a temporary script
          try {
            const tmpScript = path.join(app.getPath('temp'), 'mouse_click.sh');
            fs.writeFileSync(tmpScript, `
              #!/bin/bash
              osascript -e 'tell application "System Events" to click ${button} button of mouse'
            `);
            fs.chmodSync(tmpScript, '755');
            execSync(tmpScript);
            fs.unlinkSync(tmpScript);
          } catch (finalError) {
            console.error('All mouse click methods failed:', finalError);
          }
        }
      }
    } catch (error) {
      console.error('Error performing mouse click:', error);
    }
  } else {
    console.log('Mouse control currently only supported on macOS');
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
    // For tab key, try multiple methods (it can be problematic)
    if (key === 'tab') {
      try {
        // First try with key code
        const { execSync } = require('child_process');
        execSync(`osascript -e 'tell application "System Events" to key code 48'`);
      } catch (error) {
        // If that fails, try with keystroke
        simulateKeypress(key);
      }
    } else {
      simulateKeypress(key);
    }
  } catch (error) {
    console.error('Error typing key:', error);
  }
});

// Handle mouse movement from renderer
ipcMain.on('move-mouse', (event, position) => {
  moveMouseToPosition(position.x, position.y);
});

// Handle mouse click from renderer
ipcMain.on('mouse-click', (event, button) => {
  performMouseClick(button);
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