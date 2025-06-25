import { useEffect } from 'react';

// Placeholder implementation converting content.js logic into a React hook.
// This hook listens for messages from the extension and triggers overlay logic.
export default function useSnapZone() {
  useEffect(() => {
    function handleMessage(message, sender, sendResponse) {
      switch (message.type) {
        case 'START_SNAPZONE':
          // TODO: implement overlay start logic
          break;
        case 'CAPTURE_SNAPZONE':
          // TODO: implement screenshot capture logic
          break;
        case 'CHECK_STATE':
          sendResponse({ isActive: false, zoneCount: 0 });
          break;
        default:
          break;
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);
}
