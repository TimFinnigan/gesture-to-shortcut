# Gesture to Shortcut

An Electron application that uses MediaPipe hand tracking to map hand gestures to keyboard shortcuts.

## Features

- Real-time webcam hand tracking
- Configurable gesture-to-keyboard mappings
- Visual feedback for detected gestures
- System tray for minimized operation

## Requirements

- Node.js (v14 or later)
- npm or yarn
- Webcam
- macOS (for system-wide keyboard events)

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/gesture-to-shortcut.git
   cd gesture-to-shortcut
   ```

2. Install dependencies:
   ```
   npm install
   ```

## Usage

1. Start the application:
   ```
   npm start
   ```

2. Grant necessary webcam permissions when prompted
3. Perform gestures to trigger associated keyboard shortcuts

## Customization

To modify gesture mappings, edit the `gestureToKeyMap` object in `renderer.js`.

## How It Works

This application uses:
- MediaPipe for hand tracking and gesture recognition
- Electron for the desktop application wrapper
- Robot.js for simulating keyboard events

## Troubleshooting

If keyboard events aren't working, make sure the application has accessibility permissions on macOS (System Preferences > Security & Privacy > Privacy > Accessibility).

## Platform Support

- macOS: Full support
- Windows/Linux: Limited functionality (keyboard simulation may not work for all system events)

## License

MIT
