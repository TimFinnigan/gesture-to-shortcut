const { ipcRenderer } = require('electron');
const { Camera } = require('@mediapipe/camera_utils');
const { Hands } = require('@mediapipe/hands');
const { drawConnectors, drawLandmarks } = require('@mediapipe/drawing_utils');

// DOM elements
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output-canvas');
const canvasCtx = canvasElement.getContext('2d');
const detectedGestureElement = document.getElementById('detected-gesture');
const lastActionElement = document.getElementById('last-action');
const startButton = document.getElementById('start-button');
const stopButton = document.getElementById('stop-button');
const minimizeButton = document.getElementById('minimize-button');

// Add a notification about permissions
function showPermissionNotification() {
  // Check if notification element already exists
  if (!document.getElementById('permission-notice')) {
    const container = document.querySelector('.container');
    const notification = document.createElement('div');
    notification.id = 'permission-notice';
    notification.style.backgroundColor = '#ffdd99';
    notification.style.padding = '10px';
    notification.style.marginBottom = '15px';
    notification.style.borderRadius = '5px';
    notification.style.borderLeft = '4px solid #ff9900';
    notification.innerHTML = `
      <h3 style="margin-top: 0">⚠️ Important: Accessibility Permissions Required</h3>
      <p>For keyboard shortcuts to work, you need to grant accessibility permissions:</p>
      <ol>
        <li>Go to System Preferences > Security & Privacy > Privacy > Accessibility</li>
        <li>Click the lock icon to make changes</li>
        <li>Add Terminal and/or Electron to the list</li>
        <li>Restart the app after granting permissions</li>
      </ol>
    `;
    
    // Insert at the top of the container
    container.insertBefore(notification, container.firstChild);
  }
}

// Detect if running on macOS
if (process.platform === 'darwin') {
  // Show the permission notification on load
  window.addEventListener('load', showPermissionNotification);
}

// Initialize MediaPipe Hands
const hands = new Hands({
  locateFile: (file) => {
    return `node_modules/@mediapipe/hands/${file}`;
  }
});

// Set configuration options
hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

// Set up camera
let camera = null;

function initCamera() {
  camera = new Camera(videoElement, {
    onFrame: async () => {
      await hands.send({ image: videoElement });
    },
    width: 640,
    height: 480
  });
}

// Define gesture cooldown to prevent rapid triggering
let lastGestureTime = 0;
const GESTURE_COOLDOWN = 1500; // 1.5 second cooldown between gestures

// Variable to track if hand is visible
let handVisible = false;

// Variable to track pinch distance for zoom gestures
let lastPinchDistance = null;

