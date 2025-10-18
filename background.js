// 智能卡片截图助手 - 后台脚本

// 监听快捷键命令
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'free-screenshot') {
        try {
            // 获取当前活动标签页
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab) return;
            
            // 读取用户设置
            const settings = await chrome.storage.sync.get({
                defaultQuality: 2,
                imageFormat: 'png',
                highQuality: true,
                transparentBg: false,
                autoDownload: true
            });
            
            const options = {
                mode: 'freeSelection',
                highQuality: settings.highQuality,
                quality: settings.defaultQuality,
                imageFormat: settings.imageFormat,
                transparentBg: settings.transparentBg,
                autoDownload: settings.autoDownload
            };
            
            // 尝试发送消息到content.js，带重试机制
            let retries = 3;
            let success = false;
            
            while (retries > 0 && !success) {
                try {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'enableFreeSelection',
                        options: options
                    });
                    success = true;
                } catch (err) {
                    retries--;
                    if (retries > 0) {
                        await sleep(300);
                    } else {
                        throw err;
                    }
                }
            }
            
        } catch (error) {
            // 判断错误类型并给出友好提示
            if (error.message && error.message.includes('Receiving end does not exist')) {
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon128.png',
                    title: '请刷新页面',
                    message: '按 F5 刷新后即可使用快捷键截图',
                    priority: 1
                });
            } else if (error.message && error.message.includes('Cannot access')) {
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon128.png',
                    title: '此页面不支持截图',
                    message: '请切换到普通网页使用截图功能',
                    priority: 1
                });
            } else {
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon128.png',
                    title: '截图失败',
                    message: '请尝试：1) 刷新页面 2) 重新加载扩展 3) 使用扩展弹窗方式',
                    priority: 1
                });
            }
        }
    }
});

// 监听来自content.js的截图请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'requestScreenshot') {
        handleScreenshotRequest(request, sender);
        return true;
    }
    
    if (request.action === 'captureVisibleTab') {
        handleCaptureVisibleTab(request, sender, sendResponse);
        return true;
    }
});

// 处理截图请求
async function handleScreenshotRequest(request, sender) {
    try {
        if (!sender || !sender.tab || !sender.tab.id) return;
        
        const tabId = sender.tab.id;
        const windowId = sender.tab.windowId;
        
        // 使用Chrome API截取可见标签页
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
            format: 'png'
        });
        
        // 发送截图数据回content.js
        await chrome.tabs.sendMessage(tabId, {
            action: 'showScreenshotOverlay',
            dataUrl: dataUrl,
            options: request.options
        });
        
    } catch (error) {
        // 尝试通知content.js截图失败
        try {
            if (sender && sender.tab && sender.tab.id) {
                await chrome.tabs.sendMessage(sender.tab.id, {
                    action: 'screenshotFailed',
                    error: error.message
                });
            }
        } catch (e) {
            // 静默失败
        }
    }
}

// 检查是否是特殊页面
function isSpecialPage(url) {
    if (!url) return true;
    return url.startsWith('chrome://') || 
           url.startsWith('chrome-extension://') ||
           url.startsWith('edge://') ||
           url.startsWith('about:');
}

// 处理截取可见标签页
async function handleCaptureVisibleTab(request, sender, sendResponse) {
    try {
        const windowId = sender.tab.windowId;
        
        // 使用Chrome API截取
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
            format: 'png'
        });
        
        // 如果请求中有filename，说明是要直接下载
        if (request.options && request.options.downloadNow) {
            const filename = await generateFilename('可见区域', request.options);
            await downloadImage(dataUrl, filename);
            sendResponse({ success: true });
        } else {
            // 否则返回dataUrl供调用方处理
            sendResponse({ success: true, dataUrl: dataUrl });
        }
        
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// 生成文件名
async function generateFilename(prefix, options) {
    const timestamp = new Date().getTime();
    const format = options.imageFormat || 'png';
    return `${prefix}_${timestamp}.${format}`;
}

// 下载图片（使用Chrome Downloads API）
async function downloadImage(dataUrl, filename) {
    try {
        await chrome.downloads.download({
            url: dataUrl,
            filename: filename,
            saveAs: false
        });
    } catch (error) {
        throw error;
    }
}

// 延迟函数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
