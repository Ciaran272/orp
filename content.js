// 智能卡片截图助手 - 内容脚本

let isManualSelectMode = false;
let isFreeSelectionMode = false;
let highlightedElement = null;
let overlayElement = null;
let selectionBox = null;
let startX = 0, startY = 0;
let currentImageIndex = 0;

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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

    if (request.action === 'captureFullPage') {
        captureFullPageContent(request.options, sendResponse);
        return true;
    }

    if (request.action === 'enableManualSelect') {
        enableManualSelect(request.options);
        sendResponse({ success: true });
        return true;
    }

    if (request.action === 'enableFreeSelection') {
        enableFreeSelection(request.options);
        sendResponse({ success: true });
        return true;
    }
});

// 检测元素
function detectElements(selector, callback) {
    try {
        const elements = document.querySelectorAll(selector);
        callback({ count: elements.length });
    } catch (error) {
        callback({ count: 0, error: error.message });
    }
}

// 截取多个元素
async function captureElements(options, callback) {
    try {
        const elements = document.querySelectorAll(options.selector);
        
        if (elements.length === 0) {
            callback({ success: false, error: '未找到匹配的元素' });
            return;
        }

        let successCount = 0;

        for (let i = 0; i < elements.length; i++) {
            // 滚动到元素位置
            elements[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(500);

            try {
                // 截图
                // 如果勾选高清模式，使用设置的质量；否则使用标准质量（1倍）
                const scale = options.highQuality ? (options.quality || 2) : 1;
                const canvas = await html2canvas(elements[i], {
                    backgroundColor: options.transparentBg ? null : '#ffffff',
                    scale: scale,
                    logging: false,
                    useCORS: true,
                    allowTaint: true
                });

                // 下载
                if (options.autoDownload) {
                    // 使用全局计数器确保序号连续
                    const filename = await generateSmartFilename('元素', currentImageIndex++);
                    downloadCanvas(canvas, filename);
                } else {
                    currentImageIndex++;
                }

                successCount++;
                await sleep(300);
            } catch (error) {
                console.warn('截图元素失败:', error);
                // 继续处理下一个元素
            }
        }

        callback({ success: true, count: successCount });
    } catch (error) {
        console.error('批量截图失败:', error);
        callback({ success: false, error: error.message });
    }
}

// 截取可见区域
async function captureVisibleArea(options, callback) {
    try {
        // 获取当前视口的滚动位置和尺寸
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // 截取整个页面
        // 如果勾选高清模式，使用设置的质量；否则使用标准质量（1倍）
        const scale = options.highQuality ? (options.quality || 2) : 1;
        const canvas = await html2canvas(document.body, {
            backgroundColor: options.transparentBg ? null : '#ffffff',
            scale: scale,
            logging: false,
            useCORS: true,
            allowTaint: true,
            x: scrollX,
            y: scrollY,
            width: viewportWidth,
            height: viewportHeight,
            windowWidth: viewportWidth,
            windowHeight: viewportHeight,
            scrollX: -scrollX,
            scrollY: -scrollY
        });

        if (options.autoDownload) {
            const filename = await generateSmartFilename('可见区域', 0);
            downloadCanvas(canvas, filename);
            callback({ success: true });
        } else {
            // 如果不自动下载，显示预览
            showPreview(canvas, '可见区域截图');
            callback({ success: true, preview: true });
        }
    } catch (error) {
        console.error('截取可见区域失败:', error);
        callback({ success: false, error: error.message });
    }
}

// 截取整个页面
async function captureFullPageContent(options, callback) {
    try {
        // 获取页面完整尺寸
        const fullWidth = Math.max(
            document.body.scrollWidth,
            document.body.offsetWidth,
            document.documentElement.clientWidth,
            document.documentElement.scrollWidth,
            document.documentElement.offsetWidth
        );
        
        const fullHeight = Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.clientHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight
        );

        // 如果勾选高清模式，使用设置的质量；否则使用标准质量（1倍）
        const scale = options.highQuality ? (options.quality || 2) : 1;
        const canvas = await html2canvas(document.body, {
            backgroundColor: options.transparentBg ? null : '#ffffff',
            scale: scale,
            logging: false,
            useCORS: true,
            allowTaint: true,
            width: fullWidth,
            height: fullHeight,
            windowWidth: fullWidth,
            windowHeight: fullHeight,
            x: 0,
            y: 0
        });

        if (options.autoDownload) {
            const filename = await generateSmartFilename('完整页面', 0);
            downloadCanvas(canvas, filename);
            callback({ success: true });
        } else {
            // 如果不自动下载，显示预览
            showPreview(canvas, '完整页面截图');
            callback({ success: true, preview: true });
        }
    } catch (error) {
        console.error('截取完整页面失败:', error);
        callback({ success: false, error: error.message });
    }
}

