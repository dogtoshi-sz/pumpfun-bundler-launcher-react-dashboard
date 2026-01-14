# 📢 Marketing Widget Guide

## Overview

The Marketing Widget is a **floating control panel** that allows you to manually post tweets from the **Launch** and **Terminal** pages. Instead of auto-posting tweets when your token launches, you now have **full manual control** over when each tweet is posted.

---

## 🚀 Features

### ✅ Per-Tweet Controls
- **Custom Text** with placeholder support ([token_name], [CA], [website], etc.)
- **Delay Configuration** (seconds between tweets)
- **Image Support** (attach images to tweets)
- **Status Tracking** (pending, posting, posted, failed)
- **Individual Post Buttons** (post one tweet at a time)
- **Batch Posting** (post all pending tweets at once)

### ✅ Persistent & Portable
- **Floats on screen** - doesn't interfere with your workflow
- **Available on Launch & Terminal pages** - post tweets while managing your launch
- **Saves tweets to localStorage** - your tweets persist across page refreshes
- **Minimize/maximize** - collapse when not needed

### ✅ Live Token Data
- Automatically loads token info from `current-run.json`
- Replaces placeholders with actual token data

---

## 🎯 Setup

### 1. Configure Twitter API Credentials

Add these to your `.env` file:

```env
# Twitter API Credentials
TWITTER_API_KEY=your_api_key_here
TWITTER_API_SECRET=your_api_secret_here
TWITTER_ACCESS_TOKEN=your_access_token_here
TWITTER_ACCESS_TOKEN_SECRET=your_access_token_secret_here

# Disable auto-posting (enable manual posting via widget)
ENABLE_MARKETING=true
ENABLE_TWITTER_POSTING=true
TWITTER_AUTO_POST=false    # ⚠️ Set to false for manual posting
```

**Important:** Set `TWITTER_AUTO_POST=false` to disable automatic posting and use the Marketing Widget instead.

---

## 📝 Using the Marketing Widget

### Opening the Widget

1. Launch a token (or navigate to Terminal page)
2. Look for the **purple megaphone button** in the bottom-right corner
3. Click it to open the Marketing Widget

### Adding Tweets

1. Click the **"+ Add"** button in the widget header
2. Or click **"Add First Tweet"** if no tweets exist

### Configuring a Tweet

Each tweet has the following options:

#### **Text Area**
- Write your tweet content (280 character limit)
- Use placeholders that auto-replace with token data:
  - `[token_name]` → Your token name
  - `[token_symbol]` → Token symbol/ticker
  - `[CA]` → Contract address
  - `[website]` → Website URL
  - `[telegram]` → Telegram link
  - `[twitter]` → Twitter handle
  - `[description]` → Token description

**Example:**
```
🚀 [token_name] is LIVE!

Contract Address:
[CA]

Buy now: [website]
Join us: [telegram]

#Solana #PumpFun #[token_symbol]
```

#### **Delay (seconds)**
- How long to wait **after the previous tweet** before posting
- Set to `0` for immediate posting
- Example: Tweet 1 (delay: 0), Tweet 2 (delay: 30), Tweet 3 (delay: 60)
  - Tweet 1 posts immediately
  - Tweet 2 posts 30 seconds after Tweet 1
  - Tweet 3 posts 60 seconds after Tweet 2

#### **Image Path**
- Path to image file to attach to tweet
- Supports: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`
- Examples:
  - `./image/token.png`
  - `./image/banner.jpg`
  - `/absolute/path/to/image.png`

---

## 🎬 Posting Tweets

### Post Individual Tweet
1. Click the **"Post"** button on a specific tweet
2. The tweet status changes to "posting" (spinning icon)
3. When complete, status changes to "posted" (green checkmark)
4. Click "View Tweet →" link to see it on Twitter

### Post All Tweets (Batch)
1. Click **"Post All (#)"** button at the top
2. All pending tweets will post in sequence
3. Delays between tweets are respected automatically

### Reset All Tweets
- Click the **reset icon** (↻) to reset all tweets to "pending" status
- Useful for testing or reposting for a new token

---

## 💡 Example Tweet Sequences

### Example 1: Instant Announcement
```
Tweet 1 (delay: 0s):
🚀 [token_name] ($[token_symbol]) is LIVE!
CA: [CA]
#Solana #PumpFun

