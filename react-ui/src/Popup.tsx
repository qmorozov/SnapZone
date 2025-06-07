import React, { useEffect, useState } from 'react';

export default function Popup() {
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [zoneCount, setZoneCount] = useState(0);

  useEffect(() => {
    async function fetchState() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'CHECK_STATE' });
        setIsSelectionMode(response.isActive);
        setZoneCount(response.zoneCount);
      } catch (err) {
        console.error('Error checking state:', err);
      }
    }
    fetchState();

    const listener = (message) => {
      if (message.type === 'STATE_UPDATE') {
        setIsSelectionMode(message.isActive);
        setZoneCount(message.zoneCount);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const activate = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'START_SNAPZONE' });
    window.close();
  };

  const capture = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_SNAPZONE' });
    window.close();
  };

  const isMac = navigator.platform.includes('Mac');
  const modKey = isMac ? '⌘' : 'Ctrl';

  return (
    <div className="container">
      <button id="activate" className="button" onClick={activate} style={{ backgroundColor: isSelectionMode ? '#dc3545' : '#007acc' }}>
        {isSelectionMode ? 'Stop selection' : 'Select Area'}
        <span className="shortcut" id="start-shortcut">{`${modKey}+⇧+S`}</span>
      </button>
      <button id="capture" className="button" onClick={capture} disabled={zoneCount === 0}>
        Take Screenshot
        <span className="shortcut" id="capture-shortcut">{`${modKey}+⇧+X`}</span>
      </button>

      <div className="shortcuts-section">
        <div className="shortcuts-title">Keyboard Shortcuts</div>
        <div className="shortcut-grid">
          <div className="shortcut-item">
            <span>Start selection</span>
            <span className="shortcut-keys" id="start-keys">{`${modKey}+Shift+S`}</span>
          </div>
          <div className="shortcut-item">
            <span>Take screenshot</span>
            <span className="shortcut-keys" id="capture-keys">{`${modKey}+Shift+X`}</span>
          </div>
          <div className="shortcut-item">
            <span>Save screenshot</span>
            <span className="shortcut-keys" id="save-keys">{`${modKey}+Shift+Z`}</span>
          </div>
          <div className="divider"></div>
          <div className="shortcut-item">
            <span>Cancel selection</span>
            <span className="shortcut-keys">ESC</span>
          </div>
          <div className="shortcut-item">
            <span>Delete selected zone</span>
            <span className="shortcut-keys">Delete</span>
          </div>
        </div>
        <div className="note">Also available through the page context menu (right-click)</div>
      </div>
    </div>
  );
}
