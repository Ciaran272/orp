// 智能卡片截图助手 - 内容脚本

let isManualSelectMode = false;
let isFreeSelectionMode = false;
let highlightedElement = null;
let overlayElement = null;
let selectionBox = null;
let startX = 0, startY = 0;
let currentImageIndex = 0;
let selectedElements = [];  // 存储多选的元素
let isCtrlPressed = false;  // Ctrl键状态

// 控制标志
let isPaused = false;
let isStopped = false;

// 浮动控制面板
let floatingControlPanel = null;

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Ping检查：用于检测content.js是否已注入
    if (request.action === 'ping') {
        sendResponse({ success: true, message: 'content.js已就绪' });
        return true;
    }
    
    if (request.action === 'detectElements') {
        detectElements(request.selector, sendResponse);
        return true;
    }

    if (request.action === 'captureElements') {
        captureElements(request.options, sendResponse);
        return true;
    }

    if (request.action === 'captureVisible') {
        captureVisibleArea(request.options, sendResponse);
        return true;
    }

    if (request.action === 'enableManualSelect') {
        enableManualSelect(request.options);
        sendResponse({ success: true });
        return true;
    }

    if (request.action === 'enableFreeSelection') {
        // 异步调用自由截图
        enableFreeSelection(request.options).then(() => {
            sendResponse({ success: true });
        }).catch(error => {
            console.error('启用自由截图失败:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true; // 异步响应
    }
    
    if (request.action === 'showScreenshotOverlay') {
        // 接收截图数据并显示覆盖层
        console.log('📥 收到截图数据，长度:', request.dataUrl ? request.dataUrl.length : 0);
        createScreenshotOverlay(request.dataUrl, request.options);
        sendResponse({ success: true });
        return true;
    }

    if (request.action === 'screenshotFailed') {
        // 截图失败，显示错误提示
        console.error('❌ background.js 通知截图失败:', request.error);
        
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: rgba(255, 107, 107, 0.95); color: white; padding: 20px 40px;
            border-radius: 10px; font-size: 16px; z-index: 2147483645;
            font-family: 'Microsoft YaHei', sans-serif;
        `;
        errorDiv.textContent = '❌ 截图失败: ' + request.error;
        document.body.appendChild(errorDiv);
        setTimeout(() => errorDiv.remove(), 3000);
        
        isFreeSelectionMode = false;
        sendResponse({ success: true });
        return true;
    }

    if (request.action === 'aiDetectAndCapture') {
        aiDetectAndCapture(request.options, sendResponse);
        return true;
    }
    
    if (request.action === 'pauseCapture') {
        isPaused = true;
        sendResponse({ success: true });
        return true;
    }
    
    if (request.action === 'resumeCapture') {
        isPaused = false;
        sendResponse({ success: true });
        return true;
    }
    
    if (request.action === 'stopCapture') {
        isStopped = true;
        isPaused = false;
        sendResponse({ success: true });
        return true;
    }
    
});

// 检测元素
function detectElements(selector, callback) {
    try {
        const nodeList = document.querySelectorAll(selector);
        // 转换为数组并去重（同一个元素可能匹配多个选择器）
        const uniqueElements = Array.from(new Set(Array.from(nodeList)));
        callback({ count: uniqueElements.length });
    } catch (error) {
        callback({ count: 0, error: error.message });
    }
}

// 使用Chrome API截取元素（file://协议专用）
async function captureElementWithChromeAPI(element) {
    // 获取元素位置和尺寸
    const rect = element.getBoundingClientRect();
    
    console.log('使用Chrome API截取元素，位置:', rect);
    
    // 通过background.js截取整个页面
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            action: 'captureVisibleTab',
            options: {}
        }, async (response) => {
            if (!response || !response.dataUrl) {
                reject(new Error('截图失败'));
                return;
            }
            
            try {
                // 加载截图
                const img = new Image();
                await new Promise((res, rej) => {
                    img.onload = res;
                    img.onerror = rej;
                    img.src = response.dataUrl;
                });
                
                // 计算缩放比例
                const scaleX = img.width / window.innerWidth;
                const scaleY = img.height / window.innerHeight;
                
                // 创建canvas并裁剪元素区域
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(rect.width * scaleX);
                canvas.height = Math.round(rect.height * scaleY);
                const ctx = canvas.getContext('2d');
                
                ctx.drawImage(img,
                    Math.round(rect.left * scaleX),
                    Math.round(rect.top * scaleY),
                    canvas.width,
                    canvas.height,
                    0, 0,
                    canvas.width,
                    canvas.height
                );
                
                resolve(canvas);
                
            } catch (error) {
                reject(error);
            }
        });
    });
}

// 截取多个元素
async function captureElements(options, callback) {
    // 重置控制标志
    isPaused = false;
    isStopped = false;
    
    try {
        console.log('自动识别开始，接收到的options:', options);
        
        const nodeList = document.querySelectorAll(options.selector);
        // 去重，避免同一个元素匹配多个选择器
        const elements = Array.from(new Set(Array.from(nodeList)));
        
        if (elements.length === 0) {
            callback({ success: false, error: '未找到匹配的元素' });
            return;
        }

        let successCount = 0;
        
        // 创建浮动控制面板
        createFloatingControlPanel();
        updateFloatingControlProgress(`准备截图 ${elements.length} 个元素...`);

        // 发送总数到popup
        chrome.runtime.sendMessage({ 
            action: 'updateProgress', 
            current: 0, 
            total: elements.length,
            status: '正在准备截图...'
        });

        for (let i = 0; i < elements.length; i++) {
            // 检查是否停止
            if (isStopped) {
                hideFloatingControlPanel();
                chrome.runtime.sendMessage({ 
                    action: 'captureStopped', 
                    count: successCount 
                });
                callback({ success: true, count: successCount, stopped: true });
                return;
            }
            
            // 检查是否暂停
            while (isPaused) {
                await sleep(100);
                if (isStopped) break;
            }
            
            if (isStopped) {
                hideFloatingControlPanel();
                chrome.runtime.sendMessage({ 
                    action: 'captureStopped', 
                    count: successCount 
                });
                callback({ success: true, count: successCount, stopped: true });
                return;
            }

            // 更新浮动控制面板进度
            updateFloatingControlProgress(`正在截图 ${i + 1}/${elements.length} (已完成 ${successCount})`);

            // 发送进度更新
            chrome.runtime.sendMessage({ 
                action: 'updateProgress', 
                current: i + 1, 
                total: elements.length,
                status: `正在截图第 ${i + 1}/${elements.length} 个元素`
            });
            
            // 滚动到元素位置
            elements[i].scrollIntoView({ behavior: 'auto', block: 'center' });  // 改为auto立即滚动
            
            // 第一张图多等待一些时间，确保页面完全稳定
            if (i === 0) {
                await sleep(800);
            } else {
                await sleep(400);
            }

            try {
                let canvas;
                
                // file://协议下使用Chrome API截图（避免跨域限制）
                if (window.location.protocol === 'file:') {
                    console.log(`file://协议，使用Chrome API截图元素 ${i+1}/${elements.length}`);
                    canvas = await captureElementWithChromeAPI(elements[i]);
                } else {
                    // 在线网页使用html2canvas
                    const scale = options.highQuality ? (options.quality || 2) : 1;
                    const bgColor = options.transparentBg ? null : '#ffffff';
                    
                    console.log(`自动识别截图 ${i+1}/${elements.length}:`, {
                        scale,
                        bgColor,
                        element: elements[i],
                        size: {
                            width: elements[i].offsetWidth,
                            height: elements[i].offsetHeight
                        }
                    });
                    
                    canvas = await html2canvas(elements[i], {
                        backgroundColor: bgColor,
                        scale: scale,
                        logging: false,
                        useCORS: false,
                        allowTaint: false,
                        removeContainer: true,
                        imageTimeout: 15000,
                        onclone: (clonedDoc) => {
                            const clonedElement = clonedDoc.querySelector(`[class="${elements[i].className}"]`);
                            if (clonedElement) {
                                clonedElement.style.opacity = '1';
                                clonedElement.style.visibility = 'visible';
                            }
                        }
                    });
                }
                
                console.log(`截图完成，canvas大小: ${canvas.width} x ${canvas.height}`);
                console.log('自动下载设置:', options.autoDownload);

                // 下载（始终自动下载）
                try {
                    const filename = await generateSmartFilename('元素', currentImageIndex++);
                    await downloadCanvas(canvas, filename);
                    console.log('已下载:', filename);
                    successCount++;
                } catch (downloadError) {
                    // file://协议跨域错误很常见，不显示详细错误
                    if (window.location.protocol === 'file:') {
                        // 静默跳过，最后统一提示
                    } else {
                        console.warn(`下载第${i+1}个元素失败:`, downloadError.message);
                    }
                }
                
                await sleep(300);
            } catch (error) {
                console.warn(`截图第${i+1}/${elements.length}个元素失败:`, error.message);
                console.warn('失败元素信息:', {
                    class: elements[i].className,
                    width: elements[i].offsetWidth,
                    height: elements[i].offsetHeight
                });
                // 继续处理下一个元素，不中断整个流程
            }
        }

        // 完成后显示结果
        if (successCount === 0 && window.location.protocol === 'file:') {
            // file://协议限制，更新面板显示提示
            updateFloatingControlProgress('file://页面受跨域限制，推荐使用"自由截图"(Ctrl+Shift+S)');
            setTimeout(() => hideFloatingControlPanel(), 5000);
        } else {
            // 正常完成
            hideFloatingControlPanel();
        }
        
        callback({ success: true, count: successCount });
    } catch (error) {
        console.error('批量截图失败:', error);
        hideFloatingControlPanel();
        callback({ success: false, error: error.message });
    }
}

