@echo off
setlocal
cd /d "%~dp0frontend"
where node >nul 2>&1 || (echo ERROR: Primero instala Node.js. & pause & exit /b 1)
if not exist node_modules (echo Instalando dependencias del frontend... & call npm install || (pause & exit /b 1))
echo.
echo TVM Server v0.2 - GyA Digital
 echo Abri http://127.0.0.1:5173 en Chrome
 echo Sin backend solo podras ver el login. Para mirar el dashboard usa VISTA_PREVIA.html
 echo.
call npm run dev
pause
