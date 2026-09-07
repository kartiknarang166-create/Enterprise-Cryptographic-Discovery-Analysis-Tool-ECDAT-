@echo off
title ECDAT API Server
cd /d "%~dp0backend"

REM ── Use the venv Python directly (no activation needed) ──────────────────────
set PYTHON="%~dp0backend\.venv\Scripts\python.exe"

REM ── Fallback to system python if venv not found ───────────────────────────────
if not exist "%~dp0backend\.venv\Scripts\python.exe" (
    echo [ECDAT] WARNING: .venv not found, using system Python
    set PYTHON=python
)

REM ── Install missing deps silently on every startup ───────────────────────────
echo [ECDAT] Checking dependencies...
%PYTHON% -m pip install -r requirements.txt --quiet 2>nul

REM ── Start FastAPI with uvicorn ────────────────────────────────────────────────
echo [ECDAT] Starting API on http://0.0.0.0:8000 ...
%PYTHON% -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

pause
