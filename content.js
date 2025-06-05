function initStyles() {
    const existingStyles = document.querySelectorAll('link[href*="content.css"]');
    existingStyles.forEach(style => style.remove());

    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('content.css');
    document.head.appendChild(styleLink);
}

initStyles();

let snapZones = [];
let isActive = false;
let currentRect = null;
let isDrawing = false;
let isDragging = false;
let isResizing = false;
let selectedZone = null;
let startX = 0;
let startY = 0;
let dragOffsetX = 0;
let dragOffsetY = 0;
let minDragDistance = 10;
let resizeCorner = null;
let overlay = null;

let handlers = {
    mousedown: null,
    mousemove: null,
    mouseup: null,
    keydown: null
};

const scrollContainers = new Set();
const containerOverlays = new Map();
let hiddenStickyElements = [];

function registerScrollContainer(container) {
    if (!scrollContainers.has(container)) {
        container.addEventListener('scroll', updateZonePositions, { passive: true });
        scrollContainers.add(container);
    }
}

function unregisterScrollContainers() {
    scrollContainers.forEach(c => c.removeEventListener('scroll', updateZonePositions));
    scrollContainers.clear();
}

function getOverlayForContainer(container) {
    if (container === window) return document.body;
    if (!containerOverlays.has(container)) {
        const rect = container.getBoundingClientRect();
        const overlay = document.createElement('div');
        overlay.className = 'snapzone-scroll-overlay';
        overlay.style.left = rect.left + 'px';
        overlay.style.top = rect.top + 'px';
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';
        document.body.appendChild(overlay);
        containerOverlays.set(container, overlay);
    }
    return containerOverlays.get(container);
}

function removeContainerOverlays() {
    containerOverlays.forEach(overlay => overlay.remove());
    containerOverlays.clear();
}

function updateZonePositions() {
    scrollContainers.forEach(container => {
        if (container !== window && containerOverlays.has(container)) {
            const rect = container.getBoundingClientRect();
            const overlay = containerOverlays.get(container);
            overlay.style.left = rect.left + 'px';
            overlay.style.top = rect.top + 'px';
            overlay.style.width = rect.width + 'px';
            overlay.style.height = rect.height + 'px';
        }
    });

    snapZones.forEach(zone => {
        const container = zone.scrollContainer || window;
        const scrollLeft = container === window ? window.scrollX : container.scrollLeft;
        const scrollTop = container === window ? window.scrollY : container.scrollTop;
        const left = zone.relativeLeft - scrollLeft;
        const top = zone.relativeTop - scrollTop;
        zone.left = (container === window ? 0 : container.getBoundingClientRect().left) + left;
        zone.top = (container === window ? 0 : container.getBoundingClientRect().top) + top;
        if (zone.element) {
            zone.element.style.left = left + 'px';
            zone.element.style.top = top + 'px';
        }
    });
}

function hideStickyElements() {
    hiddenStickyElements = [];
    document.querySelectorAll('*').forEach(el => {
        if (el.id === 'snapzone-overlay' || el.classList.contains('snapzone-preview-container')) return;
        const style = getComputedStyle(el);
        if ((style.position === 'fixed' || style.position === 'sticky') && parseInt(style.top || '0') < 100) {
            hiddenStickyElements.push({ el, prev: el.style.visibility });
            el.style.visibility = 'hidden';
        }
    });
}

function restoreStickyElements() {
    hiddenStickyElements.forEach(item => {
        item.el.style.visibility = item.prev;
    });
    hiddenStickyElements = [];
}

function getScrollableParent(el) {
    while (el && el !== document.body && el !== document.documentElement) {
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) {
            return el;
        }
        el = el.parentElement;
    }
    return null;
}