// 截取可见区域（使用Chrome API）
async function captureVisibleArea(options, callback) {
    try {
        console.log('开始截取可见区域（使用Chrome API），options:', options);
        
        // 发送消息给background.js，请求使用Chrome API截图
        chrome.runtime.sendMessage({
            action: 'captureVisibleTab',
            options: { ...options, downloadNow: true }  // 标记直接下载
        }, (response) => {
            console.log('收到截图响应:', response);
            if (response && response.success) {
                callback({ success: true });
            } else {
                callback({ success: false, error: response?.error || '截图失败' });
            }
        });
        
    } catch (error) {
        console.error('截取可见区域失败:', error);
        callback({ success: false, error: error.message });
    }
}

// 启用手动选择模式
function enableManualSelect(options) {
    isManualSelectMode = true;
    window._screenshotOptions = options || {};
    selectedElements = [];  // 重置选中元素列表
    isCtrlPressed = false;  // 重置Ctrl状态
    
    // 创建遮罩层
    createOverlay();

    // 监听鼠标移动
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('click', handleClick);
}

// 禁用手动选择模式
function disableManualSelect() {
    isManualSelectMode = false;
    selectedElements = [];
    isCtrlPressed = false;
    
    // 移除遮罩层和提示
    if (overlayElement) {
        if (overlayElement._hintDiv) {
            overlayElement._hintDiv.remove();
        }
        if (overlayElement._keydownHandler) {
            document.removeEventListener('keydown', overlayElement._keydownHandler);
        }
        if (overlayElement._keyupHandler) {
            document.removeEventListener('keyup', overlayElement._keyupHandler);
        }
        overlayElement.remove();
        overlayElement = null;
    }

    // 移除所有高亮
    removeHighlight();
    removeAllSelectionHighlights();

    // 移除事件监听
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('click', handleClick);
}

