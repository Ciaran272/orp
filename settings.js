// 设置页面脚本

// 默认设置
const defaultSettings = {
    fileNameTemplate: '截图_{n}',
    startNumber: 1,
    numberPadding: 0,
    defaultQuality: 2,
    imageFormat: 'png',
    aiMinScore: 0.3,
    aiMinSize: 100
};

// 页面加载时读取设置并绑定事件
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    bindEvents();
});

// 绑定事件
function bindEvents() {
    document.getElementById('saveBtn').addEventListener('click', saveSettings);
    document.getElementById('resetBtn').addEventListener('click', resetSettings);
    document.getElementById('openShortcuts').addEventListener('click', openShortcutsPage);
}

// 加载设置
function loadSettings() {
    chrome.storage.sync.get(defaultSettings, (settings) => {
        document.getElementById('fileNameTemplate').value = settings.fileNameTemplate;
        document.getElementById('startNumber').value = settings.startNumber;
        document.getElementById('numberPadding').value = settings.numberPadding;
        document.getElementById('defaultQuality').value = settings.defaultQuality;
        document.getElementById('imageFormat').value = settings.imageFormat;
        document.getElementById('aiMinScore').value = settings.aiMinScore;
        document.getElementById('aiMinSize').value = settings.aiMinSize;
    });
}

// 保存设置
function saveSettings() {
    const settings = {
        fileNameTemplate: document.getElementById('fileNameTemplate').value.trim() || '截图_{n}',
        startNumber: parseInt(document.getElementById('startNumber').value) || 1,
        numberPadding: parseInt(document.getElementById('numberPadding').value) || 0,
        defaultQuality: parseInt(document.getElementById('defaultQuality').value) || 2,
        imageFormat: document.getElementById('imageFormat').value || 'png',
        aiMinScore: parseFloat(document.getElementById('aiMinScore').value) || 0.3,
        aiMinSize: parseInt(document.getElementById('aiMinSize').value) || 100
    };

    chrome.storage.sync.set(settings, () => {
        showSuccessMessage();
    });
}

// 恢复默认设置
function resetSettings() {
    if (confirm('确定要恢复默认设置吗？')) {
        chrome.storage.sync.set(defaultSettings, () => {
            loadSettings();
            showSuccessMessage();
        });
    }
}

// 显示成功消息
function showSuccessMessage() {
    const message = document.getElementById('successMessage');
    message.classList.add('show');
    setTimeout(() => {
        message.classList.remove('show');
    }, 3000);
}

// 打开快捷键设置页面
function openShortcutsPage() {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

