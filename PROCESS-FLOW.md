# Process Flow Documentation

## 🎯 Complete Token Launch Process

### Step-by-Step Flow:

#### 1. **Token Creation** (`index.ts` → `createTokenTx`)
- Generates mint keypair (or vanity address if enabled)
- Uploads metadata to IPFS (via Fleek SDK)
- Creates token creation instructions
- Adds Jito tip account
- Saves mint keypair to `keys/mint.json`

#### 2. **SOL Distribution** (`distributeSol`)
- Generates N wallets (based on `DISTRIBUTION_WALLETNUM`)
- Calculates SOL amount per wallet (swap amount + 0.01 for fees)
- Creates transfer instructions for all wallets
- **Saves all wallets to `keys/data.json` BEFORE sending SOL**
- Sends distribution transaction
- Returns array of keypairs

#### 3. **Lookup Table Creation** (`createLUT`)
- Creates Address Lookup Table (LUT) for transaction optimization
- Saves LUT address to `keys/lut.json`
- Waits 15 seconds for LUT to be ready

#### 4. **LUT Extension** (`addAddressesToTableMultiExtend`)
- Adds wallet addresses to LUT
- Adds wallet ATAs (Associated Token Accounts)
- Adds global volume accumulators
- Adds static addresses (programs, system accounts, etc.)

#### 5. **Buy Instructions Creation** (`makeBuyIx`)
- Creates buy instructions for each wallet
- Each wallet buys tokens using Pump.fun SDK
- Instructions are prepared for bundling

#### 6. **Transaction Bundling**
- Groups buy instructions (4 wallets per transaction)
- Creates VersionedTransaction (V0) for each group
- Signs each transaction with corresponding wallet
- Adds token creation transaction to bundle
- All transactions are bundled together

#### 7. **Bundle Execution**
- **Jito Mode** (default): Sends bundle to Jito block engines
- **Lil Jito Mode**: Sends bundle via QuickNode RPC
- Waits for confirmation

## 💰 Gather/Sell Process

### Option 1: Gather All (`gather.ts`)
1. Reads all wallets from `keys/data.json`
2. For each wallet:
   - Gets all token accounts
   - Sells each token via Jupiter swap
   - Transfers remaining tokens to main wallet
   - Closes token accounts
   - Transfers remaining SOL to main wallet

### Option 2: Gather SOL Only (`manual-gather.js`)
1. Reads all wallets from `keys/data.json`
2. Checks balance of each wallet
3. Transfers SOL to main wallet (leaves small amount for fees)

## 📊 Data Flow

```
.env file
  ↓
Constants (constants.ts)
  ↓
Main Process (index.ts)
  ↓
├── Token Creation → mint.json
├── Wallet Generation → data.json
├── LUT Creation → lut.json
└── Bundle Execution → Blockchain
```

## 🔄 Wallet Lifecycle

1. **Generation**: Created during `distributeSol`
2. **Storage**: Saved to `keys/data.json` immediately
3. **Funding**: Receive SOL from main wallet
4. **Usage**: Buy tokens via bundle
5. **Recovery**: SOL/tokens gathered back to main wallet

## ⚠️ Important Points

- **Wallets are saved BEFORE SOL is sent** - No risk of losing wallets
- **All wallets accumulate** in `keys/data.json` - Previous wallets are preserved
- **Gather process** sells tokens AND collects SOL
- **Manual gather** only collects SOL (no token selling)

## 🎛️ Configuration Options

- **DISTRIBUTION_WALLETNUM**: Number of wallets to create
- **SWAP_AMOUNT**: Default amount per wallet
- **SWAP_AMOUNTS**: Custom amounts (comma-separated)
- **VANITY_MODE**: Generate address ending with "pump"
- **LIL_JIT_MODE**: Use QuickNode bundle method vs Jito

## 📁 File Structure

```
keys/
├── data.json      # All wallet private keys (base58)
├── mint.json      # Mint keypair private key
└── lut.json       # Lookup Table address

image/
└── *.jpg/png      # Token images
```

