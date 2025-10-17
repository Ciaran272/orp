// 智能卡片截图助手 - 弹出窗口脚本

let currentMode = 'autoDetect';
let currentTab = null;

// DOM元素
const elements = {
    autoDetect: document.getElementById('autoDetect'),
    aiDetect: document.getElementById('aiDetect'),
    manualSelect: document.getElementById('manualSelect'),
    customSelector: document.getElementById('customSelector'),
    freeSelection: document.getElementById('freeSelection'),
    selectorInput: document.getElementById('selectorInput'),
    cssSelector: document.getElementById('cssSelector'),
    startCapture: document.getElementById('startCapture'),
    captureVisible: document.getElementById('captureVisible'),
    captureFullPage: document.getElementById('captureFullPage'),
    status: document.getElementById('status'),
    statusText: document.getElementById('statusText'),
    elementCount: document.getElementById('elementCount'),
    highQuality: document.getElementById('highQuality'),
    transparentBg: document.getElementById('transparentBg'),
    autoDownload: document.getElementById('autoDownload'),
    // 控制按钮
    controlButtons: document.getElementById('controlButtons'),
    pauseBtn: document.getElementById('pauseBtn'),
    resumeBtn: document.getElementById('resumeBtn'),
    stopBtn: document.getElementById('stopBtn'),
    progressInfo: document.getElementById('progressInfo'),
    progressText: document.getElementById('progressText')
};

// 监听来自content.js的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateProgress') {
        updateProgress(request.current, request.total);
        if (request.status) {
            elements.statusText.textContent = request.status;
        }
    } else if (request.action === 'captureComplete') {
        hideStatus();
        showStatus(`✅ 成功截取 ${request.count} 张图片`);
        setTimeout(hideStatus, 2000);
    } else if (request.action === 'captureStopped') {
        hideStatus();
        showStatus(`⏹️ 已停止，截取了 ${request.count} 张图片`);
        setTimeout(hideStatus, 2000);
    }
    // 注意：requestScreenshot 由 background.js 统一处理
});

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 获取当前标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;

    // 加载保存的设置
    loadSettings();

    // 绑定事件
    bindEvents();

    // 检查是否是特殊页面
    if (isSpecialPage(currentTab.url)) {
        elements.elementCount.textContent = '⚠️ 此页面不支持截图（系统页面）';
        // 禁用所有截图按钮
        elements.startCapture.disabled = true;
        elements.captureVisible.disabled = true;
        elements.captureFullPage.disabled = true;
        elements.startCapture.style.opacity = '0.5';
        elements.captureVisible.style.opacity = '0.5';
        elements.captureFullPage.style.opacity = '0.5';
        elements.startCapture.style.cursor = 'not-allowed';
        elements.captureVisible.style.cursor = 'not-allowed';
        elements.captureFullPage.style.cursor = 'not-allowed';
        return;
    }

    // 检测页面元素（只在非特殊页面）
    detectElements();
});

// 绑定事件
function bindEvents() {
    // 模式切换
    elements.autoDetect.addEventListener('click', () => switchMode('autoDetect'));
    elements.aiDetect.addEventListener('click', () => switchMode('aiDetect'));
    elements.manualSelect.addEventListener('click', () => switchMode('manualSelect'));
    elements.customSelector.addEventListener('click', () => switchMode('customSelector'));
    elements.freeSelection.addEventListener('click', () => switchMode('freeSelection'));

    // 截图按钮
    elements.startCapture.addEventListener('click', startCapture);
    elements.captureVisible.addEventListener('click', captureVisible);
    elements.captureFullPage.addEventListener('click', captureFullPage);
    
    // 控制按钮
    elements.pauseBtn.addEventListener('click', pauseCapture);
    elements.resumeBtn.addEventListener('click', resumeCapture);
    elements.stopBtn.addEventListener('click', stopCapture);

    // 保存设置
    elements.highQuality.addEventListener('change', saveSettings);
    elements.transparentBg.addEventListener('change', saveSettings);
    elements.autoDownload.addEventListener('change', saveSettings);
    elements.cssSelector.addEventListener('input', saveSettings);
}

