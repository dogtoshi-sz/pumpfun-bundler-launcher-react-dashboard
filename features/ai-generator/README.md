# 🚀 Launch Orchestrator

Fully automated token launch pipeline:
1. **AI** generates token name, ticker, description
2. **Domain Finder** searches for cheapest available domain
3. **Auto-Purchase** buys domain via Vercel API
4. **Auto-Connect** links domain to your dynamic website
5. **Update Config** writes token info to database
6. **Launch Token** triggers pumpfun bundler

## Setup

### 1. Environment Variables

Add to your `.env`:

```env
# Vercel (required for domain automation)
VERCEL_TOKEN=your_vercel_api_token
VERCEL_TEAM_ID=team_xxxxx
VERCEL_PROJECT_ID=prj_xxxxx

# Domain Registration Contact Info
DOMAIN_CONTACT_FIRST_NAME=Your
DOMAIN_CONTACT_LAST_NAME=Name
DOMAIN_CONTACT_EMAIL=you@email.com
DOMAIN_CONTACT_PHONE=+1234567890
DOMAIN_CONTACT_ADDRESS=123 Main St
DOMAIN_CONTACT_CITY=New York
DOMAIN_CONTACT_STATE=NY
DOMAIN_CONTACT_ZIP=10001
DOMAIN_CONTACT_COUNTRY=US

# OpenAI (optional, for AI-generated content)
OPENAI_API_KEY=sk-xxxxx

# Database (for dynamic website)
DATABASE_URL=postgresql://user:pass@host:5432/db
```

### 2. Get Vercel Token

1. Go to https://vercel.com/account/tokens
2. Create new token with these scopes:
   - `domains:read`
   - `domains:write`
   - `projects:read`
   - `projects:write`

### 3. Install Dependencies

```bash
cd launch-orchestrator
npm install
```

## Usage

### CLI

```bash
# Full automated launch
node cli.js launch "Doge Killer" --ticker DOGEK

# Just find domains (no purchase)
node cli.js find-domains "Doge Killer"

# Just purchase a specific domain
node cli.js buy-domain dogekiller.xyz

# Check domain status
node cli.js status dogekiller.xyz
```

### Programmatic

```js
const { LaunchOrchestrator } = require('./index');

const orchestrator = new LaunchOrchestrator();

const result = await orchestrator.launch({
  tokenName: 'Doge Killer',
  ticker: 'DOGEK',
  description: 'The ultimate doge killer token',
  // Optional: specify domain preferences
  preferredTLDs: ['.xyz', '.fun', '.io'],
  maxDomainPrice: 20, // USD
});

console.log(result);
// {
//   domain: 'dogekiller.xyz',
//   website: 'https://dogekiller.xyz',
//   contractAddress: '...',
//   launchTime: '2026-01-10T...'
// }
```

## Architecture

```
launch-orchestrator/
├── index.js              # Main orchestrator class
├── cli.js                # Command-line interface
├── config.js             # Configuration loader
├── services/
│   ├── domain-finder.js  # Search & compare domains
│   ├── domain-buyer.js   # Purchase via Vercel API
│   ├── dns-manager.js    # Connect & verify DNS
│   ├── site-updater.js   # Update dynamic website DB
│   └── ai-generator.js   # Generate token content
├── utils/
│   ├── logger.js         # Colored console logging
│   └── helpers.js        # Utility functions
└── README.md
```

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      LAUNCH ORCHESTRATOR                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Input: { tokenName: "Doge Killer", ticker: "DOGEK" }           │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────┐                │
│  │ 1. AI Generator                              │                │
│  │    - Generate description                    │                │
│  │    - Suggest domain names                    │                │
│  │    - Create taglines                         │                │
│  └─────────────────────────────────────────────┘                │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────┐                │
│  │ 2. Domain Finder                             │                │
│  │    - Check availability (Vercel API)         │                │
│  │    - Get prices for each TLD                 │                │
│  │    - Sort by price                           │                │
│  └─────────────────────────────────────────────┘                │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────┐                │
│  │ 3. Domain Buyer                              │                │
│  │    - Purchase cheapest available             │                │
│  │    - Add to Vercel project                   │                │
│  └─────────────────────────────────────────────┘                │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────┐                │
│  │ 4. DNS Manager                               │                │
│  │    - Wait for DNS propagation                │                │
│  │    - Verify HTTPS is working                 │                │
│  └─────────────────────────────────────────────┘                │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────┐                │
│  │ 5. Site Updater                              │                │
│  │    - Update PostgreSQL with token info       │                │
│  │    - Set domain → config mapping             │                │
│  └─────────────────────────────────────────────┘                │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────┐                │
│  │ 6. Token Launcher                            │                │
│  │    - Trigger pumpfun bundler                 │                │
│  │    - Return contract address                 │                │
│  └─────────────────────────────────────────────┘                │
│                           │                                      │
│                           ▼                                      │
│  Output: { domain, website, contractAddress, ... }              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```