Tweet 2 (delay: 5s):
Join our community! 🌙
Website: [website]
Telegram: [telegram]

Tweet 3 (delay: 30s):
Don't miss out! 💎
[description]
```

### Example 2: Scheduled Rollout
```
Tweet 1 (delay: 0s, with image):
📸 Meet [token_name]! [image: logo.png]
The next big thing on Solana 🚀

Tweet 2 (delay: 60s):
✅ Contract Verified
✅ Liquidity Locked
✅ Community Owned
CA: [CA]

Tweet 3 (delay: 300s):
5 minutes in and already 🔥
Join the movement: [telegram]
```

### Example 3: Manual Control
- Leave delay at `0` for all tweets
- Post them manually one at a time by clicking "Post" button
- Perfect for monitoring market reaction between tweets

---

## 🔧 Advanced Tips

### Dynamic Content
- Edit tweets on the fly before posting
- Change delays based on market conditions
- Add or remove images as needed

### Multi-Token Workflow
1. Launch Token A
2. Configure tweets in Marketing Widget
3. Launch Token B (new token data loads automatically)
4. Tweets auto-update with Token B's data
5. Post tweets for Token B

### Saving Tweet Templates
- The widget auto-saves to localStorage
- Your tweet templates persist across sessions
- Delete old tweets and add new ones as needed

### Terminal Page Usage
- The widget follows you to the Terminal page
- Post tweets while monitoring holder wallets
- React to market conditions in real-time

---

## 🛠️ Troubleshooting

### Widget Doesn't Appear
- Check you're on the **Launch** or **Terminal** page
- Look for the purple megaphone button in bottom-right corner
- Refresh the page if needed

### "Twitter API credentials not configured"
- Verify your `.env` file has all Twitter credentials
- Restart the API server (`npm start` in `api-server` folder)

### Tweet Fails to Post
- Check tweet length (280 character max)
- Verify image path exists
- Check Twitter API rate limits
- View console for detailed error

### Placeholders Not Replaced
- Make sure token has launched (check `current-run.json` exists)
- Verify token data loaded (shows token symbol in widget header)
- Refresh the widget or page

### Image Not Attaching
- Check file path is correct
- Verify image exists in specified location
- Supported formats: jpg, jpeg, png, gif, webp
- Image must be accessible from project root

---

## 🎨 Widget Controls

### Header Buttons
- **↓ Minimize** - Collapse widget (keeps it open but compact)
- **↑ Maximize** - Expand widget back to full view
- **× Close** - Close widget completely (click megaphone to reopen)

### Action Buttons
- **Post All (#)** - Post all pending tweets in sequence
- **↻ Reset** - Reset all tweets to pending status
- **+ Add** - Add a new tweet

### Tweet Buttons
- **Post** - Post this specific tweet
- **🗑️ Delete** - Remove this tweet from the list

---

## 📊 Tweet Status Icons

- **🕐 Clock** (gray) - Pending
- **🔄 Spinning** (blue) - Posting
- **✅ Checkmark** (green) - Posted successfully
- **❌ X** (red) - Failed to post

---

## 🔒 Security Notes

- Twitter API credentials are stored in `.env` file (never committed to git)
- Tweets are stored in browser localStorage (local only)
- Images are loaded server-side (secure)
- All API calls go through your secure backend

---

## 🎯 Best Practices

1. **Pre-write your tweets** before launch
2. **Test placeholders** with a test token first
3. **Prepare images** in the `/image` folder beforehand
4. **Monitor engagement** between tweets
5. **Adjust delays** based on market reaction
6. **Keep widget open** on Terminal page for quick access

---

## 🆘 Need Help?

- Check the widget's help text (bottom of widget)
- View browser console for detailed errors
- Check API server logs for backend issues
- Verify `.env` configuration

---

Enjoy your new manual tweet control! 🚀📢
