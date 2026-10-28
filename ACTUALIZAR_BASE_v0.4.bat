@echo off
setlocal
cd /d "%~dp0backend"
if not exist ".env" (
 echo ERROR: Falta backend\.env. No continuar.
 pause
 exit /b 1
)
echo Migrando la base de datos EXISTENTE sin borrar usuarios ni videos...
call npm run db:migrate
if errorlevel 1 (
 echo ERROR: La migracion NO se completo. No reinicies el backend.
 pause
 exit /b 1
)
echo.
echo OK: TVM Server v0.4 - estructura de dispositivos actualizada.
pause