// Function to detect gestures based on hand landmarks
function detectGesture(landmarks) {
  // Helper function to calculate the angle between three points
  function calculateAngle(point1, point2, point3) {
    const angle = Math.atan2(point3.y - point2.y, point3.x - point2.x) - 
                 Math.atan2(point1.y - point2.y, point1.x - point2.x);
    return Math.abs(angle * 180 / Math.PI);
  }

  // Helper function to calculate distance between two points
  function calculateDistance(point1, point2) {
    return Math.sqrt(Math.pow(point2.x - point1.x, 2) + Math.pow(point2.y - point1.y, 2));
  }
  
  // Extract key landmarks for gesture recognition
  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const ringTip = landmarks[16];
  const pinkyTip = landmarks[20];
  
  // Finger bases (knuckles)
  const indexBase = landmarks[5];
  const middleBase = landmarks[9];
  const ringBase = landmarks[13];
  const pinkyBase = landmarks[17];
  
  // Calculate distances from wrist to fingertips
  const fingersExtended = [
    Math.sqrt(Math.pow(thumbTip.x - wrist.x, 2) + Math.pow(thumbTip.y - wrist.y, 2)),
    Math.sqrt(Math.pow(indexTip.x - wrist.x, 2) + Math.pow(indexTip.y - wrist.y, 2)),
    Math.sqrt(Math.pow(middleTip.x - wrist.x, 2) + Math.pow(middleTip.y - wrist.y, 2)),
    Math.sqrt(Math.pow(ringTip.x - wrist.x, 2) + Math.pow(ringTip.y - wrist.y, 2)),
    Math.sqrt(Math.pow(pinkyTip.x - wrist.x, 2) + Math.pow(pinkyTip.y - wrist.y, 2))
  ];
  
  // Calculate distances from fingertips to their bases
  const fingerExtendedFromBase = [
    calculateDistance(thumbTip, landmarks[2]), // Thumb MCP
    calculateDistance(indexTip, indexBase),
    calculateDistance(middleTip, middleBase),
    calculateDistance(ringTip, ringBase),
    calculateDistance(pinkyTip, pinkyBase)
  ];
  
  // Get thumb-index distance for pinch detection
  const thumbIndexDistance = calculateDistance(thumbTip, indexTip);
  
  // Check if fingertips are higher than their bases
  const fingerYOffset = [
    0, // Thumb (not used)
    indexBase.y - indexTip.y,  // Index
    middleBase.y - middleTip.y, // Middle
    ringBase.y - ringTip.y,    // Ring
    pinkyBase.y - pinkyTip.y   // Pinky
  ];
  
  // Debug output for finger extension ratios
  const debugFingerInfo = `
    Index Y-Offset: ${fingerYOffset[1].toFixed(3)}
    Middle Y-Offset: ${fingerYOffset[2].toFixed(3)}
    Ring Y-Offset: ${fingerYOffset[3].toFixed(3)}
    Pinky Y-Offset: ${fingerYOffset[4].toFixed(3)}
  `;
  console.log(debugFingerInfo);
  
  // Check for Victory Sign (index and middle fingers extended in a V shape)
  // Using lower thresholds and checking both vertical position and extension
  if (fingerYOffset[1] > 0.02 && 
      fingerYOffset[2] > 0.02 && 
      fingerYOffset[3] < 0.015 && 
      fingerYOffset[4] < 0.015 && 
      fingerExtendedFromBase[1] > 0.07 && 
      fingerExtendedFromBase[2] > 0.07 && 
      fingerExtendedFromBase[3] < 0.07 && 
      fingerExtendedFromBase[4] < 0.07) {
    return "Victory Sign";
  }
  
  // Check for Three Fingers Up (index, middle, and ring fingers extended)
  if (fingerYOffset[1] > 0.015 && 
      fingerYOffset[2] > 0.015 && 
      fingerYOffset[3] > 0.015 && 
      fingerYOffset[4] < 0.015 && 
      fingerExtendedFromBase[1] > 0.06 && 
      fingerExtendedFromBase[2] > 0.06 && 
      fingerExtendedFromBase[3] > 0.06 && 
      fingerExtendedFromBase[4] < 0.06) {
    return "Three Fingers";
  }
  
  // Check for finger gun (thumb up, index extended, other fingers curled)
  const thumbUp = thumbTip.y < wrist.y - 0.05;
  const indexExtended = calculateDistance(indexTip, wrist) > 0.15;
  const otherFingersCurled = 
    fingersExtended[2] < 0.12 && 
    fingersExtended[3] < 0.12 && 
    fingersExtended[4] < 0.12;
  
  if (thumbUp && indexExtended && otherFingersCurled) {
    return "Finger Gun";
  }
  
  // Check for pointing up by checking y-positions of fingertips relative to their bases
  // If index finger tip is much higher than its base, while other fingers are lower or close to their bases
  const indexPointingUp = indexTip.y < indexBase.y - 0.08;
  const middleDown = middleTip.y >= middleBase.y - 0.03;
  const ringDown = ringTip.y >= ringBase.y - 0.03;
  const pinkyDown = pinkyTip.y >= pinkyBase.y - 0.03;
  const thumbDown = thumbTip.y >= wrist.y - 0.03;
  
  if (indexPointingUp && middleDown && ringDown && pinkyDown && thumbDown) {
    return "Pointing Up";
  }
  
  // Check for one finger up (index) - for scrolling up
  if (fingerYOffset[1] > 0.02 && 
      fingerYOffset[2] < 0.015 && 
      fingerYOffset[3] < 0.015 && 
      fingerYOffset[4] < 0.015 && 
      fingerExtendedFromBase[1] > 0.07 && 
      fingerExtendedFromBase[2] < 0.07 && 
      fingerExtendedFromBase[3] < 0.07 && 
      fingerExtendedFromBase[4] < 0.07) {
    return "One Finger";
  }
  
  // Check for two fingers up (index and middle) - for scrolling down
  if (fingerYOffset[1] > 0.02 && 
      fingerYOffset[2] > 0.02 && 
      fingerYOffset[3] < 0.015 && 
      fingerYOffset[4] < 0.015 && 
      fingerExtendedFromBase[1] > 0.07 && 
      fingerExtendedFromBase[2] > 0.07 && 
      fingerExtendedFromBase[3] < 0.07 && 
      fingerExtendedFromBase[4] < 0.07) {
    return "Two Fingers";
  }
  
  // Check for general pinch gesture (thumb and index finger close together)
  // Used for both single-hand pinch and two-hand zoom gestures
  const pinchThreshold = 0.07; // Increased threshold
  if (thumbIndexDistance < pinchThreshold) {
    // Different types of pinch depending on other fingers
    if (fingersExtended[2] < 0.1 && fingersExtended[3] < 0.1 && fingersExtended[4] < 0.1) {
      // All other fingers closed - for single-hand command
      return "Pinch";
    } else {
      // For two-handed zoom gesture - more relaxed criteria
      return "Zoom Pinch";
    }
  }
  
  // Check for palm (all fingers extended)
  if (fingersExtended.every(dist => dist > 0.1)) {
    return "Palm";
  }
  
  // Check for closed fist (all fingers curled)
  if (fingersExtended.every(dist => dist < 0.1)) {
    return "Closed Fist";
  }
  
  // Check for thumbs up (only thumb extended and pointing up)
  if (fingersExtended[0] > 0.1 && 
      fingersExtended[1] < 0.1 && 
      fingersExtended[2] < 0.1 && 
      fingersExtended[3] < 0.1 && 
      fingersExtended[4] < 0.1 && 
      thumbTip.y < wrist.y) {
    return "Thumbs Up";
  }
  
  // Check for thumbs down (only thumb extended and pointing down)
  if (fingersExtended[0] > 0.1 && 
      fingersExtended[1] < 0.1 && 
      fingersExtended[2] < 0.1 && 
      fingersExtended[3] < 0.1 && 
      fingersExtended[4] < 0.1 && 
      thumbTip.y > wrist.y) {
    return "Thumbs Down";
  }
  
  // No recognized gesture
  return "Unknown";
}

