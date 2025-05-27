document.addEventListener('DOMContentLoaded', async () => {
  const activateButton = document.getElementById('activate');
  const captureButton = document.getElementById('capture');
  let isSelectionMode = false;
  let zoneCount = 0;

  const isMac = navigator.platform.includes('Mac');
  const modKey = isMac ? '⌘' : 'Ctrl';
  
  document.getElementById('start-shortcut').textContent = `${modKey}+⇧+S`;
  document.getElementById('capture-shortcut').textContent = `${modKey}+⇧+X`;
  
  document.getElementById('start-keys').textContent = `${modKey}+Shift+S`;
  document.getElementById('capture-keys').textContent = `${modKey}+Shift+X`;
  document.getElementById('save-keys').textContent = `${modKey}+Shift+Z`;
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "CHECK_STATE" });
    if (response.isActive) {
      isSelectionMode = true;
      zoneCount = response.zoneCount;
      activateButton.textContent = 'Stop selection';
      activateButton.style.backgroundColor = '#dc3545';
      captureButton.disabled = false;
    } else {
      isSelectionMode = false;
      zoneCount = response.zoneCount;
      activateButton.textContent = 'Select an area';
      activateButton.style.backgroundColor = '#007acc';
      captureButton.disabled = response.zoneCount === 0;
    }
  } catch (error) {
    console.error('Error checking state:', error);
  }

  function updateButtonStates() {
    if (isSelectionMode) {
      activateButton.textContent = 'Stop selection';
      activateButton.style.backgroundColor = '#dc3545';
      captureButton.disabled = false;
    } else {
      activateButton.textContent = 'Select an area';
      activateButton.style.backgroundColor = '#007acc';
      captureButton.disabled = zoneCount === 0;
    }
  }

  activateButton.addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "START_SNAPZONE" });
      window.close();
    } catch (error) {
      console.error('Error starting snapzone:', error);
    }
  });

  captureButton.addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_SNAPZONE" });
      window.close();
    } catch (error) {
      console.error('Error capturing snapzone:', error);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "STATE_UPDATE") {
      isSelectionMode = message.isActive;
      zoneCount = message.zoneCount;
      updateButtonStates();
    }
  });
});