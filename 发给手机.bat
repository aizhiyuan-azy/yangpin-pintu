@echo off
chcp 65001 >nul
cd /d "%~dp0"
python pack_offline.py
echo.
echo 请把「样品拍照拼图.html」发到安卓手机，
echo 用百度浏览器打开（夸克、UC 也可以）。不要用 Chrome，不要用微信。
pause
