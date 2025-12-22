# Pump.fun Token Address Explained

## Where Does the Pump.fun Address Come From?

The **pump.fun token address** is the **mint address** of your token. Here's how it's generated:

### 1. **Mint Keypair Generation** (`index.ts` line 21-28)

```typescript
let mintKp = Keypair.generate()
```

- A new Solana keypair is generated
- The **public key** of this keypair becomes your token's mint address
- This is the address that will appear on pump.fun

### 2. **Vanity Mode** (Optional)

If `VANITY_MODE="true"` in your `.env`:

```typescript
if (VANITY_MODE) {
  const { keypair, pubkey } = generateVanityAddress("pump")
  mintKp = keypair
}
```

- The system generates keypairs until it finds one where the **public key ends with "pump"**
- Example: `...ABC123pump`
- This can take time (thousands of attempts) but makes the address more memorable

### 3. **Mint Address = Token Address**

```typescript
const mintAddress = mintKp.publicKey
console.log("mintAddress", mintAddress.toBase58());
```

- The mint address is saved to `keys/mint.json` (as the private key)
- This address is what you'll see on pump.fun
- Format: `https://pump.fun/[MINT_ADDRESS]`

### 4. **Token Creation**

The mint address is used when creating the token:
- It's passed to the Pump.fun SDK
- It becomes the unique identifier for your token
- All transactions reference this address

## Example Flow

1. **Generate Keypair**: `Keypair.generate()` → Creates random keypair
2. **Get Public Key**: `mintKp.publicKey.toBase58()` → e.g., `"ABC123...XYZ789"`
3. **Save Private Key**: Saved to `keys/mint.json` for later use
4. **Create Token**: Token is created with this mint address
5. **Pump.fun URL**: `https://pump.fun/ABC123...XYZ789`

## Important Notes

- **The mint address is generated BEFORE the token is created**
- **It's saved to `keys/mint.json` immediately** (so you never lose it)
- **Vanity mode** makes the address end with "pump" but takes longer
- **The address is unique** - no two tokens can have the same mint address
- **You need the private key** (in mint.json) to control the token

## Finding Your Token Address

After launching:
1. Check `keys/mint.json` - contains the private key
2. Decode it to get the public key (mint address)
3. Visit: `https://pump.fun/[YOUR_MINT_ADDRESS]`

Or check the console output - it will print the mint address when the token is created!

