# 🚀 Launch Orchestrator - Full Automation Pipeline

> **Vision:** One command to go from idea → live token with website, socials, and automated trading.

---

## 📋 Pipeline Overview

```
"Make a wagering website for stakey"
         ↓
   [AI GENERATION]     → Name, description, tagline, color scheme
         ↓
   [BRANDING]          → Token logo, website logo, Twitter banner
         ↓
   [DOMAIN]            → Search, buy, connect, wait for DNS
         ↓
   [SOCIALS]           → Twitter account, Telegram group/channel
         ↓
   [DATABASE]          → Update site_config, trigger redeploy
         ↓
   [TOKEN LAUNCH]      → Create on pump.fun, bundle buy
         ↓
   [POST-LAUNCH]       → Auto-tweet, Telegram post, volume, profit-take
```

---

## Phase 1: INITIATION

| Step | Status | Description | Notes |
|------|--------|-------------|-------|
| User command | ✅ | Natural language input | "Make a wagering website for stakey" |
| Parse intent | ⏳ | Extract theme, style, vibe | Regex or AI parsing |

**Input Examples:**
- "Create a dog meme coin website"
- "Make an AI trading bot token"  
- "Launch a casino/wagering themed token"

---

## Phase 2: AI CONTENT GENERATION

| Step | Status | Owner | Description |
|------|--------|-------|-------------|
| Generate token name | ✅ | OpenAI GPT-4o-mini | Based on theme → "Stakey Wagering" |
| Generate ticker | ✅ | OpenAI GPT-4o-mini | 3-5 chars → $STAKE |
| Generate description | ✅ | OpenAI GPT-4o-mini | 1-2 sentences for pump.fun |
| Generate tagline | ✅ | OpenAI GPT-4o-mini | Short catchy phrase |
| Pick color scheme | ✅ | AI + Templates | Match vibe (wagering → gold) |
| Generate about page | ✅ | OpenAI GPT-4o-mini | Longer description for website |
| Frontend UI | ✅ | AIContentGenerator.jsx | Integrated into TokenLaunch |

**API Options:**
- ✅ OpenAI GPT-4o-mini (paid, ~$0.01/generation) - **IMPLEMENTED**
- ✅ Template fallback (free, theme-based) - **IMPLEMENTED**
- ⏳ Claude API (future option)

**Implementation:**
```javascript
// launch-orchestrator/services/ai-generator.js - COMPLETE
const { aiGenerator } = require('./services/ai-generator');

// Generate from prompt
const result = await aiGenerator.generateContent("wagering platform for crypto");
// Returns: { name, ticker, description, tagline, colorScheme, aboutPage }

// Generate 3 variations
const variations = await aiGenerator.generateVariations("dog meme coin", 3);
```

**Frontend Integration:**
- Located: `frontend/src/components/AIContentGenerator.jsx`
- Collapsible panel in TokenLaunch page
- Color scheme picker with 9 themes
- Prompt suggestions (dog meme, AI, wagering, etc.)
- "Apply All" button to fill token settings
- Works with or without OpenAI key (template fallback)

---

## Phase 3: BRANDING

| Step | Status | Owner | Description |
|------|--------|-------|-------------|
| Match icon | ✅ | branding-generator.js | 117 icons, keyword matching |
| Token logo (500×500) | ✅ | branding-generator.js | Rounded, gradient, glow |
| Website logo | ✅ | branding-generator.js | Icon + split-color text |
| Twitter banner (1500×500) | ✅ | branding-generator.js | Stylized with tagline |
| Upload to Blob | ✅ | upload-logos.js | Vercel Blob storage |

**Commands:**
```bash
node generate-branding.js "Stakey Wagering" "STAKE" --color=gold --tagline="Stake to Win"
node upload-logos.js stakeywagering.xyz
```

**Future Enhancements:**
- [ ] AI-generated custom icons (Midjourney/DALL-E)
- [ ] Multiple logo variations to choose from
- [ ] Animated logos (GIF/WebP)
- [ ] Favicon generation

---

## Phase 4: DOMAIN

