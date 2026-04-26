@echo off
cd /d "%~dp0"

echo ========================================
echo SKY ZhiYi Backend - DeepSeek + Job Search
echo ========================================
echo.

echo [1/3] Installing Python packages...
py -m pip install --upgrade pip
py -m pip install -r requirements.txt

echo.
echo [2/3] Please check backend\.env
echo Make sure DEEPSEEK_API_KEY is your real DeepSeek key.
echo.

echo [3/3] Starting server...
echo After it starts, open:
echo http://127.0.0.1:5000
echo.
py server.py

pause
