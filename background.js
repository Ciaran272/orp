// 智能卡片截图助手 - 后台脚本

// 监听快捷键命令
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'free-screenshot') {
        console.log('🎯 快捷键触发：自由截图');
        
        try {
            // 获取当前活动标签页
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab) {
                console.error('无法获取当前标签页');
                return;
            }
            
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
            
            console.log('📸 发送自由截图命令到content.js，配置:', options);
            
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
                    console.log('✅ 自由截图命令已发送');
                } catch (err) {
                    retries--;
                    if (retries > 0) {
                        console.log(`⚠️ 发送失败，等待重试... (剩余${retries}次)`);
                        await sleep(300);
                    } else {
                        throw err;
                    }
                }
            }
            
        } catch (error) {
            console.error('❌ 快捷键触发失败:', error);
            
            // 判断错误类型并给出友好提示
            if (error.message && error.message.includes('Receiving end does not exist')) {
                // content.js 未加载
                console.log('💡 提示：页面需要刷新以加载扩展功能');
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon128.png',
                    title: '请刷新页面',
                    message: '按 F5 刷新后即可使用快捷键截图',
                    priority: 1
                });
            } else if (error.message && error.message.includes('Cannot access')) {
                // 系统页面或受保护页面
                console.log('💡 提示：此页面不支持扩展功能');
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon128.png',
                    title: '此页面不支持截图',
                    message: '请切换到普通网页使用截图功能',
                    priority: 1
                });
            } else {
                // 其他未知错误，提供更多解决方案
                console.log('💡 提示：发生了未知错误');
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
        console.log('📨 background.js: 收到 requestScreenshot 消息');
        handleScreenshotRequest(request, sender);
        return true; // 支持异步操作
    }
    
    if (request.action === 'captureVisibleTab') {
        console.log('📨 background.js: 收到 captureVisibleTab 消息');
        handleCaptureVisibleTab(request, sender, sendResponse);
        return true; // 支持异步操作
    }
    
    if (request.action === 'captureFullPage') {
        console.log('📨 background.js: 收到 captureFullPage 消息');
        handleCaptureFullPage(request, sender, sendResponse);
        return true; // 支持异步操作
    }
});

