@echo off
echo ======================================
echo   FairAI - Windows Setup
echo   Google Solution Challenge 2026
echo ======================================
echo.

echo [1/4] Setting up Python backend...
cd backend

REM FairAI pins numpy 1.26.4, which has no wheels for Python 3.13+.
REM Use the py launcher to select 3.12 explicitly.
set PY_CMD=
py -3.12 --version >nul 2>&1 && set PY_CMD=py -3.12
if not defined PY_CMD (
  echo ERROR: Python 3.12 not found.
  echo FairAI requires Python 3.12.x ^(numpy 1.26.4 has no 3.13+ wheels^).
  echo Install it from https://www.python.org/downloads/release/python-3129/
  pause
  exit /b 1
)

%PY_CMD% -m venv venv
call venv\Scripts\activate
pip install -r requirements.txt -q
echo [1/4] Backend ready!

cd ..\frontend
echo [2/4] Installing React dependencies...
call npm install
echo [2/4] Frontend ready!

echo.
echo ======================================
echo   Setup complete! Now open TWO terminals:
echo.
echo   Terminal 1 (backend):
echo   cd backend
echo   venv\Scripts\activate
echo   set GEMINI_API_KEY=your_key_here
echo   python app.py
echo.
echo   Terminal 2 (frontend):
echo   cd frontend
echo   npm start
echo.
echo   Get free Gemini key: https://aistudio.google.com
echo ======================================
pause