// 创建遮罩层
function createOverlay() {
    overlayElement = document.createElement('div');
    overlayElement.id = 'screenshot-overlay';
    overlayElement.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.3);
        z-index: 999999;
        cursor: crosshair;
        pointer-events: none;
    `;
    
    // 创建提示文字容器
    const hintDiv = document.createElement('div');
    hintDiv.style.cssText = `
        position: fixed;
        top: 50px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(102, 126, 234, 0.95);
        color: white;
        padding: 15px 30px;
        border-radius: 10px;
        font-size: 18px;
        font-weight: bold;
        text-align: center;
        z-index: 1000000;
        pointer-events: none;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        font-family: 'Microsoft YaHei', sans-serif;
    `;
    hintDiv.innerHTML = '按住 Ctrl 键点击选择元素，松开 Ctrl 开始截图<br><small style="font-size: 14px; margin-top: 8px; display: block; opacity: 0.9;">按 ESC 取消</small>';
    
    document.body.appendChild(overlayElement);
    document.body.appendChild(hintDiv);
    
    // 保存提示div的引用，以便后续移除
    overlayElement._hintDiv = hintDiv;

    // 键盘事件监听
    const keydownHandler = (e) => {
        if (e.key === 'Escape') {
            // ESC取消
            console.log('ESC键按下，取消选择');
            disableManualSelect();
        } else if (e.key === 'Control' || e.ctrlKey) {
            // Ctrl按下
            if (!isCtrlPressed) {
                console.log('Ctrl键按下，进入多选模式');
                isCtrlPressed = true;
                updateHintText();
            }
        }
    };
    
    const keyupHandler = (e) => {
        if (e.key === 'Control') {
            console.log('Ctrl键松开，当前选中元素数量:', selectedElements.length);
            // Ctrl松开，开始批量截图
            isCtrlPressed = false;
            if (selectedElements.length > 0) {
                console.log('开始批量截图选中的元素');
                batchCaptureSelectedElements();
            } else {
                console.log('没有选中元素，更新提示');
                updateHintText();
            }
        }
    };
    
    document.addEventListener('keydown', keydownHandler);
    document.addEventListener('keyup', keyupHandler);
    
    // 保存事件处理器引用，以便后续移除
    overlayElement._keydownHandler = keydownHandler;
    overlayElement._keyupHandler = keyupHandler;
}

// 更新提示文字
function updateHintText() {
    if (!overlayElement || !overlayElement._hintDiv) return;
    
    if (isCtrlPressed) {
        overlayElement._hintDiv.innerHTML = `已选择 ${selectedElements.length} 个元素，继续点击或松开 Ctrl<br><small style="font-size: 14px; margin-top: 8px; display: block; opacity: 0.9;">按 ESC 取消</small>`;
    } else {
        overlayElement._hintDiv.innerHTML = '按住 Ctrl 键点击选择元素，松开 Ctrl 开始截图<br><small style="font-size: 14px; margin-top: 8px; display: block; opacity: 0.9;">按 ESC 取消</small>';
    }
}

// 移除所有选中高亮
function removeAllSelectionHighlights() {
    document.querySelectorAll('.screenshot-selection-highlight').forEach(el => el.remove());
}

// 批量截图选中的元素
async function batchCaptureSelectedElements() {
    console.log('batchCaptureSelectedElements 被调用');
    
    if (selectedElements.length === 0) {
        console.log('没有选中元素，返回');
        return;
    }
    
    console.log('开始批量截图，共', selectedElements.length, '个元素');
    
    // 复制元素列表（避免被清空）
    const elementsToCapture = [...selectedElements];
    
    // 禁用选择模式
    disableManualSelect();
    
    // 等待UI清理
    await sleep(300);
    
    // 使用captureElements的逻辑批量截图
    const options = window._screenshotOptions || {};
    
    // 调用批量截图逻辑
    console.log('调用 captureElementsList，元素数量:', elementsToCapture.length);
    captureElementsList(elementsToCapture, options);
}

// 批量截图元素列表
async function captureElementsList(elements, options) {
    console.log('captureElementsList 被调用，元素数量:', elements.length);
    
    let successCount = 0;
    
    // 创建浮动控制面板
    createFloatingControlPanel();
    updateFloatingControlProgress(`准备截图 ${elements.length} 个元素...`);
    
    isPaused = false;
    isStopped = false;
    
    for (let i = 0; i < elements.length; i++) {
        // 检查是否停止
        if (isStopped) break;
        
        // 检查是否暂停
        while (isPaused) {
            await sleep(100);
            if (isStopped) break;
        }
        
        if (isStopped) break;
        
        updateFloatingControlProgress(`正在截图 ${i + 1}/${elements.length}`);
        
        // 滚动到元素
        elements[i].scrollIntoView({ behavior: 'auto', block: 'center' });
        await sleep(i === 0 ? 800 : 400);
        
        try {
            let canvas;
            
            // file://协议使用Chrome API
            if (window.location.protocol === 'file:') {
                canvas = await captureElementWithChromeAPI(elements[i]);
            } else {
                // 在线网页使用html2canvas
                const scale = options.highQuality ? (options.quality || 2) : 1;
                const bgColor = options.transparentBg ? null : '#ffffff';
                
                canvas = await html2canvas(elements[i], {
                    backgroundColor: bgColor,
                    scale: scale,
                    logging: false,
                    useCORS: false,
                    allowTaint: false,
                    removeContainer: true,
                    imageTimeout: 15000
                });
            }
            
            // 下载
            const filename = await generateSmartFilename('手动选择', currentImageIndex++);
            await downloadCanvas(canvas, filename);
            console.log('已下载:', filename);
            successCount++;
            
        } catch (error) {
            console.warn(`截图第${i+1}个元素失败:`, error.message);
        }
        
        await sleep(300);
    }
    
    hideFloatingControlPanel();
    console.log(`批量截图完成，成功 ${successCount}/${elements.length}`);
}

// 处理鼠标移动
function handleMouseMove(e) {
    if (!isManualSelectMode) return;
    
    // 只在Ctrl按下时才高亮
    if (!isCtrlPressed) {
        removeHighlight();
        return;
    }

    // 排除高亮框
    if (e.target.classList && e.target.classList.contains('screenshot-highlight')) {
        return;
    }

    // 向上查找合适的卡片元素
    let targetElement = e.target;
    
    // 只对小元素（文字、图片等）向上查找
    const isSmallElement = targetElement.tagName === 'SPAN' || 
                           targetElement.tagName === 'P' || 
                           targetElement.tagName === 'A' ||
                           targetElement.tagName === 'IMG' ||
                           targetElement.tagName === 'H1' ||
                           targetElement.tagName === 'H2' ||
                           targetElement.tagName === 'H3' ||
                           targetElement.tagName === 'H4' ||
                           targetElement.tagName === 'H5' ||
                           targetElement.tagName === 'H6' ||
                           targetElement.tagName === 'STRONG' ||
                           targetElement.tagName === 'EM' ||
                           targetElement.tagName === 'B' ||
                           targetElement.tagName === 'I' ||
                           targetElement.tagName === 'LABEL' ||
                           targetElement.tagName === 'SMALL' ||
                           targetElement.tagName === 'TEXT' ||
                           targetElement.offsetWidth < 300 ||  // 宽度小于300px的元素
                           targetElement.offsetHeight < 150;   // 高度小于150px的元素
    
    if (isSmallElement && targetElement !== document.body) {
        // 向上查找，最多查找10层
        let parent = targetElement.parentElement;
        let depth = 0;
        
        while (parent && parent !== document.body && depth < 10) {
            const rect = parent.getBoundingClientRect();
            
            // 判断是否有card相关类名
            const hasCardClass = parent.className && 
                (parent.className.includes('card') || 
                 parent.className.includes('item') ||
                 parent.className.includes('box'));
            
            // 尺寸限制
            const sizeOK = rect.width >= 100 && 
                          rect.height >= 100 &&
                          rect.width <= window.innerWidth * 0.8 &&
                          rect.height <= window.innerHeight * 0.8;
            
            // 如果有card类名且尺寸合理，就是它了
            if (hasCardClass && sizeOK) {
                targetElement = parent;
                break;
            }
            
            parent = parent.parentElement;
            depth++;
        }
    }
    
    // 高亮找到的元素
    highlightElement(targetElement);
}

// 处理点击
async function handleClick(e) {
    if (!isManualSelectMode) return;

    e.preventDefault();
    e.stopPropagation();

    // 排除高亮框
    if (e.target.classList && e.target.classList.contains('screenshot-highlight')) {
        return;
    }

    // 向上查找真正的卡片元素（避免选中内部小元素）
    let targetElement = e.target;
    
    // 只对小元素（文字、图片等）向上查找，避免过度查找
    const isSmallElement = targetElement.tagName === 'SPAN' || 
                           targetElement.tagName === 'P' || 
                           targetElement.tagName === 'A' ||
                           targetElement.tagName === 'IMG' ||
                           targetElement.tagName === 'H1' ||
                           targetElement.tagName === 'H2' ||
                           targetElement.tagName === 'H3' ||
                           targetElement.tagName === 'H4' ||
                           targetElement.tagName === 'H5' ||
                           targetElement.tagName === 'H6' ||
                           targetElement.tagName === 'STRONG' ||
                           targetElement.tagName === 'EM' ||
                           targetElement.tagName === 'B' ||
                           targetElement.tagName === 'I' ||
                           targetElement.tagName === 'LABEL' ||
                           targetElement.tagName === 'SMALL' ||
                           targetElement.tagName === 'TEXT' ||
                           targetElement.offsetWidth < 300 ||  // 宽度小于300px的元素
                           targetElement.offsetHeight < 150;   // 高度小于150px的元素
    
    if (isSmallElement && targetElement !== document.body) {
        console.log('检测到小元素:', targetElement.tagName, '开始向上查找卡片容器');
        
        // 向上查找，最多查找10层
        let parent = targetElement.parentElement;
        let depth = 0;
        let found = false;
        
        while (parent && parent !== document.body && depth < 10) {
            const rect = parent.getBoundingClientRect();
            
            // 判断是否有card相关类名
            const hasCardClass = parent.className && 
                (parent.className.includes('card') || 
                 parent.className.includes('item') ||
                 parent.className.includes('box'));
            
            // 尺寸限制：不能太小，也不能太大
            const sizeOK = rect.width >= 100 && 
                          rect.height >= 100 &&
                          rect.width <= window.innerWidth * 0.8 &&  // 最大80%宽度
                          rect.height <= window.innerHeight * 0.8;  // 最大80%高度
            
            // 如果有card类名且尺寸合理，就是它了
            if (hasCardClass && sizeOK) {
                targetElement = parent;
                found = true;
                console.log('找到卡片容器（有card类名）:', parent.className, rect);
                break;
            }
            
            parent = parent.parentElement;
            depth++;
        }
        
        if (!found) {
            console.log('未找到合适容器，使用点击的元素');
        }
    }

    // 如果按住Ctrl，添加到多选列表
    if (isCtrlPressed || e.ctrlKey) {
        console.log('检测到Ctrl按下，当前已选中:', selectedElements.length);
        
        // 检查是否已选中
        if (selectedElements.includes(targetElement)) {
            console.log('元素已选中，跳过');
            return;
        }
        
        // 添加到选中列表（在调用addSelectionHighlight之前）
        selectedElements.push(targetElement);
        console.log('添加元素到选中列表，当前总数:', selectedElements.length);
        
        // 添加持久高亮
        addSelectionHighlight(targetElement);
        
        // 更新提示
        updateHintText();
        
        return;  // 不立即截图，等待Ctrl松开
    }

    // 没按Ctrl，单选模式，立即截图
    // 先禁用选择模式（移除遮罩层、提示和高亮）
    disableManualSelect();
    
    // 等待遮罩层移除和页面恢复正常（重要！）
    await sleep(300);

    // 截图（不显示任何提示）
    try {
        
        // 如果勾选高清模式，使用设置的质量；否则使用标准质量（1倍）
        const scale = (window._screenshotOptions && window._screenshotOptions.highQuality) 
            ? (window._screenshotOptions.quality || 2) 
            : 1;
        
        // 根据用户设置决定背景颜色
        const bgColor = (window._screenshotOptions && window._screenshotOptions.transparentBg) 
            ? null 
            : '#ffffff';
        
        console.log('手动选择截图配置:', {scale, bgColor, element: targetElement});
        
        let canvas;
        
        // file://协议下使用Chrome API截图（避免跨域限制）
        if (window.location.protocol === 'file:') {
            console.log('file://协议，使用Chrome API截图元素');
            canvas = await captureElementWithChromeAPI(targetElement);
        } else {
            // 在线网页使用html2canvas
            canvas = await html2canvas(targetElement, {
                backgroundColor: bgColor,
                scale: scale,
                logging: false,
                useCORS: false,  // 不尝试跨域加载图片
                allowTaint: false,  // 不允许污染canvas
                removeContainer: true,
                imageTimeout: 15000,
                onclone: (clonedDoc) => {
                    // 确保克隆的元素可见
                    const clonedElement = clonedDoc.querySelector(`[class="${targetElement.className}"]`);
                    if (clonedElement) {
                        clonedElement.style.opacity = '1';
                        clonedElement.style.visibility = 'visible';
                    }
                }
            });
        }
        
        console.log('手动选择截图完成，canvas大小:', canvas.width, 'x', canvas.height);
        
        // 检查canvas是否有效
        if (!canvas || canvas.width === 0 || canvas.height === 0) {
            throw new Error('截图失败：Canvas大小为0');
        }

        // 检查是否自动下载
        const shouldAutoDownload = window._screenshotOptions ? window._screenshotOptions.autoDownload : true;
        if (shouldAutoDownload) {
            const filename = await generateSmartFilename('手动选择', currentImageIndex++);
            await downloadCanvas(canvas, filename);
            console.log('手动选择下载成功:', filename);
        } else {
            // 不自动下载，显示预览和手动下载按钮
            showPreview(canvas, '手动选择');
            return;
        }
        
    } catch (error) {
        console.error('手动选择截图失败:', error);
    }
}

// 添加选中高亮（多选时的持久高亮）
function addSelectionHighlight(element) {
    const rect = element.getBoundingClientRect();
    const highlight = document.createElement('div');
    highlight.className = 'screenshot-selection-highlight';
    highlight.style.cssText = `
        position: fixed;
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        border: 4px solid #4CAF50;
        background: rgba(76, 175, 80, 0.2);
        z-index: 1000001;
        pointer-events: none;
        box-sizing: border-box;
    `;
    
    // 添加序号标签
    const label = document.createElement('div');
    label.style.cssText = `
        position: absolute;
        top: -15px;
        left: -15px;
        background: #4CAF50;
        color: white;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-size: 14px;
    `;
    label.textContent = selectedElements.length;
    highlight.appendChild(label);
    
    document.body.appendChild(highlight);
}

// 高亮元素（鼠标悬停时的临时高亮）
function highlightElement(element) {
    // 移除之前的临时高亮
    removeHighlight();

    // 创建临时高亮框
    const rect = element.getBoundingClientRect();
    highlightedElement = document.createElement('div');
    highlightedElement.className = 'screenshot-highlight';
    highlightedElement.style.cssText = `
        position: fixed;
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        border: 3px solid #667eea;
        background: rgba(102, 126, 234, 0.1);
        z-index: 1000000;
        pointer-events: none;
        box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.3);
    `;
    document.body.appendChild(highlightedElement);
}

// 移除高亮
function removeHighlight() {
    if (highlightedElement) {
        highlightedElement.remove();
        highlightedElement = null;
    }
}

// 自动裁剪canvas的透明边缘
function trimCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    
    let top = canvas.height;
    let bottom = 0;
    let left = canvas.width;
    let right = 0;
    
    // 扫描所有像素，找到非透明像素的边界
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            const index = (y * canvas.width + x) * 4;
            const alpha = pixels[index + 3];
            
            // 如果像素不透明（或接近不透明）
            if (alpha > 10) {
                if (y < top) top = y;
                if (y > bottom) bottom = y;
                if (x < left) left = x;
                if (x > right) right = x;
            }
        }
    }
    
    // 如果全透明，返回原canvas
    if (top > bottom || left > right) {
        return canvas;
    }
    
    // 创建裁剪后的canvas
    const trimmedWidth = right - left + 1;
    const trimmedHeight = bottom - top + 1;
    
    const trimmedCanvas = document.createElement('canvas');
    trimmedCanvas.width = trimmedWidth;
    trimmedCanvas.height = trimmedHeight;
    const trimmedCtx = trimmedCanvas.getContext('2d');
    
    // 复制裁剪区域
    trimmedCtx.drawImage(canvas, left, top, trimmedWidth, trimmedHeight, 0, 0, trimmedWidth, trimmedHeight);
    
    console.log(`裁剪透明边缘: ${canvas.width}x${canvas.height} → ${trimmedWidth}x${trimmedHeight}`);
    
    return trimmedCanvas;
}

// 下载Canvas
async function downloadCanvas(canvas, filename) {
    console.log('downloadCanvas 被调用，文件名:', filename);
    console.log('Canvas尺寸:', canvas.width, 'x', canvas.height);
    console.log('当前协议:', window.location.protocol);
    
    // 根据文件扩展名决定格式
    const format = filename.toLowerCase().endsWith('.jpg') || filename.toLowerCase().endsWith('.jpeg') 
        ? 'image/jpeg' 
        : 'image/png';
    
    // 使用 Blob 方式下载（避免 data URL 过长问题）
    return new Promise((resolve, reject) => {
        try {
            canvas.toBlob(async (blob) => {
                if (!blob) {
                    const errorMsg = 'Canvas无法导出（可能是file://协议限制）';
                    console.error('❌', errorMsg);
                    reject(new Error(errorMsg));
                    return;
                }
                
                console.log('✅ Blob生成成功，大小:', (blob.size / 1024).toFixed(2), 'KB');
                
                try {
                    // 使用 Blob URL 下载（解决 data URL 过长问题）
                    const blobUrl = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.download = filename;
                    link.href = blobUrl;
                    link.style.display = 'none';
                    document.body.appendChild(link);
                    link.click();
                    
                    // 延迟释放 URL
                    setTimeout(() => {
                        link.remove();
                        URL.revokeObjectURL(blobUrl);
                        console.log('✅ 下载成功:', filename);
                        resolve();
                    }, 200);
                    
                } catch (error) {
                    console.error('❌ 下载失败:', error);
                    reject(error);
                }
            }, format, format === 'image/jpeg' ? 0.95 : undefined);
        } catch (error) {
            console.error('❌ toBlob调用失败:', error);
            reject(error);
        }
    });
}

// 智能生成文件名（支持自定义模板）
async function generateSmartFilename(prefix, index) {
    try {
        // 从storage读取设置
        const settings = await chrome.storage.sync.get({
            fileNameTemplate: '截图_{n}',
            startNumber: 1,
            numberPadding: 0,
            imageFormat: 'png'
        });
        
        // 计算当前序号
        const currentNumber = settings.startNumber + index;
        
        // 补零
        const paddedNumber = settings.numberPadding > 0 
            ? String(currentNumber).padStart(settings.numberPadding, '0')
            : String(currentNumber);
        
        // 替换模板中的变量
        let filename = settings.fileNameTemplate;
        
        // 替换 {n} 为序号
        filename = filename.replace(/\{n\}/g, paddedNumber);
        
        // 替换 {date} 为日期
        const now = new Date();
        const dateStr = now.getFullYear() + 
                       String(now.getMonth() + 1).padStart(2, '0') + 
                       String(now.getDate()).padStart(2, '0');
        filename = filename.replace(/\{date\}/g, dateStr);
        
        // 替换 {time} 为时间
        const timeStr = String(now.getHours()).padStart(2, '0') + 
                       String(now.getMinutes()).padStart(2, '0') + 
                       String(now.getSeconds()).padStart(2, '0');
        filename = filename.replace(/\{time\}/g, timeStr);
        
        // 添加文件扩展名
        return filename + '.' + settings.imageFormat;
    } catch (error) {
        console.warn('读取文件名设置失败，使用默认命名:', error);
        // 如果读取设置失败，使用默认命名
        return `${prefix}_${index + 1}.png`;
    }
}

// 显示简单预览（用于可见区域和完整页面）
function showPreview(canvas, title) {
    const previewDiv = document.createElement('div');
    previewDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 20px;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        z-index: 999999;
        max-width: 600px;
        max-height: 80vh;
        overflow: auto;
    `;
    
    // 标题
    const titleDiv = document.createElement('div');
    titleDiv.textContent = title;
    titleDiv.style.cssText = `
        font-size: 18px;
        font-weight: bold;
        color: #333;
        margin-bottom: 15px;
        text-align: center;
        font-family: 'Microsoft YaHei', sans-serif;
    `;
    previewDiv.appendChild(titleDiv);
    
    // 预览图（处理canvas污染问题）
    try {
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.style.cssText = `
            max-width: 100%;
            height: auto;
            border-radius: 8px;
            border: 1px solid #e0e0e0;
        `;
        previewDiv.appendChild(img);
    } catch (error) {
        // canvas被污染，无法显示预览
        console.error('无法生成预览图:', error);
        const errorMsg = document.createElement('div');
        errorMsg.innerHTML = `
            <div style="padding: 30px; text-align: center; color: #666;">
                <div style="font-size: 48px; margin-bottom: 20px;">📷</div>
                <div style="font-size: 16px; margin-bottom: 10px;">截图已完成，但无法显示预览</div>
                <div style="font-size: 14px; color: #999; line-height: 1.6;">
                    文件协议（file://）限制导致无法导出图片<br>
                    <br>
                    <strong>建议使用 HTTP 服务器：</strong><br>
                    1. 在文件夹打开命令行<br>
                    2. 运行：<code style="background: #f5f5f5; padding: 2px 8px; border-radius: 4px;">python -m http.server 8000</code><br>
                    3. 访问：<code style="background: #f5f5f5; padding: 2px 8px; border-radius: 4px;">http://localhost:8000</code>
                </div>
            </div>
        `;
        previewDiv.appendChild(errorMsg);
    }
    
    // 按钮容器
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = `
        margin-top: 15px;
        display: flex;
        gap: 10px;
    `;
    
    // 下载按钮
    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = '下载';
    downloadBtn.style.cssText = `
        flex: 1;
        padding: 12px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        font-family: 'Microsoft YaHei', sans-serif;
    `;
    downloadBtn.addEventListener('click', async () => {
        const filename = await generateSmartFilename(title.replace('截图', ''), 0);
        downloadCanvas(canvas, filename);
        previewDiv.remove();
    });
    
    // 关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = `
        flex: 1;
        padding: 12px;
        background: #f0f0f0;
        color: #333;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        font-family: 'Microsoft YaHei', sans-serif;
    `;
    closeBtn.addEventListener('click', () => {
        previewDiv.remove();
    });
    
    btnContainer.appendChild(downloadBtn);
    btnContainer.appendChild(closeBtn);
    previewDiv.appendChild(btnContainer);
    
    document.body.appendChild(previewDiv);
}

// AI识别并截图
async function aiDetectAndCapture(options, callback) {
    try {
        // 检查AI检测器是否可用
        if (typeof window.aiCardDetector === 'undefined') {
            callback({ 
                success: false, 
                error: 'AI检测器未加载，请刷新页面重试',
                count: 0 
            });
            return;
        }

        const detector = window.aiCardDetector;

        // 加载AI模型（带进度回调）
        let loadingHint = null;
        try {
            loadingHint = showLoadingHint('正在加载AI模型...');
            
            await detector.loadModel((progress) => {
                const stage = progress.stage;
                const percent = progress.progress;
                
                let text = '';
                if (stage === 'algorithm') {
                    text = `初始化智能识别引擎... ${percent}%`;
                }
                
                updateLoadingHint(loadingHint, text);
            });

            updateLoadingHint(loadingHint, '模型加载完成，开始识别...');
        } catch (error) {
            if (loadingHint) loadingHint.remove();
            callback({ 
                success: false, 
                error: '模型加载失败: ' + error.message,
                count: 0 
            });
            return;
        }

        // 从设置中读取AI参数
        const aiSettings = await chrome.storage.sync.get({
            aiMinScore: 0.3,
            aiMinSize: 100
        });

        // 使用AI识别卡片
        updateLoadingHint(loadingHint, 'AI正在分析页面...');
        
        const detectResult = await detector.detectCards({
            scale: 0.5,  // 降低分辨率提高速度
            minScore: aiSettings.aiMinScore,
            minWidth: aiSettings.aiMinSize,
            minHeight: aiSettings.aiMinSize
        });

        if (!detectResult.success || detectResult.elements.length === 0) {
            if (loadingHint) loadingHint.remove();
            callback({ 
                success: false, 
                error: '未识别到卡片元素',
                count: 0 
            });
            return;
        }

        updateLoadingHint(loadingHint, `识别到 ${detectResult.count} 个元素，开始截图...`);

        // 截图识别到的元素
        let successCount = 0;
        const elements = detectResult.elements;

        // 重置控制标志
        isPaused = false;
        isStopped = false;
        
        // 创建浮动控制面板
        createFloatingControlPanel();
        updateFloatingControlProgress(`AI识别到 ${elements.length} 个元素，开始截图...`);
        
        // 发送总数到popup
        chrome.runtime.sendMessage({ 
            action: 'updateProgress', 
            current: 0, 
            total: elements.length,
            status: 'AI识别完成，开始截图...'
        });

        for (let i = 0; i < elements.length; i++) {
            // 检查是否停止
            if (isStopped) {
                if (loadingHint) loadingHint.remove();
                hideFloatingControlPanel();
                chrome.runtime.sendMessage({ 
                    action: 'captureStopped', 
                    count: successCount 
                });
                callback({ success: true, count: successCount, stopped: true });
                return;
            }
            
            // 检查是否暂停
            while (isPaused) {
                // loadingHint已被移除，不再更新
                await sleep(100);
                if (isStopped) break;
            }
            
            if (isStopped) {
                // loadingHint在第一次截图时就已移除
                hideFloatingControlPanel();
                chrome.runtime.sendMessage({ 
                    action: 'captureStopped', 
                    count: successCount 
                });
                callback({ success: true, count: successCount, stopped: true });
                return;
            }
            
            try {
                // 第一次循环时移除加载提示（避免被截入）
                if (i === 0 && loadingHint) {
                    loadingHint.remove();
                    loadingHint = null;
                }
                
                // 滚动到元素位置
                elements[i].scrollIntoView({ behavior: 'auto', block: 'center' });  // 改为auto立即滚动
                
                // 第一张图多等待一些时间，确保页面完全稳定
                if (i === 0) {
                    await sleep(800);
                } else {
                    await sleep(400);
                }

                updateFloatingControlProgress(`AI截图中 ${i + 1}/${elements.length} (已完成 ${successCount})`);
                
                // 发送进度更新
                chrome.runtime.sendMessage({ 
                    action: 'updateProgress', 
                    current: i + 1, 
                    total: elements.length,
                    status: `AI截图中 ${i + 1}/${elements.length}`
                });

                // 截图
                let canvas;
                
                // file://协议下使用Chrome API截图（避免跨域限制）
                if (window.location.protocol === 'file:') {
                    console.log(`file://协议，使用Chrome API截图元素 ${i+1}/${elements.length}`);
                    canvas = await captureElementWithChromeAPI(elements[i]);
                    
                    // Chrome API的canvas不会跨域，可以安全裁剪透明边缘
                    try {
                        canvas = trimCanvas(canvas);
                        console.log('AI识别：已裁剪透明边缘');
                    } catch (trimError) {
                        console.warn('裁剪失败，使用原canvas:', trimError.message);
                    }
                } else {
                    // 在线网页使用html2canvas（增强兼容性）
                    const scale = options.highQuality ? (options.quality || 2) : 1;
                    canvas = await html2canvas(elements[i], {
                        backgroundColor: options.transparentBg ? null : '#ffffff',
                        scale: scale,
                        logging: false,
                        useCORS: false,
                        allowTaint: false,
                        removeContainer: true,
                        imageTimeout: 15000,
                        onclone: (clonedDoc) => {
                            const clonedElement = clonedDoc.querySelector(`[class="${elements[i].className}"]`);
                            if (clonedElement) {
                                clonedElement.style.opacity = '1';
                                clonedElement.style.visibility = 'visible';
                            }
                        }
                    });
                    
                    // 在线网页也裁剪透明边缘
                    try {
                        canvas = trimCanvas(canvas);
                        console.log('AI识别：已裁剪透明边缘');
                    } catch (trimError) {
                        console.warn('裁剪失败（可能跨域），使用原canvas');
                    }
                }
                
                // 下载（AI识别模式始终自动下载）
                try {
                    const filename = await generateSmartFilename('AI识别', currentImageIndex++);
                    await downloadCanvas(canvas, filename);
                    console.log('已下载:', filename);
                    successCount++;
                } catch (downloadError) {
                    // file://协议跨域错误很常见，不显示详细错误
                    if (window.location.protocol === 'file:') {
                        // 静默跳过，最后统一提示
                    } else {
                        console.warn(`AI识别第${i+1}个元素下载失败:`, downloadError.message);
                    }
                }

                await sleep(200);
                } catch (error) {
                    console.warn('截图元素失败:', error);
                    console.warn('失败的元素:', elements[i]);
                    console.warn('元素详情:', {
                        class: elements[i].className,
                        id: elements[i].id,
                        size: elements[i].getBoundingClientRect(),
                        visible: elements[i].offsetWidth > 0 && elements[i].offsetHeight > 0
                    });
                }
        }

        // loadingHint 在第一次截图时就已经移除了，这里不需要再处理
        
        // 完成后隐藏浮动控制面板
        hideFloatingControlPanel();

        callback({ 
            success: true, 
            count: successCount 
        });

    } catch (error) {
        console.error('AI识别失败:', error);
        hideFloatingControlPanel();
        callback({ 
            success: false, 
            error: error.message,
            count: 0 
        });
    }
}