| Step | Status | Owner | Description |
|------|--------|-------|-------------|
| Search domains | ✅ | domain-finder.js | Check .xyz, .fun, .io, etc. |
| Compare prices | ✅ | domain-finder.js | Find cheapest option |
| Purchase domain | ✅ | domain-buyer.js | Vercel Registrar API |
| Add to project | ✅ | dns-manager.js | Connect to Vercel deployment |
| Wait for DNS | ✅ | dns-manager.js | Poll until propagated |

**Commands:**
```bash
node cli.js domain:search "stakeywagering"
node cli.js domain:buy "stakeywagering.xyz"
```

**Pricing (Vercel):**
- .xyz → $1.99/year
- .fun → $1.99/year
- .io → $39.99/year
- .com → $12.99/year

---

## Phase 5: SOCIALS

### Twitter/X

| Step | Status | Owner | Description |
|------|--------|-------|-------------|
| Create account | ⏳ | Manual/API | @stakeywagering |
| Set profile name | ⏳ | Twitter API | "Stakey Wagering" |
| Set bio | ⏳ | Twitter API | Description + links |
| Set profile picture | ⏳ | Twitter API | Token logo |
| Set banner | ⏳ | Twitter API | Twitter banner |
| Pin launch tweet | ⏳ | Twitter API | Contract address |

**Challenges:**
- Twitter API is expensive ($100/mo for basic)
- Account creation is manual (captcha, phone verify)
- Alternative: Pre-made account pool

### Telegram

| Step | Status | Owner | Description |
|------|--------|-------|-------------|
| Create group | ⏳ | Telegram API | "Stakey Wagering Official" |
| Create channel | ⏳ | Telegram API | Announcements |
| Set group photo | ⏳ | Telegram API | Token logo |
| Add Safeguard bot | ⏳ | Bot API | Anti-spam |
| Set welcome message | ⏳ | Bot API | With CA, links |
| Create invite link | ⏳ | Telegram API | t.me/stakeywagering |

**Existing in Bundler:**
- `ENABLE_TELEGRAM_CREATION=true`
- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`
- `TELEGRAM_USE_SAFEGUARD_BOT=true`

---

## Phase 6: DATABASE

| Step | Status | Owner | Description |
|------|--------|-------|-------------|
| Connect to PostgreSQL | ✅ | pg client | Railway database |
| Update site_config | ✅ | site-updater.js | All token info |
| Trigger Vercel redeploy | ✅ | Vercel API | Pick up new data |

**Table: site_config**
```sql
site_url           -- stakeywagering.xyz
token_name         -- Stakey Wagering
token_symbol       -- STAKE
token_address      -- (set after launch)
contract_address   -- (set after launch)
twitter            -- https://x.com/stakeywagering
telegram           -- https://t.me/stakeywagering
logo_url           -- Vercel Blob URL
token_image_url    -- Vercel Blob URL
color_scheme       -- gold
theme_name         -- gold
```

---

## Phase 7: TOKEN LAUNCH

| Step | Status | Owner | Description |
|------|--------|-------|-------------|
| Load pump address | ✅ | Bundler | Pre-generated vanity |
| Fund dev wallet | ✅ | Bundler | From funding wallet |
| Fund bundle wallets | ✅ | Bundler | 2-10 wallets |
| Create token | ✅ | Bundler | pump.fun with metadata |
| Bundle buy | ✅ | Bundler | Coordinated purchases |
| Update database | ✅ | website-update.ts | Add contract address |

**Existing Commands:**
```bash
npm start              # Full launch flow
npm run menu           # Interactive menu
```

---

## Phase 8: POST-LAUNCH

| Step | Status | Owner | Description |
|------|--------|-------|-------------|
| Auto-tweet launch | ⏳ | Twitter API | "🚀 $STAKE launched!" |
| Post to Telegram | ⏳ | Telegram API | CA announcement |
| Start volume maker | ✅ | volume-maker.ts | Organic trades |
| Monitor market cap | ✅ | Terminal | Live tracking |
| Track external volume | ✅ | Terminal | Non-wallet trades |
| Auto profit-take | ⏳ | profit-taker.js | Based on rules |
| Auto-gather | ⏳ | gather.ts | After inactivity |

### Profit Taker Rules (Planned)

```javascript
// Trigger conditions (any):
- External volume > 10 SOL net positive
- Market cap > $50k
- 10 minutes of inactivity
- Manual trigger

