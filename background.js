chrome.runtime.onInstalled.addListener(() => {
    console.log("SnapZone installed");
    
    chrome.contextMenus.create({
        id: "snapzone-parent",
        title: "SnapZone",
        contexts: ["page"]
    });

    const isMac = navigator.platform.includes('Mac');
    const modKey = isMac ? '⌘' : 'Ctrl';
    
    chrome.contextMenus.create({
        id: "start-snapzone",
        parentId: "snapzone-parent",
        title: `Select Area (${modKey}+Shift+S)`,
        contexts: ["page"]
    });

    chrome.contextMenus.create({
        id: "capture-snapzone",
        parentId: "snapzone-parent",
        title: `Take Screenshot (${modKey}+Shift+X)`,
        contexts: ["page"]
    });

    chrome.contextMenus.create({
        id: "save-snapzone",
        parentId: "snapzone-parent",
        title: `Save Screenshot (${modKey}+Shift+Z)`,
        contexts: ["page"]
    });

    chrome.contextMenus.create({
        id: "snapzone-separator",
        parentId: "snapzone-parent",
        type: "separator",
        contexts: ["page"]
    });

    chrome.contextMenus.create({
        id: "cancel-snapzone",
        parentId: "snapzone-parent",
        title: "Cancel Selection (ESC)",
        contexts: ["page"]
    });

    chrome.contextMenus.create({
        id: "delete-zone",
        parentId: "snapzone-parent",
        title: "Delete Selected Zone (Delete)",
        contexts: ["page"]
    });
});

chrome.commands.onCommand.addListener(async (command) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    if (command === "start-snapzone") {
        chrome.tabs.sendMessage(tab.id, { type: "START_SNAPZONE" });
    } else if (command === "capture-snapzone") {
        chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_SNAPZONE" });
    } else if (command === "save-snapzone") {
        chrome.tabs.sendMessage(tab.id, { type: "SAVE_SNAPZONE" });
    }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab) return;

    switch (info.menuItemId) {
        case "start-snapzone":
            chrome.tabs.sendMessage(tab.id, { type: "START_SNAPZONE" });
            break;
        case "capture-snapzone":
            chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_SNAPZONE" });
            break;
        case "save-snapzone":
            chrome.tabs.sendMessage(tab.id, { type: "SAVE_SNAPZONE" });
            break;
        case "cancel-snapzone":
            chrome.tabs.sendMessage(tab.id, { type: "CANCEL_SNAPZONE" });
            break;
        case "delete-zone":
            chrome.tabs.sendMessage(tab.id, { type: "DELETE_SELECTED_ZONE" });
            break;
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "CAPTURE_VISIBLE_TAB") {
        chrome.tabs.captureVisibleTab(null, { format: 'png' })
            .then(dataUrl => {
                sendResponse({ dataUrl });
            })
            .catch(error => {
                console.error('Error capturing visible tab:', error);
                sendResponse({ error: error.message });
            });
        return true;
    }
    
    if (message.type === "CAPTURE_AREA") {
        chrome.tabs.sendMessage(sender.tab.id, {
            type: "PROCESS_CAPTURE",
            area: message.area
        }, (response) => {
            sendResponse(response);
        });
        return true;
    }

    if (message.type === "STATE_UPDATE") {
        try {
            if (message.isActive) {
                chrome.contextMenus.update("start-snapzone", { enabled: true });
                chrome.contextMenus.update("capture-snapzone", { enabled: message.zoneCount > 0 });
                chrome.contextMenus.update("save-snapzone", { enabled: message.zoneCount > 0 });
                chrome.contextMenus.update("cancel-snapzone", { enabled: true });
                chrome.contextMenus.update("delete-zone", { enabled: true });
            } else {
                chrome.contextMenus.update("start-snapzone", { enabled: true });
                chrome.contextMenus.update("capture-snapzone", { enabled: false });
                chrome.contextMenus.update("save-snapzone", { enabled: false });
                chrome.contextMenus.update("cancel-snapzone", { enabled: false });
                chrome.contextMenus.update("delete-zone", { enabled: false });
            }
            chrome.runtime.sendMessage(message);
        } catch (error) {
            console.error('Error updating context menu:', error);
        }
        return false;
    }
});