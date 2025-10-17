// 智能卡片截图助手 - 内容脚本

let isManualSelectMode = false;
let isFreeSelectionMode = false;
let highlightedElement = null;
let overlayElement = null;
let selectionBox = null;
let startX = 0, startY = 0;
let currentImageIndex = 0;

// 控制标志
let isPaused = false;
let isStopped = false;

// 浮动控制面板
let floatingControlPanel = null;

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
    
    if (request.action === 'getPageDimensions') {
        // 返回页面尺寸信息
        const dimensions = {
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            fullWidth: Math.max(
                document.body.scrollWidth,
                document.documentElement.scrollWidth,
                document.body.offsetWidth,
                document.documentElement.offsetWidth
            ),
            fullHeight: Math.max(
                document.body.scrollHeight,
                document.documentElement.scrollHeight,
                document.body.offsetHeight,
                document.documentElement.offsetHeight
            ),
            scrollX: window.scrollX || window.pageXOffset,
            scrollY: window.scrollY || window.pageYOffset
        };
        sendResponse(dimensions);
        return true;
    }
    
    if (request.action === 'scrollTo') {
        // 滚动到指定位置
        window.scrollTo(0, request.y);
        sendResponse({ success: true });
        return true;
    }
    
    if (request.action === 'stitchScreenshots') {
        // 拼接截图
        stitchAndDownloadScreenshots(request);
        sendResponse({ success: true });
        return true;
    }
    
    if (request.action === 'showFullPageProgress') {
        // 显示整页截图进度
        showFullPageProgressHint(request.text);
        sendResponse({ success: true });
        return true;
    }
    
    if (request.action === 'hideFullPageProgress') {
        // 隐藏进度提示
        hideFullPageProgressHint(request.error);
        sendResponse({ success: true });
        return true;
    }
    
    if (request.action === 'hideAllHints') {
        // 隐藏所有提示元素（避免被截入）
        const hint = document.getElementById('full-page-progress-hint');
        if (hint) {
            hint.style.display = 'none';
        }
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

// 截取多个元素
async function captureElements(options, callback) {
    // 重置控制标志
    isPaused = false;
    isStopped = false;
    
    try {
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
            elements[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(500);

            try {
                // 截图
                // 如果勾选高清模式，使用设置的质量；否则使用标准质量（1倍）
                const scale = options.highQuality ? (options.quality || 2) : 1;
                
                // 根据用户设置决定背景颜色
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
                
                const canvas = await html2canvas(elements[i], {
                    backgroundColor: bgColor,
                    scale: scale,
                    logging: false,
                    useCORS: true,
                    allowTaint: true,
                    removeContainer: true,
                    imageTimeout: 15000,
                    onclone: (clonedDoc) => {
                        // 确保克隆的元素可见
                        const clonedElement = clonedDoc.querySelector(`[class="${elements[i].className}"]`);
                        if (clonedElement) {
                            clonedElement.style.opacity = '1';
                            clonedElement.style.visibility = 'visible';
                        }
                    }
                });
                
                console.log(`截图完成，canvas大小: ${canvas.width} x ${canvas.height}`);
                
                // 检查canvas内容（采样检查）
                const ctx = canvas.getContext('2d');
                const imageData = ctx.getImageData(0, 0, Math.min(canvas.width, 100), Math.min(canvas.height, 100));
                const pixels = imageData.data;
                let hasNonWhitePixel = false;
                let hasNonTransparentPixel = false;
                
                for (let j = 0; j < pixels.length; j += 4) {
                    if (pixels[j+3] > 0) {
                        hasNonTransparentPixel = true;
                    }
                    if (pixels[j] < 250 || pixels[j+1] < 250 || pixels[j+2] < 250) {
                        hasNonWhitePixel = true;
                    }
                    if (hasNonTransparentPixel && hasNonWhitePixel) {
                        break;
                    }
                }
                
                console.log('Canvas内容检查:', {
                    hasNonTransparentPixel,
                    hasNonWhitePixel,
                    bgColor
                });
                
                if (!hasNonTransparentPixel) {
                    console.error('⚠️ Canvas完全透明！');
                } else if (!hasNonWhitePixel && bgColor === '#ffffff') {
                    console.warn('⚠️ Canvas可能全是白色');
                }

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
                console.warn(`截图第${i+1}/${elements.length}个元素失败:`, error.message);
                console.warn('失败元素信息:', {
                    class: elements[i].className,
                    width: elements[i].offsetWidth,
                    height: elements[i].offsetHeight
                });
                // 继续处理下一个元素，不中断整个流程
            }
        }

        // 完成后隐藏浮动控制面板
        hideFloatingControlPanel();
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
        console.log('📸 开始截取可见区域（使用Chrome API），options:', options);
        
        // 发送消息给background.js，请求使用Chrome API截图
        chrome.runtime.sendMessage({
            action: 'captureVisibleTab',
            options: options
        }, (response) => {
            console.log('📩 收到截图响应:', response);
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

// 截取整个页面（使用Chrome API滚动拼接）
async function captureFullPageContent(options, callback) {
    try {
        console.log('📄 开始截取整个页面（Chrome API分段截取），options:', options);
        
        // 发送消息给background.js，请求分段截取整页
        chrome.runtime.sendMessage({
            action: 'captureFullPage',
            options: options
        }, (response) => {
            console.log('📩 收到整页截图响应:', response);
            if (response && response.success) {
            callback({ success: true });
        } else {
                callback({ success: false, error: response?.error || '整页截图失败' });
        }
        });
        
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
        
        // 根据用户设置决定背景颜色
        const bgColor = (window._screenshotOptions && window._screenshotOptions.transparentBg) 
            ? null 
            : '#ffffff';
        
        console.log('手动选择截图配置:', {scale, bgColor, element: targetElement});
        
        const canvas = await html2canvas(targetElement, {
            backgroundColor: bgColor,
            scale: scale,
            logging: false,
            useCORS: true,
            allowTaint: true,
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
        
        console.log('手动选择截图完成，canvas大小:', canvas.width, 'x', canvas.height);
        
        // 检查canvas是否有内容
        if (!canvas || canvas.width === 0 || canvas.height === 0) {
            console.error('❌ Canvas无效');
            throw new Error('截图失败：Canvas大小为0');
        }
        
        // 检查canvas内容是否为空（采样检查）
        const ctx = canvas.getContext('2d');
        const sampleSize = Math.min(100, canvas.width * canvas.height);
        const imageData = ctx.getImageData(0, 0, Math.min(canvas.width, 100), Math.min(canvas.height, 100));
        const pixels = imageData.data;
        let hasNonWhitePixel = false;
        let hasNonTransparentPixel = false;
        
        for (let i = 0; i < pixels.length; i += 4) {
            // 检查是否有非透明像素
            if (pixels[i+3] > 0) {
                hasNonTransparentPixel = true;
            }
            // 检查是否有非白色像素（允许一些偏差）
            if (pixels[i] < 250 || pixels[i+1] < 250 || pixels[i+2] < 250) {
                hasNonWhitePixel = true;
            }
            if (hasNonTransparentPixel && hasNonWhitePixel) {
                break;
            }
        }
        
        console.log('Canvas内容检查:', {
            hasNonTransparentPixel,
            hasNonWhitePixel,
            bgColor
        });
        
        if (!hasNonTransparentPixel) {
            console.error('⚠️ Canvas完全透明！');
        }

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
    processingDiv.style.maxWidth = '90vw';
    processingDiv.style.maxHeight = '90vh';
    processingDiv.style.overflow = 'hidden';
    
    // 计算合适的预览尺寸（保持宽高比，不超过屏幕80%）
    const maxWidth = window.innerWidth * 0.8;
    const maxHeight = window.innerHeight * 0.7;
    const canvasRatio = canvas.width / canvas.height;
    
    let previewWidth, previewHeight;
    if (canvas.width > maxWidth || canvas.height > maxHeight) {
        // 需要缩放
        if (canvasRatio > maxWidth / maxHeight) {
            // 宽度是限制因素
            previewWidth = maxWidth;
            previewHeight = maxWidth / canvasRatio;
        } else {
            // 高度是限制因素
            previewHeight = maxHeight;
            previewWidth = maxHeight * canvasRatio;
        }
    } else {
        // 原始尺寸即可
        previewWidth = canvas.width;
        previewHeight = canvas.height;
    }
    
    // 创建预览容器
    const previewContainer = document.createElement('div');
    previewContainer.style.cssText = `
        margin-top: 20px;
        width: ${previewWidth}px;
        height: ${previewHeight}px;
        border-radius: 8px;
        border: 2px solid #667eea;
        overflow: hidden;
        background: #f5f5f5;
    `;
    
    // 创建预览图片
    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/png');
    img.style.cssText = `
        width: 100%;
        height: 100%;
        object-fit: contain;
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
        updateLoadingHint(loadingHint, '🔍 AI正在分析页面...');
        
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
                updateLoadingHint(loadingHint, `已暂停...`);
                await sleep(100);
                if (isStopped) break;
            }
            
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
            
            try {
                // 滚动到元素位置
                elements[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
                await sleep(300);

                updateLoadingHint(loadingHint, `截图中... ${i + 1}/${elements.length}`);
                updateFloatingControlProgress(`AI截图中 ${i + 1}/${elements.length} (已完成 ${successCount})`);
                
                // 发送进度更新
                chrome.runtime.sendMessage({ 
                    action: 'updateProgress', 
                    current: i + 1, 
                    total: elements.length,
                    status: `AI截图中 ${i + 1}/${elements.length}`
                });

                // 截图（增强兼容性）
                const scale = options.highQuality ? (options.quality || 2) : 1;
                const canvas = await html2canvas(elements[i], {
                    backgroundColor: options.transparentBg ? null : '#ffffff',
                    scale: scale,
                    logging: false,
                    useCORS: true,
                    allowTaint: true,
                    removeContainer: true,  // 自动清理
                    imageTimeout: 15000,    // 图片加载超时
                    onclone: (clonedDoc) => {
                        // 修复克隆文档中的样式问题
                        const clonedElement = clonedDoc.querySelector(`[class="${elements[i].className}"]`);
                        if (clonedElement) {
                            clonedElement.style.opacity = '1';
                            clonedElement.style.visibility = 'visible';
                        }
                    }
                });

                // 下载
                if (options.autoDownload) {
                    const filename = await generateSmartFilename('AI识别', currentImageIndex++);
                    downloadCanvas(canvas, filename);
                } else {
                    currentImageIndex++;
                }

                successCount++;
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

        if (loadingHint) loadingHint.remove();
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
        <div style="margin-bottom: 10px;">🧠 AI智能识别</div>
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

// 拼接截图并下载
async function stitchAndDownloadScreenshots(request) {
    try {
        console.log('🔗 开始拼接截图，共', request.screenshots.length, '张');
        console.log('📊 拼接参数:', {
            fullWidth: request.fullWidth,
            fullHeight: request.fullHeight,
            viewportHeight: request.viewportHeight,
            screenshotCount: request.screenshots.length
        });
        
        if (request.screenshots.length === 0) {
            throw new Error('没有截图可拼接');
        }
        
        // 先加载第一张图片，获取实际尺寸（考虑DPI）
        const firstImg = new Image();
        await new Promise((resolve, reject) => {
            firstImg.onload = resolve;
            firstImg.onerror = reject;
            firstImg.src = request.screenshots[0].dataUrl;
        });
        
        console.log('📐 第一张截图实际尺寸:', firstImg.width, 'x', firstImg.height);
        console.log('📐 视口尺寸:', request.viewportHeight);
        
        // 计算设备像素比
        const dpr = firstImg.height / request.viewportHeight;
        console.log('📱 设备像素比:', dpr);
        
        // 创建canvas（使用实际像素尺寸）
        const canvas = document.createElement('canvas');
        canvas.width = firstImg.width;  // 使用实际截图的宽度
        canvas.height = request.fullHeight * dpr;  // 总高度也要乘以DPR
        const ctx = canvas.getContext('2d');
        
        console.log('📐 Canvas实际尺寸:', canvas.width, 'x', canvas.height);
        
        // 填充白色背景
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 加载并绘制每张截图
        let currentY = 0;  // 当前绘制位置
        
        for (let i = 0; i < request.screenshots.length; i++) {
            const screenshot = request.screenshots[i];
            
            // 更新进度
            showFullPageProgressHint(`拼接截图 ${i + 1}/${request.screenshots.length}...`);
            
            // 加载图片
            const img = (i === 0) ? firstImg : new Image();
            if (i > 0) {
                await new Promise((resolve, reject) => {
                    img.onload = () => {
                        console.log(`图片${i+1}加载成功，尺寸: ${img.width} x ${img.height}`);
                        resolve();
                    };
                    img.onerror = reject;
                    img.src = screenshot.dataUrl;
                });
            }
            
            console.log(`准备绘制第${i+1}张，y位置: ${currentY}, 图片高度: ${img.height}`);
            
            // 直接绘制整张图片（不缩放，保持原始质量）
            ctx.drawImage(img, 0, currentY);
            
            console.log(`✅ 拼接进度: ${i + 1}/${request.screenshots.length}, y位置: ${currentY}`);
            
            // 更新下一张的y位置
            currentY += img.height;
        }
        
        console.log('✅ 拼接完成，准备下载');
        
        // 显示下载提示
        showFullPageProgressHint('正在保存...');
        
        // 下载
        const filename = await generateSmartFilename('完整页面', 0);
        downloadCanvas(canvas, filename);
        
        console.log('✅ 整页截图已下载:', filename);
        
        // 显示成功提示
        showFullPageProgressHint('✅ 截图成功！');
        setTimeout(() => hideFullPageProgressHint(), 2000);
        
    } catch (error) {
        console.error('❌ 拼接截图失败:', error);
        hideFullPageProgressHint('拼接失败: ' + error.message);
    }
}

// 显示整页截图进度提示
function showFullPageProgressHint(text) {
    let hint = document.getElementById('full-page-progress-hint');
    if (!hint) {
        hint = document.createElement('div');
        hint.id = 'full-page-progress-hint';
        hint.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(102, 126, 234, 0.95);
            color: white;
            padding: 25px 40px;
            border-radius: 12px;
            font-size: 18px;
            font-weight: bold;
            z-index: 2147483647;
            font-family: 'Microsoft YaHei', sans-serif;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        `;
        document.body.appendChild(hint);
    }
    hint.style.display = 'block';  // 确保显示
    hint.textContent = text;
}

// 隐藏整页截图进度提示
function hideFullPageProgressHint(errorMessage) {
    const hint = document.getElementById('full-page-progress-hint');
    if (hint) {
        if (errorMessage) {
            hint.textContent = '❌ ' + errorMessage;
            hint.style.backgroundColor = '#ff6b6b';
            setTimeout(() => hint.remove(), 3000);
        } else {
            hint.remove();
        }
    }
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
            📸 批量截图中...
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
            ">⏸️ 暂停</button>
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
            ">▶️ 继续</button>
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
            ">⏹️ 停止</button>
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
    hintDiv.innerHTML = '✂️ 拖拽鼠标框选截图区域 | 按 ESC 取消';
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
        
        // 创建canvas进行裁剪
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(rect.width * scaleX);
        canvas.height = Math.round(rect.height * scaleY);
        const ctx = canvas.getContext('2d');
        
        // 从截图中裁剪出选择区域
        ctx.drawImage(img,
            Math.round(rect.left * scaleX),   // 源图x位置
            Math.round(rect.top * scaleY),    // 源图y位置
            Math.round(rect.width * scaleX),  // 源图宽度
            Math.round(rect.height * scaleY), // 源图高度
            0, 0,                             // 目标x,y
            canvas.width,                     // 目标宽度
            canvas.height                     // 目标高度
        );
        
        console.log('✅ 裁剪完成，canvas大小:', canvas.width, 'x', canvas.height);
        
        // 下载
            const filename = await generateSmartFilename('自由截图', currentImageIndex++);
        downloadCanvas(canvas, filename);
        
            processingDiv.textContent = '✅ 截图成功！';
            setTimeout(() => processingDiv.remove(), 1500);
        
    } catch (error) {
        console.error('❌ 截图处理失败:', error);
        processingDiv.textContent = '❌ 截图失败: ' + error.message;
        processingDiv.style.backgroundColor = '#ff6b6b';
        setTimeout(() => processingDiv.remove(), 2000);
    }
}

// 禁用自由框选模式
function disableFreeSelection() {
    disableScreenshotSelection();
}


