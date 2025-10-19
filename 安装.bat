@echo off
chcp 65001 >nul
title 智能卡片截图助手 - 一键安装

echo.
echo ╔══════════════════════════════════════════════════════════╗
echo ║  📸 智能卡片截图助手 - Chrome扩展                        ║
echo ║  一键安装向导                                            ║
echo ╚══════════════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

REM 检查是否已下载html2canvas
if exist "libs\html2canvas.min.js" (
    echo [✓] html2canvas.min.js 已存在
    goto :install_guide
) else (
    echo [!] html2canvas.min.js 未找到
    echo.
    echo 正在自动下载...
    echo.
    
    if not exist "libs" mkdir libs
    
    powershell -Command "& {Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js' -OutFile 'libs\html2canvas.min.js'}"
    
    if exist "libs\html2canvas.min.js" (
        echo [✓] 下载成功！
        goto :install_guide
    ) else (
        echo [✗] 自动下载失败
        echo.
        echo 请手动下载：
        echo 1. 访问：https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
        echo 2. 另存为到 libs\html2canvas.min.js
        echo 3. 重新运行此脚本
        echo.
        pause
        exit /b 1
    )
)

:install_guide
echo.
echo ╔══════════════════════════════════════════════════════════╗
echo ║  安装步骤                                                ║
echo ╚══════════════════════════════════════════════════════════╝
echo.
echo 步骤 1: 打开Chrome扩展页面
echo         在地址栏输入: chrome://extensions/
echo.
echo 步骤 2: 启用开发者模式
echo         在页面右上角打开"开发者模式"开关
echo.
echo 步骤 3: 加载扩展
echo         点击左上角"加载已解压的扩展程序"
echo         选择此文件夹：
echo         %CD%
echo.
echo 步骤 4: 完成安装
echo         工具栏出现扩展图标即表示安装成功
echo.
echo ╔══════════════════════════════════════════════════════════╗
echo ║  快速使用                                                ║
echo ╚══════════════════════════════════════════════════════════╝
echo.
echo 1. 访问任意网页（如知乎、微博）
echo 2. 点击工具栏的扩展图标 📸
echo 3. 选择截图模式
echo 4. 点击"开始截图"
echo 5. 图片自动下载到下载文件夹
echo.
echo ═══════════════════════════════════════════════════════════
echo.
echo 按任意键打开Chrome扩展页面...
pause >nul

start chrome://extensions/

echo.
echo 扩展页面已打开！
echo 请按照上述步骤加载扩展。
echo.
echo 如需帮助，请查看：
echo - README.md
echo - 安装使用说明.md
echo - 快速开始.txt
echo.
pause

