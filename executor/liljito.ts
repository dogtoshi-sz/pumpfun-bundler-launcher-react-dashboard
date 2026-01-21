import axios from "axios";
import { VersionedTransaction } from "@solana/web3.js";
import base58 from 'bs58';

import { LIL_JIT_ENDPOINT } from "../constants";
let bundleId: string

export const sendBundle = async (txs: VersionedTransaction[]): Promise<string | undefined> => {
    try {
        if (!LIL_JIT_ENDPOINT) {
            console.error("❌ ERROR: LIL_JIT_ENDPOINT is not configured. Please set it in your .env file.");
            return undefined;
        }
        
        const serializedTxs = txs.map(tx => base58.encode(tx.serialize()))
        const config = {
            headers: {
                "Content-Type": "application/json",
            },
        };
        const data = {
            jsonrpc: "2.0",
            id: 1,
            method: "sendBundle",
            params: [serializedTxs],
        };
        
        try {
            const response = await axios.post(
                LIL_JIT_ENDPOINT,
                data,
                config
            );
            
            bundleId = response.data.result;
            console.log("Bundle sent successfully", bundleId);
            return bundleId;
        } catch (err: any) {
            console.log("Error when sending the bundle:", err.message || err);
            if (err.response) {
                console.log("Response status:", err.response.status);
                console.log("Response data:", err.response.data);
            }
            return undefined;
        }
    } catch (error: any) {
        console.log("Error while sending bundle:", error.message || error);
        return undefined;
    }
}

export const encodeToBase64Transaction = (transaction: VersionedTransaction): string => {
    // Serialize the transaction and encode it as base64
    const serializedTx = transaction.serialize();
    const base64Tx = Buffer.from(serializedTx).toString('base64');
    return base64Tx
}

export const simulateBundle = async (vTxs: VersionedTransaction[]) => {
    const txs = vTxs.map(tx => encodeToBase64Transaction(tx))
    const config = {
        headers: {
            "Content-Type": "application/json",
        },
    };
    const data = {
        jsonrpc: "2.0",
        id: 1,
        method: "simulateBundle",
        params: [{ "encodedTransactions": txs }],
    };
    axios
        .post(
            LIL_JIT_ENDPOINT,
            data,
            config
        )
        .then(function (response) {
            // handle success
            console.log(response.data);
            console.log(response.data.result.value.transactionResults);
        })
        .catch((err) => {
            // handle error
            console.log(err);
        });
}

export const getBundleStatus = async (bundleId: string) => {
    const config = {
        headers: {
            "Content-Type": "application/json",
        },
    };
    const data = {
        jsonrpc: "2.0",
        id: 1,
        method: "getBundleStatuses",
        params: [[bundleId]],
    };
    axios
        .post(
            LIL_JIT_ENDPOINT,
            data,
            config
        )
        .then(function (response) {
            // handle success
            console.log("\n====================================================================")
            console.log(response.data);
            console.log("====================================================================\n")
        })
        .catch((err) => {
            console.log("Error confirming the bundle result");
        });
}