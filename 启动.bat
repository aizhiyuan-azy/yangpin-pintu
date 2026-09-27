@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动样品拍照拼图服务...
python start_server.py
pause
