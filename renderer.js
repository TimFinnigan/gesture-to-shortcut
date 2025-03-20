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

// Add mouse control variables
let mouseControlActive = false;
let lastMousePosition = null;
const MOUSE_SMOOTHING = 0.7; // Lower for more responsive, higher for smoother (0-1)
let mouseControlError = false;

// Function to detect gestures based on hand landmarks
function detectGesture(landmarks) {
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
  
  // Calculate the y-offset of each finger (how much the tip is above the base)
  const fingerYOffset = [
    0, // Thumb (not used)
    indexBase.y - indexTip.y,  // Index
    middleBase.y - middleTip.y, // Middle
    ringBase.y - ringTip.y,    // Ring
    pinkyBase.y - pinkyTip.y   // Pinky
  ];
  
  // DEBUG LOG STATEMENTS
  console.log(`Finger Y-Offsets: Index=${fingerYOffset[1].toFixed(3)}, Middle=${fingerYOffset[2].toFixed(3)}, Ring=${fingerYOffset[3].toFixed(3)}, Pinky=${fingerYOffset[4].toFixed(3)}`);
  
  // STEP 1: Categorize the overall hand configuration
  // Count how many fingers are pointing up significantly (using strict thresholds)
  const fingersPointingUpCount = 
    (fingerYOffset[1] > 0.015 ? 1 : 0) + 
    (fingerYOffset[2] > 0.015 ? 1 : 0) + 
    (fingerYOffset[3] > 0.015 ? 1 : 0) + 
    (fingerYOffset[4] > 0.015 ? 1 : 0);
    
  console.log(`Fingers pointing up: ${fingersPointingUpCount}`);
  
  // Check for Mouse Click (index finger extended + thumb near index tip)
  if (fingersPointingUpCount === 1 && 
      fingerYOffset[1] > 0.02 && 
      fingerYOffset[2] < 0.01 && 
      fingerYOffset[3] < 0.01 && 
      fingerYOffset[4] < 0.01 &&
      thumbIndexDistance < 0.05) {  // Thumb and index close together
    
    if (fingerExtendedFromBase[1] > 0.07) {
      mouseControlActive = true;
      return "Mouse Click";
    }
  }
  
  // Check for Mouse Control (only index finger extended)
  if (fingersPointingUpCount === 1 && 
      fingerYOffset[1] > 0.02 && 
      fingerYOffset[2] < 0.01 && 
      fingerYOffset[3] < 0.01 && 
      fingerYOffset[4] < 0.01) {
    
    // Check if the finger is extended enough for mouse control
    if (fingerExtendedFromBase[1] > 0.07) {
      mouseControlActive = true;
      return "Mouse Control";
    }
  } else {
    mouseControlActive = false;
  }
  
  // STEP 2: Analyze specific gesture patterns based on finger counts
  
  // ------ FOUR FINGERS UP (PALM) ------
  if (fingersPointingUpCount === 4 && fingersExtended.every(dist => dist > 0.1)) {
    // This is a palm - all 4 fingers are pointing up
    console.log("PALM DETECTED: All 4 fingers are up");
    return "Palm";
  }
  
  // ------ THREE FINGERS UP ------
  if (fingersPointingUpCount === 3) {
    // Check for the Three Fingers gesture (index, middle, ring up, pinky down)
    if (fingerYOffset[1] > 0.015 && 
        fingerYOffset[2] > 0.015 && 
        fingerYOffset[3] > 0.015 && 
        fingerYOffset[4] < 0.01) {
      console.log("THREE FINGERS DETECTED: Index, middle, ring up; pinky down");
      return "Three Fingers";
    }
  }
  
  // ------ TWO FINGERS UP (VICTORY) ------
  if (fingersPointingUpCount === 2) {
    // Check for Victory Sign (index and middle up, others down)
    if (fingerYOffset[1] > 0.02 && 
        fingerYOffset[2] > 0.02 && 
        fingerYOffset[3] < 0.01 && 
        fingerYOffset[4] < 0.01) {
      console.log("VICTORY DETECTED: Index and middle up; ring and pinky down");
      return "Victory Sign";
    }
  }
  
  // ------ ONE FINGER UP ------
  if (fingersPointingUpCount === 1) {
    // Check for Pointing Up (index finger up, all others down)
    if (fingerYOffset[1] > 0.07 && 
        fingerYOffset[2] < 0.01 && 
        fingerYOffset[3] < 0.01 && 
        fingerYOffset[4] < 0.01) {
      return "Pointing Up";
    }
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
  
  // Check for general pinch gesture (thumb and index finger close together)
  const pinchThreshold = 0.07;
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
  
  // Add debug info about the triggered gesture
  console.log(`TRIGGERING ACTION FOR GESTURE: ${gesture}`);
  
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
    case "Victory Sign":
      ipcRenderer.send('trigger-keyboard', 'up');
      action = 'Page Up pressed';
      break;
    case "Three Fingers":
      ipcRenderer.send('trigger-keyboard', 'down');
      action = 'Page Down pressed';
      break;
    case "Pinch":
      // For single hand pinch (not used for zooming)
      ipcRenderer.send('trigger-keyboard', 'left');
      action = 'Arrow Left pressed';
      break;
    case "Mouse Control":
      // Handle in the onResults function where we have position data
      action = 'Mouse control active';
      break;
    case "Mouse Click":
      ipcRenderer.send('mouse-click', 'left');
      action = 'Mouse click performed';
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
  
  // Add handler for mouse control errors
  ipcRenderer.once('mouse-control-error', (event, message) => {
    mouseControlError = true;
    // Display error message on screen
    canvasCtx.font = '18px Arial';
    canvasCtx.fillStyle = 'red';
    canvasCtx.fillRect(10, 400, 620, 60);
    canvasCtx.fillStyle = 'white';
    canvasCtx.fillText('Mouse Control Error: ' + message, 15, 420);
    canvasCtx.fillText('Please check permissions in System Preferences > Security > Privacy', 15, 440);
  });

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    handVisible = true;
    
    // Track pinch points for each hand
    let pinchPoints = [];
    
    // Draw hand landmarks
    for (let i = 0; i < results.multiHandLandmarks.length; i++) {
      const landmarks = results.multiHandLandmarks[i];
      drawConnectors(canvasCtx, landmarks, Hands.HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 5 });
      drawLandmarks(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 2 });
      
      // Detect gesture
      const gesture = detectGesture(landmarks);
      
      // Handle mouse control
      if (gesture === "Mouse Click" || gesture === "Mouse Control") {
        const indexTip = landmarks[8];
        
        // Draw indicator for mouse control
        canvasCtx.beginPath();
        canvasCtx.arc(indexTip.x * canvasElement.width, indexTip.y * canvasElement.height, 10, 0, 2 * Math.PI);
        
        // Change color based on whether it's mouse control or click
        canvasCtx.fillStyle = gesture === "Mouse Click" ? "rgba(255, 0, 0, 0.7)" : "rgba(255, 255, 0, 0.7)";
        canvasCtx.fill();
        canvasCtx.lineWidth = 2;
        canvasCtx.strokeStyle = "#FF0000";
        canvasCtx.stroke();
        
        // Convert hand position to screen coordinates
        // Flip X to match natural movement (mirror effect)
        const screenX = (1 - indexTip.x) * window.screen.width;
        const screenY = indexTip.y * window.screen.height;
        
        console.log(`Raw coordinates: x=${screenX.toFixed(2)}, y=${screenY.toFixed(2)}`);
        
        // Apply smoothing
        if (lastMousePosition) {
          const smoothedX = lastMousePosition.x + (screenX - lastMousePosition.x) * (1 - MOUSE_SMOOTHING);
          const smoothedY = lastMousePosition.y + (screenY - lastMousePosition.y) * (1 - MOUSE_SMOOTHING);
          
          console.log(`Sending mouse position: x=${smoothedX.toFixed(2)}, y=${smoothedY.toFixed(2)}`);
          
          // Send mouse position to main process
          ipcRenderer.send('move-mouse', {
            x: smoothedX,
            y: smoothedY
          });
          
          lastMousePosition = { x: smoothedX, y: smoothedY };
        } else {
          lastMousePosition = { x: screenX, y: screenY };
          
          // Send initial position too
          ipcRenderer.send('move-mouse', {
            x: screenX,
            y: screenY
          });
        }
        
        // Show status based on gesture
        if (gesture === "Mouse Click") {
          lastActionElement.textContent = 'Mouse Click: Performing';
        } else {
          lastActionElement.textContent = mouseControlError ? 
            'Mouse Control: Permission Error (See console)' : 
            'Mouse Control: Active';
        }
      } else if (lastMousePosition) {
        // Reset mouse tracking when not in mouse control mode
        lastMousePosition = null;
      }
      
      // Get key landmarks for visualization
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
      
      // Draw indicator lines
      canvasCtx.beginPath();
      canvasCtx.moveTo(indexBase.x * canvasElement.width, indexBase.y * canvasElement.height);
      canvasCtx.lineTo(indexTip.x * canvasElement.width, indexTip.y * canvasElement.height);
      canvasCtx.strokeStyle = fingerYOffset[1] > 0.02 ? "#00FF00" : (fingerYOffset[1] > 0.01 ? "#FFFF00" : "#FF0000");
      canvasCtx.lineWidth = 3;
      canvasCtx.stroke();
      
      canvasCtx.beginPath();
      canvasCtx.moveTo(middleBase.x * canvasElement.width, middleBase.y * canvasElement.height);
      canvasCtx.lineTo(middleTip.x * canvasElement.width, middleTip.y * canvasElement.height);
      canvasCtx.strokeStyle = fingerYOffset[2] > 0.02 ? "#00FF00" : (fingerYOffset[2] > 0.01 ? "#FFFF00" : "#FF0000");
      canvasCtx.lineWidth = 3;
      canvasCtx.stroke();
      
      canvasCtx.beginPath();
      canvasCtx.moveTo(ringBase.x * canvasElement.width, ringBase.y * canvasElement.height);
      canvasCtx.lineTo(ringTip.x * canvasElement.width, ringTip.y * canvasElement.height);
      // For Three Fingers, ring should be up; for Victory, ring should be down
      canvasCtx.strokeStyle = fingerYOffset[3] > 0.015 ? "#00FF00" : (fingerYOffset[3] < 0.01 ? "#0000FF" : "#FFFF00");
      canvasCtx.lineWidth = 3;
      canvasCtx.stroke();
      
      canvasCtx.beginPath();
      canvasCtx.moveTo(pinkyBase.x * canvasElement.width, pinkyBase.y * canvasElement.height);
      canvasCtx.lineTo(pinkyTip.x * canvasElement.width, pinkyTip.y * canvasElement.height);
      // For both Victory and Three Fingers, pinky should be down; for Palm, pinky should be up
      canvasCtx.strokeStyle = fingerYOffset[4] > 0.02 ? "#FF00FF" : (fingerYOffset[4] < 0.005 ? "#0000FF" : "#FFFF00");
      canvasCtx.lineWidth = 3;
      canvasCtx.stroke();
      
      // Display debug info on canvas
      const debugYOffset = [
        `Index: ${fingerYOffset[1].toFixed(3)} ${fingerYOffset[1] > 0.02 ? "✓V/3" : (fingerYOffset[1] > 0.01 ? "✓Palm" : "✗")}`,
        `Middle: ${fingerYOffset[2].toFixed(3)} ${fingerYOffset[2] > 0.02 ? "✓V/3" : (fingerYOffset[2] > 0.01 ? "✓Palm" : "✗")}`,
        `Ring: ${fingerYOffset[3].toFixed(3)} ${fingerYOffset[3] > 0.015 ? "✓3" : (fingerYOffset[3] < 0.01 ? "✓V" : "~")}`,
        `Pinky: ${fingerYOffset[4].toFixed(3)} ${fingerYOffset[4] > 0.02 ? "✓Palm" : (fingerYOffset[4] < 0.005 ? "✓Three" : "~")}`
      ];
      
      // Add debug text for the current gesture
      canvasCtx.font = '18px Arial';
      canvasCtx.fillStyle = 'white';
      canvasCtx.strokeStyle = 'black';
      canvasCtx.lineWidth = 0.5;
      
      // Show detected gesture with attention-grabbing design
      canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      canvasCtx.fillRect(10, 180, 180, 30);
      canvasCtx.fillStyle = gesture === "Palm" ? "#00FFFF" : 
                          gesture === "Three Fingers" ? "#FFFF00" :
                          gesture === "Mouse Control" ? "#FFFF00" : 'white';
      canvasCtx.fillText(`Gesture: ${gesture}`, 15, 200);
      canvasCtx.strokeText(`Gesture: ${gesture}`, 15, 200);
      
      // Draw gesture debug info
      for (let j = 0; j < debugYOffset.length; j++) {
        canvasCtx.fillStyle = 'white';
        canvasCtx.fillText(debugYOffset[j], 10, 20 + j * 20);
        canvasCtx.strokeText(debugYOffset[j], 10, 20 + j * 20);
      }
      
      // If pinch or zoom pinch detected, store points for possible zoom gesture
      if (gesture === "Pinch" || gesture === "Zoom Pinch") {
        pinchPoints.push({
          thumb: landmarks[4],
          index: landmarks[8],
          gesture: gesture
        });
        
        // Draw a highlight circle for pinch points for debugging
        canvasCtx.beginPath();
        const centerX = (landmarks[4].x + landmarks[8].x) / 2 * canvasElement.width;
        const centerY = (landmarks[4].y + landmarks[8].y) / 2 * canvasElement.height;
        canvasCtx.arc(centerX, centerY, 20, 0, 2 * Math.PI);
        canvasCtx.fillStyle = gesture === "Zoom Pinch" ? "rgba(0, 255, 255, 0.3)" : "rgba(255, 0, 255, 0.3)";
        canvasCtx.fill();
      }
      
      // Only show the first hand's gesture in UI
      if (i === 0) {
        detectedGestureElement.textContent = gesture;
        
        // Calculate cooldown remaining
        const currentTime = Date.now();
        const cooldownRemaining = GESTURE_COOLDOWN - (currentTime - lastGestureTime);
        
        // Show visual indication of cooldown
        if (cooldownRemaining > 0 && gesture !== "Unknown" && gesture !== "Mouse Control") {
          const cooldownPercentage = (cooldownRemaining / GESTURE_COOLDOWN) * 100;
          detectedGestureElement.style.opacity = 0.5 + (0.5 * (1 - cooldownPercentage / 100));
          detectedGestureElement.style.color = "#FF9900"; // Orange during cooldown
        } else {
          detectedGestureElement.style.opacity = 1;
          detectedGestureElement.style.color = gesture === "Palm" ? "#00CCCC" : 
                                             gesture === "Three Fingers" ? "#CCCC00" :
                                             gesture === "Mouse Control" ? "#FFCC00" : "#00AA00";
        }
      }
      
      // For single hand gestures
      if (results.multiHandLandmarks.length === 1) {
        // Skip cooldown check for continuous gestures like mouse control
        if (gesture === "Mouse Control") {
          const action = triggerKeyboardAction(gesture);
          if (i === 0) lastActionElement.textContent = action;
        }
        // Check if enough time has passed since the last gesture for other gestures
        else {
          const currentTime = Date.now();
          if (currentTime - lastGestureTime > GESTURE_COOLDOWN) {
            const action = triggerKeyboardAction(gesture);
            lastActionElement.textContent = action;
            lastGestureTime = currentTime;
          }
        }
      }
    }
    
    // Debug info for zoom gestures
    if (pinchPoints.length === 2) {
      // Draw a line connecting the two pinch points for zoom visual feedback
      canvasCtx.beginPath();
      const startX = (pinchPoints[0].thumb.x + pinchPoints[0].index.x) / 2 * canvasElement.width;
      const startY = (pinchPoints[0].thumb.y + pinchPoints[0].index.y) / 2 * canvasElement.height;
      const endX = (pinchPoints[1].thumb.x + pinchPoints[1].index.x) / 2 * canvasElement.width;
      const endY = (pinchPoints[1].thumb.y + pinchPoints[1].index.y) / 2 * canvasElement.height;
      
      canvasCtx.moveTo(startX, startY);
      canvasCtx.lineTo(endX, endY);
      canvasCtx.strokeStyle = "#FFFF00";
      canvasCtx.lineWidth = 5;
      canvasCtx.stroke();
      
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