// 显示加载提示
function showLoadingHint(text) {
    const hint = document.createElement('div');
    hint.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(102, 126, 234, 0.95);
        color: white;
        padding: 20px 40px;
        border-radius: 12px;
        font-size: 16px;
        font-weight: bold;
        text-align: center;
        z-index: 999999;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        font-family: 'Microsoft YaHei', sans-serif;
        min-width: 300px;
    `;
    hint.innerHTML = `
        <div style="margin-bottom: 10px;">AI智能识别</div>
        <div id="loading-text">${text}</div>
        <div style="margin-top: 10px; font-size: 12px; opacity: 0.8;">正在分析页面结构...</div>
    `;
    document.body.appendChild(hint);
    return hint;
}

// 更新加载提示
function updateLoadingHint(hint, text) {
    if (hint) {
        const textEl = hint.querySelector('#loading-text');
        if (textEl) textEl.textContent = text;
    }
}

// 延迟函数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 创建浮动控制面板
function createFloatingControlPanel() {
    // 如果已存在，先移除
    if (floatingControlPanel) {
        floatingControlPanel.remove();
    }
    
    floatingControlPanel = document.createElement('div');
    floatingControlPanel.id = 'screenshot-control-panel';
    floatingControlPanel.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 25px 30px;
        border-radius: 16px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
        z-index: 2147483646;
        font-family: 'Microsoft YaHei', sans-serif;
        min-width: 360px;
    `;
    
    floatingControlPanel.innerHTML = `
        <div style="font-size: 20px; font-weight: bold; margin-bottom: 15px;">
            批量截图中...
        </div>
        <div id="control-progress" style="font-size: 17px; margin-bottom: 20px; opacity: 0.95; line-height: 1.5;">
            准备中...
        </div>
        <div style="display: flex; gap: 12px;">
            <button id="control-pause-btn" style="
                flex: 1;
                padding: 14px 18px;
                background: rgba(255, 255, 255, 0.25);
                color: white;
                border: 2px solid rgba(255, 255, 255, 0.4);
                border-radius: 8px;
                cursor: pointer;
                font-size: 16px;
                font-weight: 700;
                transition: all 0.3s;
                font-family: 'Microsoft YaHei', sans-serif;
            ">暂停</button>
            <button id="control-resume-btn" style="
                flex: 1;
                padding: 14px 18px;
                background: rgba(255, 255, 255, 0.25);
                color: white;
                border: 2px solid rgba(255, 255, 255, 0.4);
                border-radius: 8px;
                cursor: pointer;
                font-size: 16px;
                font-weight: 700;
                display: none;
                transition: all 0.3s;
                font-family: 'Microsoft YaHei', sans-serif;
            ">继续</button>
            <button id="control-stop-btn" style="
                flex: 1;
                padding: 14px 18px;
                background: rgba(255, 107, 107, 0.95);
                color: white;
                border: 2px solid rgba(255, 255, 255, 0.4);
                border-radius: 8px;
                cursor: pointer;
                font-size: 16px;
                font-weight: 700;
                transition: all 0.3s;
                font-family: 'Microsoft YaHei', sans-serif;
            ">停止</button>
        </div>
    `;
    
    document.body.appendChild(floatingControlPanel);
    
    // 绑定按钮事件
    const pauseBtn = floatingControlPanel.querySelector('#control-pause-btn');
    const resumeBtn = floatingControlPanel.querySelector('#control-resume-btn');
    const stopBtn = floatingControlPanel.querySelector('#control-stop-btn');
    
    pauseBtn.addEventListener('click', () => {
        isPaused = true;
        pauseBtn.style.display = 'none';
        resumeBtn.style.display = 'block';
        updateFloatingControlProgress('已暂停');
    });
    
    resumeBtn.addEventListener('click', () => {
        isPaused = false;
        resumeBtn.style.display = 'none';
        pauseBtn.style.display = 'block';
        updateFloatingControlProgress('继续截图中...');
    });
    
    stopBtn.addEventListener('click', () => {
        isStopped = true;
        isPaused = false;
        hideFloatingControlPanel();
    });
    
    // 添加鼠标悬停效果
    [pauseBtn, resumeBtn, stopBtn].forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'rgba(255, 255, 255, 0.3)';
            btn.style.transform = 'translateY(-2px)';
        });
        btn.addEventListener('mouseleave', () => {
            if (btn.id === 'control-stop-btn') {
                btn.style.background = 'rgba(255, 107, 107, 0.9)';
            } else {
                btn.style.background = 'rgba(255, 255, 255, 0.2)';
            }
            btn.style.transform = 'translateY(0)';
        });
    });
    
    console.log('✅ 浮动控制面板已创建');
}