// 启用手动选择模式
function enableManualSelect(options) {
    isManualSelectMode = true;
    window._screenshotOptions = options || {};
    
    // 创建遮罩层
    createOverlay();

    // 监听鼠标移动
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('click', handleClick);
}

// 禁用手动选择模式
function disableManualSelect() {
    isManualSelectMode = false;
    
    // 移除遮罩层和提示
    if (overlayElement) {
        if (overlayElement._hintDiv) {
            overlayElement._hintDiv.remove();
        }
        overlayElement.remove();
        overlayElement = null;
    }

    // 移除高亮
    removeHighlight();

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
    hintDiv.innerHTML = '👆 移动鼠标并点击要截图的元素<br><small style="font-size: 14px; margin-top: 8px; display: block; opacity: 0.9;">按 ESC 取消</small>';
    
    document.body.appendChild(overlayElement);
    document.body.appendChild(hintDiv);
    
    // 保存提示div的引用，以便后续移除
    overlayElement._hintDiv = hintDiv;

    // ESC键取消
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            disableManualSelect();
            document.removeEventListener('keydown', escHandler);
        }
    });
}

// 处理鼠标移动
function handleMouseMove(e) {
    if (!isManualSelectMode) return;

    // 排除高亮框
    if (e.target.classList && e.target.classList.contains('screenshot-highlight')) {
        return;
    }

    // 高亮元素
    highlightElement(e.target);
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

    const targetElement = e.target;

    // 禁用选择模式
    disableManualSelect();

    // 显示处理中提示
    const processingDiv = document.createElement('div');
    processingDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 20px 40px;
        border-radius: 10px;
        font-size: 18px;
        z-index: 999999;
        font-family: 'Microsoft YaHei', sans-serif;
    `;
    processingDiv.textContent = '正在截图中...';
    document.body.appendChild(processingDiv);

    // 截图
    try {
        // 稍微延迟，让处理中提示显示出来
        await sleep(100);
        
        // 如果勾选高清模式，使用设置的质量；否则使用标准质量（1倍）
        const scale = (window._screenshotOptions && window._screenshotOptions.highQuality) 
            ? (window._screenshotOptions.quality || 2) 
            : 1;
        const canvas = await html2canvas(targetElement, {
            backgroundColor: null,
            scale: scale,
            logging: false,
            useCORS: true,
            allowTaint: true
        });

        // 检查是否自动下载
        const shouldAutoDownload = window._screenshotOptions ? window._screenshotOptions.autoDownload : true;
        if (shouldAutoDownload) {
            const filename = await generateSmartFilename('手动选择', currentImageIndex++);
            downloadCanvas(canvas, filename);
            processingDiv.textContent = '✅ 截图成功！';
        } else {
            // 不自动下载，显示预览和手动下载按钮
            showCanvasPreview(canvas, '手动选择', currentImageIndex++, processingDiv);
            return;
        }
        
        setTimeout(() => {
            processingDiv.remove();
        }, 1500);
    } catch (error) {
        console.error('手动选择截图失败:', error);
        processingDiv.textContent = '❌ 截图失败';
        setTimeout(() => {
            processingDiv.remove();
        }, 2000);
    }
}

// 高亮元素
function highlightElement(element) {
    // 移除之前的高亮
    removeHighlight();

    // 创建高亮框
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

// 下载Canvas
function downloadCanvas(canvas, filename) {
    const link = document.createElement('a');
    link.download = filename;
    // 根据文件扩展名决定格式
    const format = filename.toLowerCase().endsWith('.jpg') || filename.toLowerCase().endsWith('.jpeg') 
        ? 'image/jpeg' 
        : 'image/png';
    link.href = canvas.toDataURL(format, 0.95); // JPG质量设为0.95
    link.click();
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

// 显示Canvas预览（当不自动下载时）
async function showCanvasPreview(canvas, prefix, index, processingDiv) {
    // 更新处理提示
    processingDiv.textContent = '✅ 截图完成！';
    processingDiv.style.padding = '30px 40px';
    
    // 创建预览容器
    const previewContainer = document.createElement('div');
    previewContainer.style.cssText = `
        margin-top: 20px;
        max-width: 400px;
        max-height: 300px;
        overflow: auto;
        border-radius: 8px;
        border: 2px solid #667eea;
    `;
    
    // 创建预览图片
    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/png');
    img.style.cssText = `
        width: 100%;
        height: auto;
        display: block;
    `;
    previewContainer.appendChild(img);
    processingDiv.appendChild(previewContainer);
    
    // 创建按钮容器
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        margin-top: 15px;
        display: flex;
        gap: 10px;
    `;
    
    // 下载按钮
    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = '💾 下载';
    downloadBtn.style.cssText = `
        flex: 1;
        padding: 10px 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        font-family: 'Microsoft YaHei', sans-serif;
    `;
    downloadBtn.addEventListener('click', async () => {
        const filename = await generateSmartFilename(prefix, index);
        downloadCanvas(canvas, filename);
        processingDiv.textContent = '✅ 已下载！';
        setTimeout(() => processingDiv.remove(), 1000);
    });
    
    // 取消按钮
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✖️ 取消';
    cancelBtn.style.cssText = `
        flex: 1;
        padding: 10px 20px;
        background: #f0f0f0;
        color: #333;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        font-family: 'Microsoft YaHei', sans-serif;
    `;
    cancelBtn.addEventListener('click', () => {
        processingDiv.remove();
    });
    
    buttonContainer.appendChild(downloadBtn);
    buttonContainer.appendChild(cancelBtn);
    processingDiv.appendChild(buttonContainer);
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
    
    // 预览图
    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/png');
    img.style.cssText = `
        max-width: 100%;
        height: auto;
        border-radius: 8px;
        border: 1px solid #e0e0e0;
    `;
    previewDiv.appendChild(img);
    
    // 按钮容器
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = `
        margin-top: 15px;
        display: flex;
        gap: 10px;
    `;
    
    // 下载按钮
    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = '💾 下载';
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
    closeBtn.textContent = '✖️ 关闭';
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

// 延迟函数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== 自由框选截图功能 ==========

// 启用自由框选模式
function enableFreeSelection(options) {
    isFreeSelectionMode = true;
    createFreeSelectionOverlay();
    document.addEventListener('mousedown', handleFreeSelectionStart);
    document.addEventListener('mousemove', handleFreeSelectionMove);
    document.addEventListener('mouseup', handleFreeSelectionEnd);
    window._screenshotOptions = options;
}

// 禁用自由框选模式
function disableFreeSelection() {
    isFreeSelectionMode = false;
    if (overlayElement) {
        if (overlayElement._hintDiv) overlayElement._hintDiv.remove();
        overlayElement.remove();
        overlayElement = null;
    }
    if (selectionBox) {
        selectionBox.remove();
        selectionBox = null;
    }
    document.removeEventListener('mousedown', handleFreeSelectionStart);
    document.removeEventListener('mousemove', handleFreeSelectionMove);
    document.removeEventListener('mouseup', handleFreeSelectionEnd);
}

// 创建遮罩层
function createFreeSelectionOverlay() {
    overlayElement = document.createElement('div');
    overlayElement.id = 'screenshot-overlay';
    overlayElement.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.3); z-index: 999999; cursor: crosshair; pointer-events: none;
    `;
    const hintDiv = document.createElement('div');
    hintDiv.style.cssText = `
        position: fixed; top: 50px; left: 50%; transform: translateX(-50%);
        background: rgba(102, 126, 234, 0.95); color: white; padding: 15px 30px;
        border-radius: 10px; font-size: 18px; font-weight: bold; text-align: center;
        z-index: 1000000; pointer-events: none; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        font-family: 'Microsoft YaHei', sans-serif;
    `;
    hintDiv.innerHTML = '✂️ 拖拽鼠标框选截图区域<br><small style="font-size: 14px; margin-top: 8px; display: block; opacity: 0.9;">按 ESC 取消</small>';
    document.body.appendChild(overlayElement);
    document.body.appendChild(hintDiv);
    overlayElement._hintDiv = hintDiv;
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            disableFreeSelection();
            document.removeEventListener('keydown', escHandler);
        }
    });
}

// 鼠标按下
function handleFreeSelectionStart(e) {
    if (!isFreeSelectionMode) return;
    startX = e.clientX;
    startY = e.clientY;
    selectionBox = document.createElement('div');
    selectionBox.style.cssText = `
        position: fixed; border: 3px solid #667eea; background: rgba(102, 126, 234, 0.2);
        z-index: 1000000; pointer-events: none; box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.3);
    `;
    selectionBox.style.left = startX + 'px';
    selectionBox.style.top = startY + 'px';
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    document.body.appendChild(selectionBox);
}

// 鼠标移动
function handleFreeSelectionMove(e) {
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

// 鼠标松开
async function handleFreeSelectionEnd(e) {
    if (!isFreeSelectionMode || !selectionBox) return;
    const rect = selectionBox.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) {
        disableFreeSelection();
        return;
    }
    disableFreeSelection();
    const processingDiv = document.createElement('div');
    processingDiv.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.8); color: white; padding: 20px 40px;
        border-radius: 10px; font-size: 18px; z-index: 999999;
        font-family: 'Microsoft YaHei', sans-serif;
    `;
    processingDiv.textContent = '正在截图中...';
    document.body.appendChild(processingDiv);
    try {
        await sleep(100);
        // 如果勾选高清模式，使用设置的质量；否则使用标准质量（1倍）
        const scale = (window._screenshotOptions && window._screenshotOptions.highQuality) 
            ? (window._screenshotOptions.quality || 2) 
            : 1;
        const canvas = await html2canvas(document.body, {
            backgroundColor: window._screenshotOptions.transparentBg ? null : '#ffffff',
            scale: scale,
            logging: false, useCORS: true, allowTaint: true,
            windowWidth: window.innerWidth, windowHeight: window.innerHeight
        });
        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = rect.width * scale;
        croppedCanvas.height = rect.height * scale;
        const ctx = croppedCanvas.getContext('2d');
        ctx.drawImage(canvas, rect.left * scale, rect.top * scale, rect.width * scale, rect.height * scale,
            0, 0, rect.width * scale, rect.height * scale);
        // 检查是否自动下载
        const shouldAutoDownload = window._screenshotOptions ? window._screenshotOptions.autoDownload : true;
        if (shouldAutoDownload) {
            const filename = await generateSmartFilename('自由截图', currentImageIndex++);
            downloadCanvas(croppedCanvas, filename);
            processingDiv.textContent = '✅ 截图成功！';
            setTimeout(() => processingDiv.remove(), 1500);
        } else {
            // 不自动下载，显示预览和手动下载按钮
            showCanvasPreview(croppedCanvas, '自由截图', currentImageIndex++, processingDiv);
        }
    } catch (error) {
        console.error('截图失败:', error);
        processingDiv.textContent = '❌ 截图失败';
        setTimeout(() => processingDiv.remove(), 2000);
    }
}

