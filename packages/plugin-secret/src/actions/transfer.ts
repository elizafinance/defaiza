import {
    ActionExample,
    composeContext,
    Content,
    elizaLogger,
    generateObject,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    type Action,
} from "@elizaos/core";

import {
    SecretNetworkClient,
    Wallet,
    stringToCoins,
    TxResultCode,
} from "secretjs";

const transferTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "recipient": "secret105w4vl4gm7q00yg5jngewt5kp7aj0xjk7zrnhw",
    "amount": "1000"
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information about the requested token transfer:
- Recipient wallet address
- Amount to transfer without token name

Respond with a JSON markdown block containing only the extracted values.`;

export interface TransferContent extends Content {
    tokenAddress: string;
    recipient: string;
    amount: string | number;
}

function isTransferContent(
    _: IAgentRuntime,
    content: any
): content is TransferContent {
    console.log("Content for transfer", content);
    return (
        typeof content.recipient === "string" &&
        (typeof content.amount === "string" ||
            typeof content.amount === "number")
    );
}

export default {
    name: "SEND_TOKEN",
    similes: [
        "TRANSFER_TOKEN",
        "TRANSFER_TOKENS",
        "SEND_TOKENS",
        "SEND_SCRT",
        "PAY",
    ],
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        console.log("Validating transfer from user:", message.userId);
        //add custom validate logic here
        /*
            const adminIds = runtime.getSetting("ADMIN_USER_IDS")?.split(",") || [];
            //console.log("Admin IDs from settings:", adminIds);

            const isAdmin = adminIds.includes(message.userId);

            if (isAdmin) {
                //console.log(`Authorized transfer from user: ${message.userId}`);
                return true;
            }
            else
            {
                //console.log(`Unauthorized transfer attempt from user: ${message.userId}`);
                return false;
            }
            */
        return true;
    },
    description:
        "MUST use this action if user requests send SCRT token or transfer SCRT token. This action MUST perform transfer.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting SEND_TOKEN handler...");

        // Initialize or update state
        if (!state) {
            state = (await runtime.composeState(message)) as State;
        } else {
            state = await runtime.updateRecentMessageState(state);
        }

        // Compose transfer context
        const transferContext = composeContext({
            state,
            template: transferTemplate,
        });

        // Generate transfer content
        const content = await generateObject({
            runtime,
            context: transferContext,
            modelClass: ModelClass.SMALL,
        });

        // Validate transfer content
        if (!isTransferContent(runtime, content)) {
            console.error("Invalid content for TRANSFER_TOKEN action.");
            if (callback) {
                callback({
                    text: "Unable to process transfer request. Invalid content provided.",
                    content: { error: "Invalid transfer content" },
                });
            }
            return false;
        }

        try {
            const wallet = new Wallet(runtime.getSetting("SECRET_MNEMONIC")!);
            const secretjs = new SecretNetworkClient({
                url: runtime.getSetting("SECRET_LCD")!,
                wallet,
                walletAddress: wallet.address,
                chainId: runtime.getSetting("SECRET_CHAIN_ID")!,
            });
            const adjustedAmount = BigInt(
                Number(content.amount) * Math.pow(10, 6)
            );
            const tx = await secretjs.tx.bank.send({
                from_address: wallet.address,
                to_address: content.recipient,
                amount: stringToCoins(`${adjustedAmount}uscrt`),
            });
            if (tx.code !== TxResultCode.Success) {
                throw tx.rawLog;
            }
            console.log("Transfer successful:");

            if (callback) {
                callback({
                    text: `Successfully transferred ${content.amount} tokens to ${content.recipient}\nTransaction: ${tx.transactionHash}`,
                    content: {
                        success: true,
                        amount: content.amount,
                        recipient: content.recipient,
                    },
                });
            }

            return true;
        } catch (error) {
            console.error("Error during token transfer:", error);
            if (callback) {
                callback({
                    text: `Error transferring tokens: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Send 69 SCRT to secret105w4vl4gm7q00yg5jngewt5kp7aj0xjk7zrnhw",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll transfer 69 SCRT to that address right away. Let me process that for you",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;