function waitForScrollEnd(node) {
    return new Promise(resolve => {
        let last = node === window ? window.scrollY : node.scrollTop;
        let stableFrames = 0;
        const check = () => {
            const curr = node === window ? window.scrollY : node.scrollTop;
            if (curr === last) {
                stableFrames++;
                if (stableFrames > 1) {
                    resolve();
                    return;
                }
            } else {
                stableFrames = 0;
                last = curr;
            }
            requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
    });
}

function scrollToTarget(node, top) {
    if (node === window) {
        window.scrollTo({ top, behavior: 'instant' });
    } else {
        node.scrollTo({ top, behavior: 'instant' });
    }
}

function waitForRender() {
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function handleMouseMove(e) {
    if (!isActive) return;

    const x = e.clientX + window.scrollX;
    const y = e.clientY + window.scrollY;

    if (isDrawing && currentRect) {
        const width = x - startX;
        const height = y - startY;

        const pageDimensions = getPageDimensions();
        const constrainedWidth = Math.min(width, pageDimensions.width - startX);
        const constrainedHeight = Math.min(height, pageDimensions.height - startY);

        currentRect.style.left = (constrainedWidth < 0 ? Math.max(0, x) : startX) + 'px';
        currentRect.style.top = (constrainedHeight < 0 ? Math.max(0, y) : startY) + 'px';
        currentRect.style.width = Math.abs(constrainedWidth) + 'px';
        currentRect.style.height = Math.abs(constrainedHeight) + 'px';
    } else if (isDragging && selectedZone) {
        const constrained = constrainToPage(
            x - dragOffsetX,
            y - dragOffsetY,
            selectedZone.width,
            selectedZone.height
        );

        selectedZone.element.style.left = constrained.x + 'px';
        selectedZone.element.style.top = constrained.y + 'px';

        selectedZone.left = constrained.x;
        selectedZone.top = constrained.y;
        if (selectedZone.scrollContainer) {
            const container = selectedZone.scrollContainer;
            const rect = container === window ? { left: 0, top: 0 } : container.getBoundingClientRect();
            const scrollLeft = container === window ? window.scrollX : container.scrollLeft;
            const scrollTop = container === window ? window.scrollY : container.scrollTop;
            selectedZone.relativeLeft = constrained.x - rect.left + scrollLeft;
            selectedZone.relativeTop = constrained.y - rect.top + scrollTop;
        }
    } else if (isResizing && selectedZone && resizeCorner) {
        let newLeft = selectedZone.left;
        let newTop = selectedZone.top;
        let newWidth = selectedZone.width;
        let newHeight = selectedZone.height;
        const pageDimensions = getPageDimensions();

        if (resizeCorner.corner.includes('left')) {
            const maxLeftMove = selectedZone.left + selectedZone.width - 20;
            newWidth = Math.max(20, selectedZone.left + selectedZone.width - Math.min(maxLeftMove, Math.max(0, x)));
            newLeft = Math.min(maxLeftMove, Math.max(0, x));
        } else if (resizeCorner.corner.includes('right')) {
            newWidth = Math.max(20, Math.min(pageDimensions.width - selectedZone.left, x - selectedZone.left));
        }

        if (resizeCorner.corner.includes('top')) {
            const maxTopMove = selectedZone.top + selectedZone.height - 20;
            newHeight = Math.max(20, selectedZone.top + selectedZone.height - Math.min(maxTopMove, Math.max(0, y)));
            newTop = Math.min(maxTopMove, Math.max(0, y));
        } else if (resizeCorner.corner.includes('bottom')) {
            newHeight = Math.max(20, Math.min(pageDimensions.height - selectedZone.top, y - selectedZone.top));
        }

        selectedZone.element.style.left = newLeft + 'px';
        selectedZone.element.style.top = newTop + 'px';
        selectedZone.element.style.width = newWidth + 'px';
        selectedZone.element.style.height = newHeight + 'px';

        selectedZone.left = newLeft;
        selectedZone.top = newTop;
        selectedZone.width = newWidth;
        selectedZone.height = newHeight;
        if (selectedZone.scrollContainer) {
            const container = selectedZone.scrollContainer;
            const rect = container === window ? { left: 0, top: 0 } : container.getBoundingClientRect();
            const scrollLeft = container === window ? window.scrollX : container.scrollLeft;
            const scrollTop = container === window ? window.scrollY : container.scrollTop;
            selectedZone.relativeLeft = newLeft - rect.left + scrollLeft;
            selectedZone.relativeTop = newTop - rect.top + scrollTop;
        }
    }

        if (!e.target.closest('.snapzone-controls')) {
        const hoverZone = findZoneAtPoint(x, y);
        if (hoverZone) {
            const corner = getResizeCorner(hoverZone, x, y);
            document.body.style.cursor = corner ? corner.cursor : 'move';
        } else {
            document.body.style.cursor = 'crosshair';
            }
        }
}

function getPageDimensions() {
    const body = document.body;
    const html = document.documentElement;

    const width = Math.max(
        body.scrollWidth,
        body.offsetWidth,
        html.clientWidth,
        html.scrollWidth,
        html.offsetWidth
    );

    const height = Math.max(
        body.scrollHeight,
        body.offsetHeight,
        html.clientHeight,
        html.scrollHeight,
        html.offsetHeight
    );

    return { width, height };
}

function getViewportDimensions() {
    return {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight
    };
}

function constrainToPage(x, y, width, height) {
    const pageDimensions = getPageDimensions();
    const viewportDimensions = getViewportDimensions();
    
    const maxWidth = Math.min(pageDimensions.width, viewportDimensions.width);
    
    return {
        x: Math.max(0, Math.min(x, maxWidth - width)),
        y: Math.max(0, Math.min(y, pageDimensions.height - height))
    };
}

function findZoneAtPoint(x, y) {
    const elementsToIgnore = ['snapzone-controls', 'snapzone-button', 'snapzone-number'];
    const clickedElement = document.elementFromPoint(x - window.scrollX, y - window.scrollY);
    
    if (clickedElement) {
        const elementClassName = clickedElement.className?.baseVal || clickedElement.className || '';
        if (typeof elementClassName === 'string' && elementsToIgnore.some(className => elementClassName.includes(className))) {
            return null;
        }
    }
    
    return snapZones.find(zone => {
        return x >= zone.left && x <= zone.left + zone.width &&
               y >= zone.top && y <= zone.top + zone.height;
    });
}

function getResizeCorner(zone, x, y) {
    const threshold = 10;
    
    if (Math.abs(x - zone.left) <= threshold && Math.abs(y - zone.top) <= threshold) {
        return { corner: 'top-left', cursor: 'nw-resize' };
    }
    if (Math.abs(x - (zone.left + zone.width)) <= threshold && Math.abs(y - zone.top) <= threshold) {
        return { corner: 'top-right', cursor: 'ne-resize' };
    }
    if (Math.abs(x - zone.left) <= threshold && Math.abs(y - (zone.top + zone.height)) <= threshold) {
        return { corner: 'bottom-left', cursor: 'sw-resize' };
    }
    if (Math.abs(x - (zone.left + zone.width)) <= threshold && Math.abs(y - (zone.top + zone.height)) <= threshold) {
        return { corner: 'bottom-right', cursor: 'se-resize' };
    }
    if (Math.abs(x - zone.left) <= threshold) {
        return { corner: 'left', cursor: 'w-resize' };
    }
    if (Math.abs(x - (zone.left + zone.width)) <= threshold) {
        return { corner: 'right', cursor: 'e-resize' };
    }
    if (Math.abs(y - zone.top) <= threshold) {
        return { corner: 'top', cursor: 'n-resize' };
    }
    if (Math.abs(y - (zone.top + zone.height)) <= threshold) {
        return { corner: 'bottom', cursor: 's-resize' };
    }
    return null;
}

function handleMouseDown(e) {
    if (!isActive) return;

    const x = e.clientX + window.scrollX;
    const y = e.clientY + window.scrollY;

    if (e.target.closest('.snapzone-controls')) {
        return;
    }

    selectedZone = findZoneAtPoint(x, y);

    if (selectedZone) {
        e.preventDefault();
        e.stopPropagation();
        
        highlightZone(selectedZone);
        resizeCorner = getResizeCorner(selectedZone, x, y);
        
        if (resizeCorner) {
            isResizing = true;
            document.body.style.cursor = resizeCorner.cursor;
            startX = x;
            startY = y;
        } else {
            isDragging = true;
            document.body.style.cursor = 'move';
            dragOffsetX = x - selectedZone.left;
            dragOffsetY = y - selectedZone.top;
        }
    } else {
        clearAllHighlights();
        selectedZone = null;
        isDrawing = true;
        startX = x;
        startY = y;

        currentRect = document.createElement('div');
        currentRect.className = 'snapzone-rect-drawing';
        currentRect.style.left = x + 'px';
        currentRect.style.top = y + 'px';
        currentRect.style.width = '0px';
        currentRect.style.height = '0px';
        document.body.appendChild(currentRect);
    }
}

function handleMouseUp(e) {
    if (!isActive) return;

    if (isDrawing && currentRect) {
        const rect = currentRect.getBoundingClientRect();
        const width = Math.abs(rect.width);
        const height = Math.abs(rect.height);

        if (width > minDragDistance && height > minDragDistance) {
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const elementAtCenter = document.elementFromPoint(centerX, centerY);
            const container = getScrollableParent(elementAtCenter) || window;
            const containerRect = container === window ? { left: 0, top: 0 } : container.getBoundingClientRect();
            const scrollLeft = container === window ? window.scrollX : container.scrollLeft;
            const scrollTop = container === window ? window.scrollY : container.scrollTop;

            const overlayParent = getOverlayForContainer(container);
            overlayParent.appendChild(currentRect);

            const zone = {
                id: Date.now(),
                left: rect.left + window.scrollX,
                top: rect.top + window.scrollY,
                width: width,
                height: height,
                element: currentRect,
                scrollContainer: container,
                relativeLeft: rect.left - containerRect.left + scrollLeft,
                relativeTop: rect.top - containerRect.top + scrollTop
            };

            registerScrollContainer(container);
            updateZonePositions();

            currentRect.className = 'snapzone-rect-saved';
            snapZones.push(zone);
            
            addZoneControls(zone);
            updateZoneNumbers();
            
            showNotification(`Zone created. Total zones: ${snapZones.length}`);

            chrome.runtime.sendMessage({ 
                type: "STATE_UPDATE", 
                isActive: true, 
                zoneCount: snapZones.length 
            });
        } else {
            currentRect.remove();
        }

        currentRect = null;
        isDrawing = false;
    }
    
        isDragging = false;
        isResizing = false;
        document.body.style.cursor = 'crosshair';
}

function handleKeyDown(e) {
    if (!isActive) return;

    if (e.key === 'Escape') {
        stopSnapZone();
        showNotification('Selection mode deactivated. To create a new screenshot, use the extension button');
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedZone) {
        deleteZone(selectedZone);
        selectedZone = null;
    }
}

function highlightZone(zone) {
    clearAllHighlights();
    if (zone.element) {
        zone.element.className = 'snapzone-rect-saved snapzone-rect-selected';
    }
}

function clearAllHighlights() {
    snapZones.forEach(zone => {
        if (zone.element) {
            zone.element.className = 'snapzone-rect-saved';
        }
    });
}

window.startSnapZone = function () {
    if (isActive) {
        stopSnapZone();
        return;
    }

    const existingPreview = document.querySelector('.snapzone-preview-container');
    if (existingPreview) {
        existingPreview.remove();
    }

    isActive = true;
    document.body.style.cursor = 'crosshair';
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';

    overlay = createOverlay();
    document.body.appendChild(overlay);

    registerScrollContainer(window);

    showNotification('Selection mode active. ESC - exit, Delete - remove zone');

    handlers.mousedown = handleMouseDown;
    handlers.mousemove = handleMouseMove;
    handlers.mouseup = handleMouseUp;
    handlers.keydown = handleKeyDown;

    document.addEventListener('mousedown', handlers.mousedown);
    document.addEventListener('mousemove', handlers.mousemove);
    document.addEventListener('mouseup', handlers.mouseup);
    document.addEventListener('keydown', handlers.keydown);

    chrome.runtime.sendMessage({ type: "STATE_UPDATE", isActive: true, zoneCount: snapZones.length });

    console.log('Selection mode activated');
};

function stopSnapZone() {
    isActive = false;
    isDrawing = false;
    isDragging = false;
    isResizing = false;
    selectedZone = null;
    resizeCorner = null;

    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';

    if (currentRect) {
        currentRect.remove();
        currentRect = null;
    }

    snapZones.forEach(zone => {
        if (zone.element) zone.element.remove();
    });
    snapZones = [];

    if (overlay) {
        overlay.remove();
        overlay = null;
    }

    removeContainerOverlays();

    unregisterScrollContainers();

    document.removeEventListener('mousedown', handlers.mousedown);
    document.removeEventListener('mousemove', handlers.mousemove);
    document.removeEventListener('mouseup', handlers.mouseup);
    document.removeEventListener('keydown', handlers.keydown);

    hideNotification();

    chrome.runtime.sendMessage({ type: "STATE_UPDATE", isActive: false, zoneCount: 0 });

    console.log('Selection mode deactivated, all zones removed');
}

window.stopSnapZone = stopSnapZone;

function createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'snapzone-overlay';
    return overlay;
}

function showNotification(message) {
    hideNotification();

    const notification = document.createElement('div');
    notification.id = 'snapzone-notification';
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(hideNotification, 3000);
}

function hideNotification() {
    const existing = document.getElementById('snapzone-notification');
    if (existing) existing.remove();
}

function addZoneControls(zone) {
    const controls = document.createElement('div');
    controls.className = 'snapzone-controls';
    controls.style.position = 'absolute';
    controls.style.top = '5px';
    controls.style.right = '5px';
    controls.style.zIndex = '999999';
    controls.style.display = snapZones.length > 1 ? 'flex' : 'none';
    
    const upButton = document.createElement('button');
    upButton.className = 'snapzone-button';
    upButton.title = 'Move up';
    upButton.textContent = '↑';
    upButton.onclick = (e) => {
        e.stopPropagation();
        moveZone(zone.id, 'up');
    };
    
    const downButton = document.createElement('button');
    downButton.className = 'snapzone-button';
    downButton.title = 'Move down';
    downButton.textContent = '↓';
    downButton.onclick = (e) => {
        e.stopPropagation();
        moveZone(zone.id, 'down');
    };
    
    controls.appendChild(upButton);
    controls.appendChild(downButton);
    zone.element.appendChild(controls);
}

function updateZoneNumbers() {
    snapZones.forEach((zone, index) => {
        let numberElement = zone.element.querySelector('.snapzone-number');
        let controls = zone.element.querySelector('.snapzone-controls');

        const shouldShowControls = snapZones.length > 1;
        
        if (!numberElement) {
            numberElement = document.createElement('div');
            numberElement.className = 'snapzone-number';
            zone.element.appendChild(numberElement);
        }
        
        if (shouldShowControls) {
            numberElement.textContent = (index + 1).toString();
            numberElement.style.display = 'block';
            if (controls) controls.style.display = 'flex';
        } else {
            numberElement.style.display = 'none';
            if (controls) controls.style.display = 'none';
        }
    });
}

function moveZone(zoneId, direction) {
    const currentIndex = snapZones.findIndex(zone => zone.id === zoneId);
    if (currentIndex === -1) return;
    
    const newIndex = direction === 'up' ? 
        Math.max(0, currentIndex - 1) : 
        Math.min(snapZones.length - 1, currentIndex + 1);
        
    if (currentIndex !== newIndex) {
        const [zone] = snapZones.splice(currentIndex, 1);
        snapZones.splice(newIndex, 0, zone);
        updateZoneNumbers();
    }
}

function deleteZone(zone) {
    const index = snapZones.findIndex(z => z.id === zone.id);
    if (index !== -1) {
        zone.element.remove();
        if (zone.scrollContainer !== window && containerOverlays.has(zone.scrollContainer)) {
            const hasOther = snapZones.some(z => z.scrollContainer === zone.scrollContainer && z.id !== zone.id);
            if (!hasOther) {
                const overlay = containerOverlays.get(zone.scrollContainer);
                overlay.remove();
                containerOverlays.delete(zone.scrollContainer);
            }
        }
        snapZones.splice(index, 1);
        
        if (snapZones.length === 0) {
            showNotification('All zones removed. To create a new screenshot, use the extension button');
            stopSnapZone();
        } else {
            showNotification(`Zone removed. Remaining zones: ${snapZones.length}`);
            updateZoneNumbers();
        }
        
        chrome.runtime.sendMessage({ 
            type: "STATE_UPDATE", 
            isActive: snapZones.length > 0, 
            zoneCount: snapZones.length 
        });
    }
}

// Add message listener for capture processing
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "START_SNAPZONE") {
        window.startSnapZone();
        return;
    }
    
    if (message.type === "CAPTURE_SNAPZONE") {
        window.captureSnapZone();
        return;
    }

    if (message.type === "SAVE_SNAPZONE") {
        const previewContainer = document.querySelector('.snapzone-preview-container');
        if (previewContainer) {
            const saveButton = previewContainer.querySelector('.snapzone-preview-button');
            if (saveButton) {
                saveButton.click();
            }
        }
        return;
    }

    if (message.type === "CANCEL_SNAPZONE") {
        stopSnapZone();
        showNotification('Screenshot cancelled');
        return;
    }

    if (message.type === "DELETE_SELECTED_ZONE") {
        if (selectedZone) {
            deleteZone(selectedZone);
            selectedZone = null;
        }
        return;
    }
    
    if (message.type === "CHECK_STATE") {
        sendResponse({ isActive: isActive, zoneCount: snapZones.length });
    }
});