// 更新浮动控制面板进度
function updateFloatingControlProgress(text) {
    if (floatingControlPanel) {
        const progressEl = floatingControlPanel.querySelector('#control-progress');
        if (progressEl) {
            progressEl.textContent = text;
        }
    }
}

// 隐藏浮动控制面板
function hideFloatingControlPanel() {
    if (floatingControlPanel) {
        floatingControlPanel.style.opacity = '0';
        floatingControlPanel.style.transform = 'translateX(20px)';
        floatingControlPanel.style.transition = 'all 0.3s';
        setTimeout(() => {
            if (floatingControlPanel) {
                floatingControlPanel.remove();
                floatingControlPanel = null;
            }
        }, 300);
    }
}

// ========== 自由框选截图功能 ==========

// 启用自由框选模式（使用Chrome原生API，类似QQ截图）
async function enableFreeSelection(options) {
    console.log('🎯 启用自由截图模式（QQ截图风格），options:', options);
    isFreeSelectionMode = true;
    window._screenshotOptions = options;
    
    try {
        console.log('📤 发送 requestScreenshot 消息到 background.js');
        
        // 直接发送消息，不显示提示（避免被截入画面）
        chrome.runtime.sendMessage({
            action: 'requestScreenshot',
            options: options
        }, (response) => {
            console.log('📩 收到 background.js 响应:', response);
        });
        
        console.log('✅ requestScreenshot 消息已发送');
        
        // 设置超时保护（5秒后如果还没有创建覆盖层，显示错误）
        setTimeout(() => {
            if (!overlayElement && isFreeSelectionMode) {
                console.error('⏱️ 截图超时：5秒内未收到响应');
                
                // 显示错误提示
                const errorDiv = document.createElement('div');
                errorDiv.style.cssText = `
                    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                    background: rgba(255, 107, 107, 0.95); color: white; padding: 20px 40px;
                    border-radius: 10px; font-size: 16px; z-index: 2147483645;
                    font-family: 'Microsoft YaHei', sans-serif;
                `;
                errorDiv.textContent = '❌ 截图超时，请刷新页面后重试';
                document.body.appendChild(errorDiv);
                setTimeout(() => errorDiv.remove(), 3000);
                
    isFreeSelectionMode = false;
            }
        }, 5000);
        
    } catch (error) {
        console.error('❌ 启用自由截图失败:', error);
        
        // 显示错误提示
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: rgba(255, 107, 107, 0.95); color: white; padding: 20px 40px;
            border-radius: 10px; font-size: 16px; z-index: 2147483645;
            font-family: 'Microsoft YaHei', sans-serif;
        `;
        errorDiv.textContent = '❌ 启动失败: ' + error.message;
        document.body.appendChild(errorDiv);
        setTimeout(() => errorDiv.remove(), 3000);
    }
}

// 创建截图覆盖层（QQ截图风格）
function createScreenshotOverlay(screenshotDataUrl, options) {
    console.log('🎨 创建QQ风格截图覆盖层...');
    
    // 创建全屏覆盖层显示截图
    overlayElement = document.createElement('div');
    overlayElement.id = 'screenshot-overlay';
    overlayElement.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background-color: #000;
        background-image: url(${screenshotDataUrl});
        background-size: 100% 100%;
        background-position: 0 0;
        background-repeat: no-repeat;
        z-index: 2147483647;
        cursor: crosshair;
    `;
    
    // 添加半透明遮罩
    const mask = document.createElement('div');
    mask.id = 'screenshot-mask';
    mask.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.3);
        pointer-events: none;
        z-index: 1;
    `;
    overlayElement.appendChild(mask);
    
    // 添加提示
    const hintDiv = document.createElement('div');
    hintDiv.style.cssText = `
        position: absolute;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(102, 126, 234, 0.95);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: bold;
        font-family: 'Microsoft YaHei', sans-serif;
        pointer-events: none;
        z-index: 10;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    `;
    hintDiv.innerHTML = '拖拽鼠标框选截图区域 | 按 ESC 取消';
    overlayElement.appendChild(hintDiv);
    
    // 保存数据
    overlayElement._hintDiv = hintDiv;
    overlayElement._mask = mask;
    overlayElement._screenshotDataUrl = screenshotDataUrl;
    overlayElement._options = options;
    
    document.body.appendChild(overlayElement);
    console.log('✅ 覆盖层已添加到页面');
    
    // 绑定事件
    overlayElement.addEventListener('mousedown', handleScreenshotSelectionStart);
    document.addEventListener('mousemove', handleScreenshotSelectionMove);
    document.addEventListener('mouseup', handleScreenshotSelectionEnd);
    
    // ESC取消
    const escHandler = function(e) {
        if (e.key === 'Escape') {
            disableScreenshotSelection();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
    overlayElement._escHandler = escHandler;
}

// 禁用截图选择模式
function disableScreenshotSelection() {
    isFreeSelectionMode = false;
    if (overlayElement) {
        overlayElement.remove();
        overlayElement = null;
    }
    if (selectionBox) {
        selectionBox.remove();
        selectionBox = null;
    }
    document.removeEventListener('mousemove', handleScreenshotSelectionMove);
    document.removeEventListener('mouseup', handleScreenshotSelectionEnd);
}

// 旧的禁用方法（保留兼容）
function disableFreeSelection() {
    disableScreenshotSelection();
}

// 鼠标按下（在截图上）
function handleScreenshotSelectionStart(e) {
    if (!isFreeSelectionMode) return;
    e.preventDefault();
    e.stopPropagation();
    
    startX = e.clientX;
    startY = e.clientY;
    
    console.log('🖱️ 开始框选，起点:', startX, startY);
    
    // 隐藏遮罩（选择框会自带遮罩效果）
    if (overlayElement._mask) {
        overlayElement._mask.style.display = 'none';
    }
    
    // 创建选择框
    selectionBox = document.createElement('div');
    selectionBox.style.cssText = `
        position: fixed;
        border: 3px solid #00f7ff;
        background: rgba(0, 247, 255, 0.15);
        box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(255, 255, 255, 0.8);
        z-index: 2147483647;
        pointer-events: none;
    `;
    selectionBox.style.left = startX + 'px';
    selectionBox.style.top = startY + 'px';
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    document.body.appendChild(selectionBox);
    
    console.log('✅ 选择框已创建');
}

// 鼠标移动（在截图上）
function handleScreenshotSelectionMove(e) {
    if (!isFreeSelectionMode || !selectionBox) return;
    const currentX = e.clientX;
    const currentY = e.clientY;
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const left = Math.min(currentX, startX);
    const top = Math.min(currentY, startY);
    
    selectionBox.style.left = left + 'px';
    selectionBox.style.top = top + 'px';
    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';
}

// 鼠标松开（在截图上）
async function handleScreenshotSelectionEnd(e) {
    if (!isFreeSelectionMode || !selectionBox) return;
    
    const rect = selectionBox.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) {
        console.log('⚠️ 选区太小，取消');
        disableScreenshotSelection();
        return;
    }
    
    console.log('✂️ 选区确定:', {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
    });
    
    // 获取截图dataUrl
    const screenshotDataUrl = overlayElement._screenshotDataUrl;
    const options = overlayElement._options || window._screenshotOptions || {};
    
    // 关闭覆盖层
    disableScreenshotSelection();
    
    // 显示处理提示
    const processingDiv = document.createElement('div');
    processingDiv.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: rgba(102, 126, 234, 0.95); color: white; padding: 20px 40px;
        border-radius: 10px; font-size: 16px; z-index: 2147483647;
        font-family: 'Microsoft YaHei', sans-serif;
    `;
    processingDiv.textContent = '正在处理截图...';
    document.body.appendChild(processingDiv);
    
    try {
        console.log('📸 加载截图数据...');
        
        // 加载截图到Image对象
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = () => {
                console.log('✅ 截图加载成功，尺寸:', img.width, 'x', img.height);
                resolve();
            };
            img.onerror = () => {
                console.error('❌ 截图加载失败');
                reject(new Error('截图加载失败'));
            };
            img.src = screenshotDataUrl;
        });
        
        console.log('🔪 开始裁剪...');
        
        // 计算缩放比例（截图分辨率 vs 屏幕分辨率）
        const scaleX = img.width / window.innerWidth;
        const scaleY = img.height / window.innerHeight;
        
        console.log('📐 缩放比例:', {scaleX, scaleY});
        
        // 限制选择区域在页面范围内
        const clampedRect = {
            left: Math.max(0, rect.left),
            top: Math.max(0, rect.top),
            width: rect.width,
            height: rect.height
        };
        
        // 如果超出右边或底部，调整宽高
        if (clampedRect.left + clampedRect.width > window.innerWidth) {
            clampedRect.width = window.innerWidth - clampedRect.left;
        }
        if (clampedRect.top + clampedRect.height > window.innerHeight) {
            clampedRect.height = window.innerHeight - clampedRect.top;
        }
        
        console.log('限制后的选择区域:', clampedRect);
        
        // 创建canvas进行裁剪
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(clampedRect.width * scaleX);
        canvas.height = Math.round(clampedRect.height * scaleY);
        const ctx = canvas.getContext('2d');
        
        // 填充白色背景（避免透明区域）
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 从截图中裁剪出选择区域
        ctx.drawImage(img,
            Math.round(clampedRect.left * scaleX),   // 源图x位置
            Math.round(clampedRect.top * scaleY),    // 源图y位置
            Math.round(clampedRect.width * scaleX),  // 源图宽度
            Math.round(clampedRect.height * scaleY), // 源图高度
            0, 0,                                     // 目标x,y
            canvas.width,                             // 目标宽度
            canvas.height                             // 目标高度
        );
        
        console.log('裁剪完成，canvas大小:', canvas.width, 'x', canvas.height);
        
        // 下载
            const filename = await generateSmartFilename('自由截图', currentImageIndex++);
        downloadCanvas(canvas, filename);
        
            processingDiv.textContent = '截图成功！';
            setTimeout(() => processingDiv.remove(), 1500);
        
    } catch (error) {
        console.error('截图处理失败:', error);
        processingDiv.textContent = '截图失败: ' + error.message;
        processingDiv.style.backgroundColor = '#ff6b6b';
        setTimeout(() => processingDiv.remove(), 2000);
    }
}
