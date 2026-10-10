@echo off
rem Double-click to check that a saved keystore password opens the release key, before a build or
rem before deleting the working copy of the key. Java's keytool asks for the password itself.
rem 2026-10-10: the saved password was the 7z archive's, not the keystore's, and only this told them apart.
set /p folder=Folder holding kapevault-release.jks:
set keytool=keytool
if exist "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" set keytool="C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe"
echo Type the KEYSTORE password when asked. Nothing is saved.
%keytool% -list -keystore "%folder:"=%\kapevault-release.jks" -alias kapevault
echo.
echo Right password: the entry is listed with NO "WARNING WARNING WARNING" box above it.
echo Wrong password: "keystore password was incorrect".
echo The warning box means nothing was checked (an empty password skips the check).
echo.
pause