async function processCapture(area) {
    try {
        const response = await chrome.runtime.sendMessage({ 
            type: "CAPTURE_VISIBLE_TAB",
            options: { format: 'png', quality: 100 }
        });

        if (response.error) {
            throw new Error(response.error);
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
                    
                    const devicePixelRatio = window.devicePixelRatio || 1;

                    canvas.width = area.width * devicePixelRatio;
                    canvas.height = area.height * devicePixelRatio;
                    
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);

                    const actualX = area.x * devicePixelRatio;
                    const actualY = area.y * devicePixelRatio;
                    const actualWidth = area.width * devicePixelRatio;
                    const actualHeight = area.height * devicePixelRatio;
                    
                    ctx.drawImage(
                        img,
                        actualX,
                        actualY,
                        actualWidth,
                        actualHeight,
                        0,
                        0,
                        canvas.width,
                        canvas.height
                    );
                    
                    resolve(canvas.toDataURL('image/png', 1.0));
                } catch (error) {
                    reject(new Error(`Failed to process image: ${error.message}`));
                }
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = response.dataUrl;
        });
    } catch (error) {
        throw new Error(`Failed to process capture: ${error.message}`);
    }
}

async function captureZoneInChunks(zone) {
    const container = zone.scrollContainer || window;
    const viewportHeight = container === window ? window.innerHeight : container.clientHeight;
    const maxChunkHeight = Math.min(viewportHeight - 100, 800);
    const totalHeight = zone.height;
    const chunks = [];
    
    const numChunks = Math.ceil(totalHeight / maxChunkHeight);
    
    if (numChunks > 10) {
        const shouldProceed = await showConfirmation(
            `This selection is very large (${numChunks} screens). Capturing it may take some time. Continue?`
        );
        if (!shouldProceed) {
            throw new Error('Capture cancelled by user');
        }
    }

    const originalScroll = container === window ? window.scrollY : container.scrollTop;
    let capturedHeight = 0;

    try {
        for (let i = 0; i < numChunks; i++) {
            const remainingHeight = totalHeight - capturedHeight;
            const chunkHeight = Math.min(remainingHeight, maxChunkHeight);

            const scrollTarget = zone.relativeTop + capturedHeight;

            showNotification(`Capturing part ${i + 1} of ${numChunks}...`);

            scrollToTarget(container, scrollTarget);

            await waitForScrollEnd(container);
            await waitForRender();

            const containerRect = container === window ? { left: 0, top: 0 } : container.getBoundingClientRect();
            const scrollLeft = container === window ? window.scrollX : container.scrollLeft;
            const captureX = Math.round(containerRect.left + zone.relativeLeft - scrollLeft);
            const captureY = Math.round(containerRect.top);

            const dataUrl = await processCapture({
                x: captureX,
                y: captureY,
                width: Math.round(zone.width),
                height: Math.round(chunkHeight)
            });
            
            chunks.push({
                imageData: dataUrl,
                width: zone.width,
                height: chunkHeight,
                offset: capturedHeight
            });
            
            capturedHeight += chunkHeight;
        }
        
        return await combineChunks(chunks, zone.width, zone.height);
    } finally {
        scrollToTarget(container, originalScroll);
    }
}