// 处理截图请求
async function handleScreenshotRequest(request, sender) {
    try {
        console.log('📸 background.js: 收到截图请求', sender);
        
        // 检查 sender.tab 是否存在
        if (!sender || !sender.tab || !sender.tab.id) {
            console.error('❌ background.js: sender.tab 无效');
            return;
        }
        
        const tabId = sender.tab.id;
        const windowId = sender.tab.windowId;
        
        console.log('📸 background.js: 准备截图，tabId:', tabId, 'windowId:', windowId);
        
        // 使用Chrome API截取可见标签页
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
            format: 'png'
        });
        
        console.log('✅ background.js: 截图成功，dataUrl长度:', dataUrl.length);
        
        // 发送截图数据回content.js
        await chrome.tabs.sendMessage(tabId, {
            action: 'showScreenshotOverlay',
            dataUrl: dataUrl,
            options: request.options
        });
        
        console.log('✅ background.js: 截图数据已发送到content.js');
        
    } catch (error) {
        console.error('❌ background.js: 截图失败:', error);
        console.error('错误详情:', error.message);
        
        // 尝试通知content.js截图失败
        try {
            if (sender && sender.tab && sender.tab.id) {
                await chrome.tabs.sendMessage(sender.tab.id, {
                    action: 'screenshotFailed',
                    error: error.message
                });
            }
        } catch (e) {
            console.error('无法通知content.js:', e);
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
        console.log('📸 background.js: 开始截取可见标签页');
        
        const windowId = sender.tab.windowId;
        
        // 使用Chrome API截取
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
            format: 'png'
        });
        
        console.log('✅ background.js: 截图成功，dataUrl长度:', dataUrl.length);
        
        // 直接下载
        const filename = await generateFilename('可见区域', request.options);
        await downloadImage(dataUrl, filename);
        
        console.log('✅ background.js: 可见区域截图已下载');
        sendResponse({ success: true });
        
    } catch (error) {
        console.error('❌ background.js: 截取可见标签页失败:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// 处理截取整个页面（滚动拼接）
async function handleCaptureFullPage(request, sender, sendResponse) {
    try {
        console.log('📄 background.js: 开始截取整个页面（滚动拼接）');
        
        const tabId = sender.tab.id;
        const windowId = sender.tab.windowId;
        
        // 显示开始提示
        await chrome.tabs.sendMessage(tabId, {
            action: 'showFullPageProgress',
            text: '正在准备截取整个页面...'
        });
        
        // 获取页面尺寸
        const pageInfo = await chrome.tabs.sendMessage(tabId, {
            action: 'getPageDimensions'
        });
        
        console.log('📐 页面尺寸:', pageInfo);
        
        const viewportHeight = pageInfo.viewportHeight;
        const fullHeight = pageInfo.fullHeight;
        const fullWidth = pageInfo.fullWidth;
        
        // 计算需要截取的次数（最多20次，避免超大页面）
        let screenshotsNeeded = Math.ceil(fullHeight / viewportHeight);
        if (screenshotsNeeded > 20) {
            console.warn('⚠️ 页面过大，限制为20次截取');
            screenshotsNeeded = 20;
        }
        
        console.log(`📊 需要截取 ${screenshotsNeeded} 次`);
        
        // 保存当前滚动位置
        const originalScrollY = pageInfo.scrollY;
        
        // 截取所有片段
        const screenshots = [];
        for (let i = 0; i < screenshotsNeeded; i++) {
            try {
                // 滚动到指定位置
                const scrollY = i * viewportHeight;
                await chrome.tabs.sendMessage(tabId, {
                    action: 'scrollTo',
                    y: scrollY
                });
                
                // 等待滚动完成
                await sleep(800);
                
                // 隐藏所有提示（避免被截入）
                await chrome.tabs.sendMessage(tabId, {
                    action: 'hideAllHints'
                });
                
                // 等待提示消失
                await sleep(100);
                
                // 截图（Chrome限制每秒最多2次调用）
                const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
                    format: 'png'
                });
                
                // 显示进度提示（截图后显示）
                await chrome.tabs.sendMessage(tabId, {
                    action: 'showFullPageProgress',
                    text: `已截取 ${i + 1}/${screenshotsNeeded}，继续中...`
                });
                
                // 额外等待，避免超过API调用频率限制
                await sleep(200);
                
                screenshots.push({
                    dataUrl: dataUrl,
                    offsetY: scrollY
                });
                
                console.log(`✅ 截取进度: ${i + 1}/${screenshotsNeeded}`);
                
            } catch (error) {
                console.error(`❌ 截取第${i + 1}张失败:`, error);
                // 继续尝试下一张，不中断
            }
        }
        
        console.log(`✅ 截取完成，共获得 ${screenshots.length} 张截图`);
        
        // 恢复原始滚动位置
        await chrome.tabs.sendMessage(tabId, {
            action: 'scrollTo',
            y: originalScrollY
        });
        
        // 隐藏提示，准备拼接
        await chrome.tabs.sendMessage(tabId, {
            action: 'hideAllHints'
        });
        
        // 等待一下
        await sleep(100);
        
        // 显示拼接进度
        await chrome.tabs.sendMessage(tabId, {
            action: 'showFullPageProgress',
            text: '正在拼接截图...'
        });
        
        // 发送所有截图到content.js进行拼接
        await chrome.tabs.sendMessage(tabId, {
            action: 'stitchScreenshots',
            screenshots: screenshots,
            fullWidth: fullWidth,
            fullHeight: fullHeight,
            viewportHeight: viewportHeight,
            options: request.options
        });
        
        console.log('✅ background.js: 整页截图数据已发送');
        sendResponse({ success: true });
        
    } catch (error) {
        console.error('❌ background.js: 截取整个页面失败:', error);
        
        // 通知失败
        try {
            await chrome.tabs.sendMessage(sender.tab.id, {
                action: 'hideFullPageProgress',
                error: error.message
            });
        } catch (e) {
            console.error('无法通知失败:', e);
        }
        
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
        console.log('✅ 文件已下载:', filename);
    } catch (error) {
        console.error('❌ 下载失败:', error);
        throw error;
    }
}

// 延迟函数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

console.log('✅ 智能卡片截图助手 - 后台脚本已加载');
console.log('⌨️ 快捷键: Ctrl+Shift+S (Mac: Command+Shift+S) - 快速自由截图');

