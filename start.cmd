@echo off
REM JARVIS Deck one-command launcher (Windows)
REM Starts the FastAPI backend on 127.0.0.1:8785 and the web deck on http://localhost:4527
cd /d "%~dp0"

if not exist node_modules (
  echo Installing frontend dependencies...
  call npm install || goto :err
)

if not exist .venv (
  echo Creating python virtualenv...
  python -m venv .venv || goto :err
)
.venv\Scripts\python -m pip install -q -r requirements.txt || goto :err

echo Starting backend on http://127.0.0.1:8785 ...
start "JARVIS deck backend" cmd /k ".venv\Scripts\python -m uvicorn standalone:app --app-dir dashboard --host 127.0.0.1 --port 8785"

echo Building + serving the deck on http://localhost:4527 ...
call npm run build || goto :err
npx vite preview --port 4527 --strictPort
goto :eof

:err
echo.
echo Setup failed — see the error above.
pause
