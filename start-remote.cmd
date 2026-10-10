@echo off
chcp 65001 >nul
title 月下议会 - 平板远程展示
cd /d "%~dp0"
if not exist "%ProgramFiles%\nodejs\node.exe" (
 echo 未找到 Node.js，请先安装。
 pause
 exit /b 1
)
"%ProgramFiles%\nodejs\node.exe" --import tsx scripts/remote-start.ts
echo 远程入口已结束。如果出现网络错误，请保留错误信息。
pause