// Actions:
- Sell X% of holdings
- Gather remaining to funding wallet
- Post "thank you" tweet
```

---

## 🎯 The Dream Command

```bash
node launch.js "wagering website for stakey" \
  --budget=50 \
  --domain-max=5 \
  --auto-socials \
  --auto-launch \
  --profit-target=50sol
```

**Would automatically:**
1. ✅ AI generates all content (name, description, etc.)
2. ✅ Creates branding (3 images)
3. ✅ Buys best domain under $5
4. ✅ Creates Twitter + Telegram
5. ✅ Updates website database
6. ✅ Launches token on pump.fun
7. ✅ Posts announcements
8. ✅ Monitors and profit-takes at 50 SOL

---

## 📊 Implementation Priority

### ✅ COMPLETED
1. **AI Content Generation** - OpenAI + template fallback ✅
2. **Branding Generator** - Logos, banners, icons ✅
3. **Domain Automation** - Search, buy, connect ✅
4. **Database Integration** - site_config updates ✅

### HIGH PRIORITY (Next to Build)
1. **One-Command Pipeline** - Combine all steps into single flow
2. **Profit Taker** - Auto-sell based on external volume
3. **Telegram Automation** - Group/channel creation

### MEDIUM PRIORITY
4. **Twitter Profile Update** - Set bio, pics (account creation manual)
5. **Launch Notifications** - Real-time progress in terminal

### LOW PRIORITY (Nice to Have)
6. **AI Custom Icons** - Midjourney/DALL-E integration
7. **Multiple Domain Comparison** - Best price finder
8. **Telegram Bot Interface** - Control launches via Telegram

---

## 📁 File Structure

```
launch-orchestrator/
├── index.js                    # Main orchestrator class
├── cli.js                      # Command-line interface
├── config.js                   # Environment config loader
├── PIPELINE_ROADMAP.md         # This document
│
├── services/
│   ├── ai-generator.js         # AI content generation
│   ├── branding-generator.js   # Logo/banner creation ✅
│   ├── domain-finder.js        # Domain search ✅
│   ├── domain-buyer.js         # Domain purchase ✅
│   ├── dns-manager.js          # DNS management ✅
│   ├── site-updater.js         # Database updates ✅
│   ├── social-creator.js       # Twitter/Telegram (planned)
│   └── profit-taker.js         # Auto profit-taking (planned)
│
├── utils/
│   ├── logger.js               # Colored console logging
│   └── helpers.js              # Utility functions
│
├── assets/
│   ├── icons/                  # 117 SVG icons ✅
│   ├── fonts/                  # Custom fonts
│   └── generated/              # Output images ✅
│
└── scripts/
    ├── generate-branding.js    # CLI for branding ✅
    ├── upload-logos.js         # Upload to Blob ✅
    ├── check-entry.js          # Verify database ✅
    └── update-entry.js         # Manual updates ✅
```

---

## 🔑 Required API Keys

| Service | Variable | Status | Cost |
|---------|----------|--------|------|
| Vercel API | `VERCEL_TOKEN` | ✅ Set | Free |
| Vercel Blob | `VERCEL_BLOB_TOKEN` | ✅ Set | Free tier |
| PostgreSQL | `DATABASE_URL` | ✅ Set | Railway free tier |
| OpenAI | `OPENAI_API_KEY` | ⏳ Needed | ~$0.01/request |
| Twitter | `TWITTER_*` | ✅ Set | $100/mo for API |
| Telegram | `TELEGRAM_*` | ✅ Set | Free |

---

## 📝 Notes

- **Security:** Never expose private keys via API. All wallet operations are localhost-only.
- **Rate Limits:** Vercel API has 20 req/min limit. Domain searches need batching.
- **Costs:** Each launch costs ~$2-5 (domain) + ~$0.50 (SOL fees) + trading capital

---

*Last updated: January 10, 2026*
*After the great wallet drain of January 2026, we rebuild stronger.* 💪