// 切换模式
function switchMode(mode) {
    currentMode = mode;

    // 更新按钮状态
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    elements[mode].classList.add('active');

    // 显示/隐藏选择器输入框
    if (mode === 'customSelector') {
        elements.selectorInput.classList.remove('hidden');
    } else {
        elements.selectorInput.classList.add('hidden');
    }

    // 自由截图和手动选择模式不需要检测元素
    if (mode === 'freeSelection') {
        elements.elementCount.textContent = '✂️ 框选模式已就绪';
    } else if (mode === 'manualSelect') {
        elements.elementCount.textContent = '👆 手动选择模式已就绪';
    } else {
        // 其他模式都需要检测元素（包括AI模式）
        detectElements();
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

// 检测页面元素
async function detectElements() {
    // 再次检查（防御性编程）
    if (isSpecialPage(currentTab.url)) {
        elements.elementCount.textContent = '⚠️ 此页面不支持截图（系统页面）';
        return;
    }

    try {
        const selector = currentMode === 'customSelector' 
            ? elements.cssSelector.value 
            : getAutoSelector();

        const result = await chrome.tabs.sendMessage(currentTab.id, {
            action: 'detectElements',
            selector: selector
        });

        if (result && result.count !== undefined) {
            // 为AI模式添加特殊标记，但仍然显示元素数量
            if (currentMode === 'aiDetect') {
                elements.elementCount.textContent = `🧠 检测到 ${result.count} 个可截图元素`;
            } else {
                elements.elementCount.textContent = `检测到 ${result.count} 个可截图元素`;
            }
        }
    } catch (error) {
        // 不再使用 console.error，避免在控制台显示错误
        // 只显示用户友好的提示
        if (error.message && error.message.includes('Receiving end does not exist')) {
            elements.elementCount.textContent = '💡 请刷新网页后重试';
        } else {
            elements.elementCount.textContent = '💡 请刷新网页后重试';
        }
    }
}

// 获取自动选择器
function getAutoSelector() {
    // 按优先级尝试不同的选择器，返回第一个有匹配的
    // 这样避免重复匹配
    const selectors = [
        '.typhoon-card',      // 台风卡片（测试网页）
        '.main-card',         // 主卡片
        '.card-item',         // 卡片项
        '.content-card',      // 内容卡片
        'article.card',       // 文章卡片
        '.post-card',         // 帖子卡片
        '.news-card',         // 新闻卡片
        '.video-card',        // 视频卡片
        '.product-card',      // 产品卡片
        '.card',              // 通用卡片
        '.Card',              // 大写Card
        '.item',              // item
        '.panel',             // panel
        '.box',               // box
        '.tile',              // tile
        '[data-card]',        // 数据卡片
        '[data-item]'         // 数据项
    ];
    
    // 简单返回所有选择器，让content.js处理去重
    return selectors.join(', ');
}

// 开始截图
async function startCapture() {
    showStatus('正在准备截图...');

    try {
        // 不再预先检查页面类型，直接尝试截图
        // 如果真的无法截图，会通过 try-catch 捕获错误

        // 从存储中读取用户设置
        const settings = await chrome.storage.sync.get({
            defaultQuality: 2,
            imageFormat: 'png'
        });

        const options = {
            mode: currentMode,
            selector: currentMode === 'customSelector' ? elements.cssSelector.value : getAutoSelector(),
            highQuality: elements.highQuality.checked,
            quality: settings.defaultQuality,
            imageFormat: settings.imageFormat,
            transparentBg: elements.transparentBg.checked,
            autoDownload: elements.autoDownload.checked
        };

        if (currentMode === 'aiDetect') {
            // AI识别模式
            console.log('AI识别模式，显示控制按钮');
            showStatus('🧠 正在加载AI模型...', true);
            updateProgress(0, 0);
            
            const result = await chrome.tabs.sendMessage(currentTab.id, {
                action: 'aiDetectAndCapture',
                options: options
            });

            if (result && result.success) {
                hideStatus();
                showStatus(`✅ AI识别成功，截取 ${result.count} 张图片`);
                setTimeout(hideStatus, 2000);
            } else {
                hideStatus();
                showStatus('❌ AI识别失败：' + (result?.error || '未知错误'));
                setTimeout(hideStatus, 3000);
            }
        } else if (currentMode === 'manualSelect') {
            // 手动选择模式
            await chrome.tabs.sendMessage(currentTab.id, {
                action: 'enableManualSelect',
                options: options
            });
            showStatus('请在网页上点击要截图的元素');
            setTimeout(hideStatus, 3000);
        } else if (currentMode === 'freeSelection') {
            // 自由框选模式（QQ截图风格：先截图，后框选）
            showStatus('正在生成页面截图...');
            
            await chrome.tabs.sendMessage(currentTab.id, {
                action: 'enableFreeSelection',
                options: options
            });
            
            // 提示会由content.js控制，这里延迟隐藏
            setTimeout(() => {
                hideStatus();
            }, 3000);
        } else {
            // 自动截图模式
            console.log('自动截图模式，显示控制按钮');
            showStatus('🎯 正在截图中...', true);
            updateProgress(0, 0);
            
            const result = await chrome.tabs.sendMessage(currentTab.id, {
                action: 'captureElements',
                options: options
            });

            if (result && result.success) {
                hideStatus();
                showStatus(`✅ 成功截取 ${result.count} 张图片`);
                setTimeout(hideStatus, 2000);
            } else {
                hideStatus();
                showStatus('❌ 截图失败：' + (result?.error || '未知错误'));
                setTimeout(hideStatus, 3000);
            }
        }
    } catch (error) {
        // 友好的错误提示
        if (error.message && error.message.includes('Receiving end does not exist')) {
            showStatus('💡 请先刷新网页（按F5）后重试');
        } else if (error.message && error.message.includes('Cannot access')) {
            showStatus('❌ 此页面不支持扩展功能');
        } else {
            showStatus('❌ 截图失败，请尝试刷新页面');
        }
        setTimeout(hideStatus, 3000);
    }
}

// 截取可见区域
async function captureVisible() {
    showStatus('正在截取可见区域...');

    try {
        // 不再预先检查页面类型，直接尝试截图

        // 从存储中读取用户设置
        const settings = await chrome.storage.sync.get({
            defaultQuality: 2,
            imageFormat: 'png'
        });

        const options = {
            highQuality: elements.highQuality.checked,
            quality: settings.defaultQuality,
            imageFormat: settings.imageFormat,
            transparentBg: elements.transparentBg.checked,
            autoDownload: elements.autoDownload.checked
        };

        const result = await chrome.tabs.sendMessage(currentTab.id, {
            action: 'captureVisible',
            options: options
        });

        if (result && result.success) {
            if (result.preview) {
                showStatus('✅ 截图完成，请在网页查看预览');
            } else {
                showStatus('✅ 截图成功');
            }
            setTimeout(hideStatus, 2000);
        } else {
            showStatus('❌ 截图失败');
            setTimeout(hideStatus, 3000);
        }
    } catch (error) {
        // 友好的错误提示
        if (error.message && error.message.includes('Receiving end does not exist')) {
            showStatus('💡 请先刷新网页（按F5）后重试');
        } else if (error.message && error.message.includes('Cannot access')) {
            showStatus('❌ 此页面不支持扩展功能');
        } else {
            showStatus('❌ 截图失败，请尝试刷新页面');
        }
        setTimeout(hideStatus, 3000);
    }
}

// 截取整个页面
async function captureFullPage() {
    showStatus('正在截取整个页面（这可能需要一些时间）...');

    try {
        // 不再预先检查页面类型，直接尝试截图

        // 从存储中读取用户设置
        const settings = await chrome.storage.sync.get({
            defaultQuality: 2,
            imageFormat: 'png'
        });

        const options = {
            highQuality: elements.highQuality.checked,
            quality: settings.defaultQuality,
            imageFormat: settings.imageFormat,
            transparentBg: elements.transparentBg.checked,
            autoDownload: elements.autoDownload.checked
        };

        const result = await chrome.tabs.sendMessage(currentTab.id, {
            action: 'captureFullPage',
            options: options
        });

        if (result && result.success) {
            if (result.preview) {
                showStatus('✅ 截图完成，请在网页查看预览');
            } else {
                showStatus('✅ 截图成功');
            }
            setTimeout(hideStatus, 2000);
        } else {
            showStatus('❌ 截图失败');
            setTimeout(hideStatus, 3000);
        }
    } catch (error) {
        // 友好的错误提示
        if (error.message && error.message.includes('Receiving end does not exist')) {
            showStatus('💡 请先刷新网页（按F5）后重试');
        } else if (error.message && error.message.includes('Cannot access')) {
            showStatus('❌ 此页面不支持扩展功能');
        } else {
            showStatus('❌ 截图失败，请尝试刷新页面');
        }
        setTimeout(hideStatus, 3000);
    }
}

// 显示状态
function showStatus(text, showControls = false) {
    elements.statusText.textContent = text;
    elements.status.classList.remove('hidden');
    
    // 控制按钮现在在action-section中，独立控制显示
    if (showControls) {
        console.log('显示控制按钮（在action区域）');
        elements.controlButtons.classList.remove('hidden');
        elements.progressInfo.classList.remove('hidden');
    }
}

// 隐藏状态
function hideStatus() {
    elements.status.classList.add('hidden');
    // 同时隐藏控制按钮（现在在action-section中）
    elements.controlButtons.classList.add('hidden');
    elements.progressInfo.classList.add('hidden');
    // 重置按钮状态
    elements.pauseBtn.classList.remove('hidden');
    elements.resumeBtn.classList.add('hidden');
}

// 更新进度
function updateProgress(current, total) {
    elements.progressText.textContent = `进度: ${current}/${total}`;
}

// 暂停截图
async function pauseCapture() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.tabs.sendMessage(tab.id, { action: 'pauseCapture' });
        
        elements.pauseBtn.classList.add('hidden');
        elements.resumeBtn.classList.remove('hidden');
        elements.statusText.textContent = '已暂停';
    } catch (error) {
        console.error('暂停失败:', error);
    }
}

