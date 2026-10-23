@echo off
REM Use the same checked update/restart path for both repositories.
call "%~dp0update-all.bat"
exit /b %ERRORLEVEL%
