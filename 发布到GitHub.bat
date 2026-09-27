@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 1. 打开 https://github.com/new
echo 2. 仓库名填：yangpin-pintu
echo 3. 选 Public，不要勾选「Add a README」
echo 4. 点 Create repository
echo 5. 创建好后按任意键，我会推送网页...
pause
git remote remove origin 2>nul
git remote add origin https://github.com/aizhiyuan/yangpin-pintu.git
git push -u origin main
echo.
echo 推送后打开：https://github.com/aizhiyuan/yangpin-pintu/settings/pages
echo Source 选 Deploy from a branch，Branch 选 main，Folder 选 /docs，保存。
echo.
echo 苹果请用 Safari 打开：
echo https://aizhiyuan.github.io/yangpin-pintu/
echo 第一次可能要等 1 分钟。微信里请选「在 Safari 中打开」。
pause