// 继续截图
async function resumeCapture() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.tabs.sendMessage(tab.id, { action: 'resumeCapture' });
        
        elements.resumeBtn.classList.add('hidden');
        elements.pauseBtn.classList.remove('hidden');
        elements.statusText.textContent = '继续截图中...';
    } catch (error) {
        console.error('继续失败:', error);
    }
}

// 停止截图
async function stopCapture() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.tabs.sendMessage(tab.id, { action: 'stopCapture' });
        
        hideStatus();
        showStatus('✅ 已停止截图', false);
        setTimeout(hideStatus, 2000);
    } catch (error) {
        console.error('停止失败:', error);
    }
}


// 加载设置
function loadSettings() {
    chrome.storage.sync.get({
        highQuality: true,
        transparentBg: false,
        autoDownload: true,
        cssSelector: '.main-card'
    }, (settings) => {
        elements.highQuality.checked = settings.highQuality;
        elements.transparentBg.checked = settings.transparentBg;
        elements.autoDownload.checked = settings.autoDownload;
        elements.cssSelector.value = settings.cssSelector;
    });
}

// 保存设置
function saveSettings() {
    const settings = {
        highQuality: elements.highQuality.checked,
        transparentBg: elements.transparentBg.checked,
        autoDownload: elements.autoDownload.checked,
        cssSelector: elements.cssSelector.value
    };

    chrome.storage.sync.set(settings);
}

// 注意：handleFreeScreenshotRequest 已移至 background.js
// requestScreenshot 消息现在由 background.js 统一处理