async function combineChunks(chunks, totalWidth, totalHeight) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
        
        const devicePixelRatio = window.devicePixelRatio || 1;
        
        canvas.width = totalWidth * devicePixelRatio;
        canvas.height = totalHeight * devicePixelRatio;
        
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        let loadedChunks = 0;
        
        chunks.forEach(chunk => {
            const img = new Image();
            img.onload = () => {
                const y = chunk.offset * devicePixelRatio;
                ctx.drawImage(img, 0, y);
                
                loadedChunks++;
                if (loadedChunks === chunks.length) {
                    resolve(canvas.toDataURL('image/png', 1.0));
                }
            };
            img.src = chunk.imageData;
        });
    });
}

function showConfirmation(message) {
    return new Promise((resolve) => {
        const container = document.createElement('div');
        container.className = 'snapzone-confirmation';
        container.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
            z-index: 1000000;
            text-align: center;
        `;
        
        const text = document.createElement('p');
        text.textContent = message;
        text.style.marginBottom = '20px';
        
        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.justifyContent = 'center';
        
        const confirmButton = document.createElement('button');
        confirmButton.className = 'snapzone-preview-button';
        confirmButton.textContent = 'Continue';
        confirmButton.onclick = () => {
            container.remove();
            resolve(true);
        };
        
        const cancelButton = document.createElement('button');
        cancelButton.className = 'snapzone-preview-button cancel';
        cancelButton.textContent = 'Cancel';
        cancelButton.onclick = () => {
            container.remove();
            resolve(false);
        };
        
        buttonContainer.appendChild(confirmButton);
        buttonContainer.appendChild(cancelButton);
        
        container.appendChild(text);
        container.appendChild(buttonContainer);
        document.body.appendChild(container);
    });
}

window.captureSnapZone = async function() {
    const previewContainer = document.querySelector('.snapzone-preview-container');
    if (previewContainer) {
        previewContainer.style.visibility = 'hidden';
    }

    if (snapZones.length === 0) {
        try {
            showNotification('Creating screenshot...');
            const response = await captureVisibleArea();
            if (response.error) {
                throw new Error(response.error);
            }
            showPreview(response.dataUrl);
        } catch (error) {
            console.error('Error capturing visible area:', error);
            showNotification('Error creating screenshot');
            stopSnapZone();
        }
        return;
    }

    try {
        showNotification('Creating screenshot...');
        
        const notification = document.getElementById('snapzone-notification');
        if (notification) notification.style.visibility = 'hidden';
        
        snapZones.forEach(zone => {
            if (zone.element) {
                zone.element.style.visibility = 'hidden';
            }
        });
        if (overlay) overlay.style.visibility = 'hidden';
        hideStickyElements();
        updateZonePositions();

        await new Promise(resolve => setTimeout(resolve, 100));

        try {
            const sortedZones = [...snapZones];
            const captures = [];
            
            for (let i = 0; i < sortedZones.length; i++) {
                const zone = sortedZones[i];
                showNotification(`Capturing zone ${i + 1} of ${sortedZones.length}...`);
                
                const dataUrl = await captureZoneInChunks(zone);
                
                captures.push({
                    imageData: dataUrl,
                    width: zone.width,
                    height: zone.height
                });
            }
            
            const combinedImage = await combineCaptures(captures);
            showPreview(combinedImage);
            
        } finally {
            if (notification) notification.style.visibility = 'visible';
            snapZones.forEach(zone => {
                if (zone.element) {
                    zone.element.style.visibility = 'visible';
                }
            });
            restoreStickyElements();
            if (overlay) overlay.style.visibility = 'visible';
            if (previewContainer) {
                previewContainer.style.visibility = 'visible';
            }
        }
    } catch (error) {
        console.error('Error capturing zones:', error);
        showNotification('Error creating screenshot');
        stopSnapZone();

        snapZones.forEach(zone => {
            if (zone.element) {
                zone.element.style.visibility = 'visible';
            }
        });
        restoreStickyElements();
        if (overlay) overlay.style.visibility = 'visible';
        if (previewContainer) {
            previewContainer.style.visibility = 'visible';
        }
    }
};

async function captureVisibleArea() {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ 
            type: "CAPTURE_VISIBLE_TAB"
        }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response);
            }
        });
    });
}

function showPreview(dataUrl) {
    const existingPreview = document.querySelector('.snapzone-preview-container');
    if (existingPreview) {
        existingPreview.remove();
    }

    const container = document.createElement('div');
    container.className = 'snapzone-preview-container';
    
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'snapzone-preview-scroll';
    
    const img = document.createElement('img');
    img.src = dataUrl;
    scrollContainer.appendChild(img);
    
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'snapzone-preview-input';
    nameInput.placeholder = 'Enter filename';
    nameInput.value = 'screenshot-' + new Date().toISOString().slice(0,19).replace(/[^0-9]/g, '');
    
    const controls = document.createElement('div');
    controls.className = 'snapzone-preview-controls';
    
    const downloadButton = document.createElement('button');
    downloadButton.className = 'snapzone-preview-button';
    downloadButton.textContent = 'Save';
    downloadButton.onclick = () => {
        const filename = (nameInput.value.trim() || 'screenshot') + '.png';
        downloadImage(dataUrl, filename);
        container.remove();
        stopSnapZone();
        showNotification('Screenshot saved! To create a new one, use the extension button or right-click menu');
    };

    const copyButton = document.createElement('button');
    copyButton.className = 'snapzone-preview-button copy';
    copyButton.textContent = 'Copy';
    copyButton.onclick = async () => {
        try {
            await copyImageToClipboard(dataUrl);
            showNotification('Copied to clipboard');
        } catch (err) {
            console.error('Copy failed:', err);
            showNotification('Failed to copy');
        }
    };
    
    const newCaptureButton = document.createElement('button');
    newCaptureButton.className = 'snapzone-preview-button secondary';
    newCaptureButton.textContent = 'New Screenshot';
    newCaptureButton.onclick = () => {
        container.remove();
        startSnapZone();
    };
    
    const cancelButton = document.createElement('button');
    cancelButton.className = 'snapzone-preview-button cancel';
    cancelButton.textContent = 'Cancel';
    cancelButton.onclick = () => {
        container.remove();
        stopSnapZone();
        showNotification('Screenshot cancelled');
    };
    
    controls.appendChild(downloadButton);
    controls.appendChild(copyButton);
    controls.appendChild(newCaptureButton);
    controls.appendChild(cancelButton);
    
    container.appendChild(scrollContainer);
    container.appendChild(nameInput);
    container.appendChild(controls);
    document.body.appendChild(container);

    container.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });
    
    isActive = false;
}

function downloadImage(dataUrl, filename) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.click();
}

async function copyImageToClipboard(dataUrl) {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}

async function combineCaptures(captures) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
        
        const devicePixelRatio = window.devicePixelRatio || 1;
        
        let totalHeight = 0;
        let maxWidth = 0;
        captures.forEach(capture => {
            totalHeight += capture.height * devicePixelRatio;
            maxWidth = Math.max(maxWidth, capture.width * devicePixelRatio);
        });
        
        canvas.width = maxWidth;
        canvas.height = totalHeight;
        
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        let currentY = 0;
        let loadedImages = 0;
        
        captures.forEach(capture => {
            const img = new Image();
            img.onload = () => {
                const x = Math.max(0, (maxWidth - (capture.width * devicePixelRatio)) / 2);
                ctx.drawImage(img, x, currentY);
                currentY += capture.height * devicePixelRatio;
                
                loadedImages++;
                if (loadedImages === captures.length) {
                    resolve(canvas.toDataURL('image/png', 1.0));
                }
            };
            img.src = capture.imageData;
        });
    });
}