// Map gestures to keyboard actions using IPC
function triggerKeyboardAction(gesture) {
  let action = 'None';
  
  switch (gesture) {
    case "Palm":
      ipcRenderer.send('trigger-keyboard', 'space');
      action = 'Spacebar pressed';
      break;
    case "Closed Fist":
      ipcRenderer.send('trigger-keyboard', 'escape');
      action = 'Escape pressed';
      break;
    case "Finger Gun":
      ipcRenderer.send('trigger-keyboard', 'tab');
      action = 'Tab pressed';
      break;
    case "Thumbs Up":
      ipcRenderer.send('trigger-keyboard', 'enter');
      action = 'Enter pressed';
      break;
    case "One Finger":
      ipcRenderer.send('trigger-keyboard', 'pagedown');
      action = 'Page Down';
      break;
    case "Two Fingers":
      ipcRenderer.send('trigger-keyboard', 'pageup');
      action = 'Page Up';
      break;
    case "Pinch":
      // For single hand pinch (not used for zooming)
      ipcRenderer.send('trigger-keyboard', 'left');
      action = 'Arrow Left pressed';
      break;
  }
  
  return action;
}

// Process hand landmarks
hands.onResults((results) => {
  // Clear canvas
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
  
  handVisible = false;
  
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    handVisible = true;
    
    // Track pinch points for each hand
    let pinchPoints = [];
    
    // Draw hand landmarks
    for (let i = 0; i < results.multiHandLandmarks.length; i++) {
      const landmarks = results.multiHandLandmarks[i];
      
      // Keep only the landmarks (red dots) without the connecting lines
      drawLandmarks(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 2 });
      
      // Detect gesture
      const gesture = detectGesture(landmarks);
      
      // Add visual debugging for specific finger positions
      const wrist = landmarks[0];
      const thumbTip = landmarks[4];
      const indexTip = landmarks[8];
      const middleTip = landmarks[12];
      const ringTip = landmarks[16];
      const pinkyTip = landmarks[20];
      const indexBase = landmarks[5];
      const middleBase = landmarks[9];
      const ringBase = landmarks[13];
      const pinkyBase = landmarks[17];
      
      // Calculate the y-offset of each finger (how much the tip is above the base)
      const fingerYOffset = [
        0, // Thumb (not used)
        indexBase.y - indexTip.y,  // Index
        middleBase.y - middleTip.y, // Middle
        ringBase.y - ringTip.y,    // Ring
        pinkyBase.y - pinkyTip.y   // Pinky
      ];
      
      // Add semi-transparent background for the gesture text
      canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      canvasCtx.fillRect(5, 5, 200, 40);
      
      // Only show gesture text with larger font
      canvasCtx.font = '24px Arial';
      canvasCtx.fillStyle = 'white';
      canvasCtx.strokeStyle = 'black';
      canvasCtx.lineWidth = 1;
      
      // Add gesture text - made larger and more visible
      canvasCtx.fillText(`Gesture: ${gesture}`, 10, 35);
      canvasCtx.strokeText(`Gesture: ${gesture}`, 10, 35);
      
      // If pinch or zoom pinch detected, store points for possible zoom gesture
      if (gesture === "Pinch" || gesture === "Zoom Pinch") {
        pinchPoints.push({
          thumb: landmarks[4],
          index: landmarks[8],
          gesture: gesture
        });
      }
      
      // Only show the first hand's gesture in UI
      if (i === 0) {
        detectedGestureElement.textContent = gesture;
        
        // Calculate cooldown remaining
        const currentTime = Date.now();
        const cooldownRemaining = GESTURE_COOLDOWN - (currentTime - lastGestureTime);
        
        // Show visual indication of cooldown
        if (cooldownRemaining > 0 && gesture !== "Unknown") {
          const cooldownPercentage = (cooldownRemaining / GESTURE_COOLDOWN) * 100;
          detectedGestureElement.style.opacity = 0.5 + (0.5 * (1 - cooldownPercentage / 100));
          detectedGestureElement.style.color = "#FF9900"; // Orange during cooldown
        } else {
          detectedGestureElement.style.opacity = 1;
          detectedGestureElement.style.color = "#00AA00"; // Green when ready
        }
      }
      
      // For single hand gestures
      if (results.multiHandLandmarks.length === 1) {
        // Check if enough time has passed since the last gesture
        const currentTime = Date.now();
        if (currentTime - lastGestureTime > GESTURE_COOLDOWN) {
          const action = triggerKeyboardAction(gesture);
          lastActionElement.textContent = action;
          lastGestureTime = currentTime;
        }
      }
    }
    
    // Debug info for zoom gestures
    if (pinchPoints.length === 2) {
      // Show how many pinch points detected
      lastActionElement.textContent = `Pinch points: ${pinchPoints.length} (ready for zoom)`;
    }
    
    // Check for zoom gestures (two pinches)
    if (pinchPoints.length === 2) {
      const currentTime = Date.now();
      if (currentTime - lastGestureTime > GESTURE_COOLDOWN) {
        // Calculate distance between the two pinch points
        const distance = Math.sqrt(
          Math.pow(pinchPoints[0].thumb.x - pinchPoints[1].thumb.x, 2) + 
          Math.pow(pinchPoints[0].thumb.y - pinchPoints[1].thumb.y, 2)
        );
        
        // Store distance for tracking movement (zoom in/out)
        if (!lastPinchDistance) {
          lastPinchDistance = distance;
          lastActionElement.textContent = 'Zoom tracking started';
        } else {
          // Determine if zooming in or out
          const pinchDelta = distance - lastPinchDistance;
          
          if (Math.abs(pinchDelta) > 0.03) { // Reduced threshold to avoid jitter
            if (pinchDelta > 0) {
              // Zoom in
              ipcRenderer.send('trigger-keyboard', 'zoom-in');
              lastActionElement.textContent = 'Zoom In';
            } else {
              // Zoom out
              ipcRenderer.send('trigger-keyboard', 'zoom-out');
              lastActionElement.textContent = 'Zoom Out';
            }
            lastGestureTime = currentTime;
            lastPinchDistance = distance;
          }
        }
      }
    } else {
      // Reset pinch distance tracking when not pinching with both hands
      lastPinchDistance = null;
    }
  } else {
    detectedGestureElement.textContent = 'None';
  }
});

// Adjust canvas size when window resizes
function resizeCanvas() {
  canvasElement.width = videoElement.clientWidth;
  canvasElement.height = videoElement.clientHeight;
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', resizeCanvas);

// Button event handlers
startButton.addEventListener('click', () => {
  if (!camera) {
    initCamera();
    camera.start();
    startButton.disabled = true;
    stopButton.disabled = false;
    lastActionElement.textContent = 'Camera started';
  }
});

stopButton.addEventListener('click', () => {
  if (camera) {
    camera.stop();
    camera = null;
    startButton.disabled = false;
    stopButton.disabled = true;
    lastActionElement.textContent = 'Camera stopped';
    
    // Clear the canvas
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    detectedGestureElement.textContent = 'None';
  }
});

minimizeButton.addEventListener('click', () => {
  ipcRenderer.send('minimize-to-tray');
  lastActionElement.textContent = 'Minimized to tray';
});

// Initialize on page load
window.addEventListener('load', () => {
  // Initialize camera by default
  initCamera();
  camera.start();
  
  // Setup button states
  startButton.disabled = true;
  stopButton.disabled = false;
}); 