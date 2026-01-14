@echo off
echo Starting ngrok for QuickNode webhook...
echo.
echo Your webhook URL will be: https://XXXX.ngrok.io/api/quicknode-webhook
echo (Replace XXXX with your actual ngrok URL)
echo.
echo Keep this window open!
echo.
ngrok http 3001
