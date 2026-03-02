import { ComputeBudgetProgram, Connection, Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js"
import { BUYER_AMOUNT, BUYER_WALLET, PRIVATE_KEY, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, SWAP_AMOUNT, VANITY_MODE } from "../constants"
import { createTokenTx } from "../src/main"

import base58 from "bs58"
import { generateVanityAddress } from "../utils"
import { executeJitoTx } from "../executor/jito"

const commitment = "confirmed"

let mintKp = Keypair.generate()
if (VANITY_MODE) {
  const { keypair, pubkey } = generateVanityAddress("pump")
  mintKp = keypair
  console.log(`Keypair generated with "pump" ending: ${pubkey}`);
}

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment
})
const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))

const smallNumWalletBundle = async () => {
  try {
    const buyerKp = Keypair.fromSecretKey(base58.decode(BUYER_WALLET))
    // V2: create + dev buy combined in one transaction
    const tokenCreationIxs = await createTokenTx(mainKp, mintKp, mainKp, BUYER_AMOUNT)
    const latestBlockhash = await connection.getLatestBlockhash()

    const tokenCreationTx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: mainKp.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: tokenCreationIxs
      }).compileToV0Message()
    )
    tokenCreationTx.sign([mainKp, mintKp])

    await executeJitoTx([tokenCreationTx], mainKp, commitment)
  } catch (error) {
    console.log("Error in bundle process:", error)
  }
}

smallNumWalletBundle()
