@echo off
chcp 65001 >nul
title 月下议会 - 本地服务
cd /d "%~dp0"
if errorlevel 1 (
 echo 找不到项目目录
 pause
 exit /b 1
)
if not exist "%ProgramFiles%\nodejs\node.exe" (
 echo 未找到 Node.js，请检查是否已安装。
 pause
 exit /b 1
)
echo 正在启动月下议会。
echo 启动成功后，请在浏览器打开 http://localhost:3000/
echo 请保持本窗口打开。停止服务请按 Ctrl+C。
echo 如果提示 EADDRINUSE，说明3000端口已被占用，请勿重复启动。
"%ProgramFiles%\nodejs\node.exe" --import tsx server/index.ts
echo 服务已停止；如果启动失败，请查看上面的错误信息。
pause
