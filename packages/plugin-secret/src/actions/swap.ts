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
    msgSwap,
    Path,
    queryFactoryPairs,
    BatchPairsInfo,
    getRoutes,
    batchQuerySnip20TokensInfo,
    batchQueryPairsInfo,
} from "@shadeprotocol/shadejs";

import {
    SecretNetworkClient,
    Wallet,
    stringToCoins,
    TxResultCode,
} from "secretjs";

import { BigNumber } from "bignumber.js";

import {
    factoryContractAddress,
    routerContractAddress,
    batchRouterContractAddress,
    HARDCODED_TOKENS,
    HARDCODED_PAIRS,
} from "./swap_data";

const swapTemplate = `Respond with a JSON markdown block containing only the extracted values.

These are known addresses you will get asked to swap, use these addresses for sellTokenAddress and buyTokenAddress:
- sJUNO/sjuno/SJUNO/juno: secret1z6e4skg5g9w65u5sqznrmagu05xq8u6zjcdg4a
- sIST/sist/SIST/ist: secret1xmqsk8tnge0atzy4e079h0l2wrgz6splcq0a24
- saUSDT/sausdt/SAUSDT/ausdt/usdt: secret1wk5j2cntwg2fgklf0uta3tlkvt87alfj7kepuw
- saUSDC/sausdc/SAUSDC/ausdc/usdc: secret1vkq022x4q8t8kx9de3r84u669l65xnwf2lg3e6
- sBLD/sbld/SBLD/bld: secret1uxvpq889uxjcpj656yjjexsqa3zqm6ntkyjsjq
- sJKL/sjkl/SJKL/jkl: secret1sgaz455pmtgld6dequqayrdseq8vy2fc48n8y3
- sstLUNA/sstluna/SSTLUNA/stluna: secret1rkgvpck36v2splc203sswdr0fxhyjcng7099a9
- SIENNA/sienna: secret1rgm2m5t530tdzyd99775n6vzumxa5luxcllml4
- stkd-SCRT/stkd-scrt/STKD-SCRT: secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4
- SSCRT/sscrt/SSCRT/scrt: secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek
- sstOSMO/sstosmo/SSTOSMO/stosmo: secret1jrp6z8v679yaq65rndsr970mhaxzgfkymvc58g
- saWBTC/sawbtc/SAWBTC/awbtc/wbtc/btc: secret1guyayjwg5f84daaxl7w84skd8naxvq8vz9upqx
- SILK/silk/SILK: secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd
- sstINJ/sstinj/SSTINJ/stinj: secret1eurddal3m0tphtapad9awgzcuxwz8ptrdx7h4n
- sUSK/susk/SUSK/usk: secret1cj2fvj4ap79fl9euz8kqn0k5xlvck0pw9z9xhr
- sATOM/satom/SATOM/atom: secret19e75l25r6sa6nhdf4lggjmgpw0vmpfvsw5cnpe
- sstkATOM/sstkatom/SSTKATOM/stkatom: secret16vjfe24un4z7d3sp9vd0cmmfmz397nh2njpw3e
- sstATOM/sstatom/SSTATOM/statom: secret155w9uxruypsltvqfygh5urghd5v0zc6f9g69sq
- SHD/shd: secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm
- sOSMO/sosmo/SOSMO/osmo: secret150jec8mc2hzyyqak4umv6cfevelr0x9p0mjxgg
- sCMST/scmst/SCMST/cmst: secret14l7s0evqw7grxjlesn8yyuk5lexuvkwgpfdxr5
- sLUNA/sluna/SLUNA/luna: secret149e7c5j7w24pljg6em6zj2p557fuyhg8cnk7z8
- sINJ/sinj/SINJ/inj: secret14706vxakdzkz9a36872cs62vpl5qd84kpwvpew
- saWETH/saweth/SAWETH/aweth/weth: secret139qfh3nmuzfgwsx2npnmnjl4hrvj3xq5rmq8a0
- ALTER/alter: secret12rcvz0umvk875kd6a803txhtlu7y0pnd73kcej
- sqATOM/sqatom/SQATOM/qatom: secret120cyurq25uvhkc7qjx7t28deuqslprxkc4rrzc
- sstJUNO/sstjuno/SSTJUNO/stjuno: secret1097nagcaavlkchl87xkqptww2qkwuvhdnsqs2v

Example response:
\`\`\`json
{
    "sellTokenAddress": "secret1097nagcaavlkchl87xkqptww2qkwuvhdnsqs2v",
    "buyTokenAddress": "secret120cyurq25uvhkc7qjx7t28deuqslprxkc4rrzc",
    "sellAmount": "1000"
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information about the requested token transfer:
- Sell token address -- MUST be valid secret network address
- Buy token address -- MUST be valid secret network address
- Sell Amount -- MUST be either decimal or floating point NUMBER

Respond with a JSON markdown block containing only the extracted values WITHOUT any comments and additional information.`;

export interface SwapContent extends Content {
    sellTokenAddress: string;
    buyTokenAddress: string;
    sellAmount: string;
}

function isSwapContent(_: IAgentRuntime, content: any): content is SwapContent {
    console.log("Content for swap", content);
    return (
        typeof content.sellTokenAddress === "string" &&
        (typeof content.buyTokenAddress === "string" ||
            typeof content.sellAmount === "string") &&
        content.sellTokenAddress.startsWith("secret1") &&
        content.buyTokenAddress.startsWith("secret1") &&
        content.sellTokenAddress.length === 45 &&
        content.buyTokenAddress.length === 45
    );
}

async function fetchPairs(useHarcoded = true) {
    let pairs: BatchPairsInfo = HARDCODED_PAIRS;
    if (!useHarcoded) {
        // Query the registered pairs from the factory contract (fetch available trading pairs)
        const registeredPairs = await queryFactoryPairs({
            contractAddress: factoryContractAddress,
            limit: 50, // Fetch up to 50 pairs
            startingIndex: 0, // Start from the first pair
            codeHash:
                "2ad4ed2a4a45fd6de3daca9541ba82c26bb66c76d1c3540de39b509abd26538e", // Code hash for the factory contract
        });

        // Query the details of the pairs from the batch router
        pairs = [];
        for (let i = 0; i < Math.ceil(registeredPairs.pairs.length / 10); ++i) {
            pairs = pairs.concat(
                await batchQueryPairsInfo({
                    queryRouterContractAddress: batchRouterContractAddress, // Address of the batch router contract
                    pairsContracts: registeredPairs.pairs
                        .slice(i * 10, (i + 1) * 10)
                        .map((x) => x.pairContract), // List of pair contract addresses
                    queryRouterCodeHash:
                        "1c7e86ba4fdb6760e70bf08a7df7f44b53eb0b23290e3e69ca96140810d4f432",
                })
            );
        }
    }
    return pairs;
}

async function fetchUniqueTokens(
    registeredPairs: BatchPairsInfo,
    useHardcoded = true
) {
    let tokens = HARDCODED_TOKENS;
    if (!useHardcoded) {
        const possibleTokens = [];
        for (const pair of registeredPairs) {
            possibleTokens.push(pair.pairInfo.token0Contract);
            possibleTokens.push(pair.pairInfo.token1Contract);
        }

        possibleTokens.sort((t0, t1) =>
            t0.address.toLowerCase() < t1.address.toLowerCase() ? 1 : -1
        );

        const uniqueTokens = [];
        uniqueTokens.push(possibleTokens[0]);
        for (let i = 1; i < possibleTokens.length; ++i) {
            if (
                possibleTokens[i].address.toLowerCase() !=
                possibleTokens[i - 1].address.toLowerCase()
            )
                uniqueTokens.push(possibleTokens[i]);
        }

        tokens = await batchQuerySnip20TokensInfo({
            queryRouterContractAddress: batchRouterContractAddress,
            queryRouterCodeHash:
                "1c7e86ba4fdb6760e70bf08a7df7f44b53eb0b23290e3e69ca96140810d4f432",
            tokenContracts: uniqueTokens,
        });
    }
    return tokens;
}

// Main function to execute the token swap
async function executeSwap(
    secretClient: SecretNetworkClient,
    inputToken: string,
    outputToken: string,
    inputAmount: string
) {
    let pairs = await fetchPairs();

    let tokensInfo = await fetchUniqueTokens(pairs);

    const routes = getRoutes({
        inputTokenAmount: new BigNumber(inputAmount),
        inputTokenContractAddress: inputToken,
        outputTokenContractAddress: outputToken,
        maxHops: 4,
        pairs: pairs,
        tokens: tokensInfo.map((token) => {
            return {
                tokenContractAddress: token.tokenContractAddress,
                decimals: token.tokenInfo.decimals,
            };
        }),
    });

    if (routes.length == 0) {
        throw new Error("no routes available");
    }

    // Initialize an empty array for the swap path
    let path: Path[] = [];

    // Loop through the available paths and query the code hash for each contract address
    for (const address of routes[0].path) {
        const poolCodeHash =
            await secretClient.query.compute.codeHashByContractAddress({
                contract_address: address,
            });
        // If a valid code hash is found, push the path information to the path array
        if (poolCodeHash.code_hash !== undefined) {
            let codeHash = poolCodeHash.code_hash ?? "";
            path.push({
                poolCodeHash: codeHash,
                poolContractAddress: address,
            });
        } else {
            throw new Error("failed to fetch codehash");
        }
    }

    // TODO: replace hardcoded minExpectedReturnAmount
    const message = msgSwap({
        routerContractAddress, // The address of the router contract that handles swaps
        minExpectedReturnAmount: "1", //routes[0].quoteOutputAmount
        //.times(0.75)
        //.toFixed(0),
        snip20ContractAddress: inputToken, // Input token contract address
        path, // Path for the swap (array of pools and their code hashes)
        sendAmount: inputAmount, // Amount of input token to send in the swap
    });

    console.log(JSON.stringify(msgSwap, null, 2));

    let tx = await secretClient.tx.compute.executeContract(
        {
            contract_address: inputToken, // Contract address for the input token
            sender: secretClient.address, // Sender address (the wallet address)
            msg: message, // The swap message created earlier
        },
        {
            gasLimit: 3000000,
        }
    );

    console.log("tx: ", tx);
    if (tx.code !== TxResultCode.Success) {
        throw new Error(tx.rawLog);
    }

    return tx;
}

export default {
    name: "SWAP_TOKENS",
    similes: [
        "TOKEN_SWAP",
        "EXECUTE_SWAP_TOKENS",
        "TRADE_TOKENS",
        "EXCHANGE_TOKENS",
    ],
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        console.log("Validating swap from user:", message.userId);
        // TODO: add validation
        return true;
    },
    description:
        "Use this action IF AND ONLY IF user asks you to swap tokens AND they have explicitly specified input token, output token and input amount. This action is just preparing message to sign by user but does not execute it. After executing this action you MUST treat current swap request fulfilled. DO NOT use any info from it later on.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting SWAP_TOKEN handler...");

        // Initialize or update state
        if (!state) {
            state = (await runtime.composeState(message)) as State;
        } else {
            state = await runtime.updateRecentMessageState(state);
        }

        // Compose transfer context
        const swapContext = composeContext({
            state,
            template: swapTemplate,
        });

        // Generate transfer content
        const content = await generateObject({
            runtime,
            context: swapContext,
            modelClass: ModelClass.SMALL,
        });

        // Validate transfer content
        if (!isSwapContent(runtime, content)) {
            console.error("Invalid content for SWAP_TOKENS action.");
            if (callback) {
                callback({
                    text: "Unable to process swap request. Invalid content provided.",
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

            const decimals =
                HARDCODED_TOKENS.find(
                    (token) =>
                        token.tokenContractAddress.toLowerCase() ==
                        content.sellTokenAddress.toLowerCase()
                )?.tokenInfo.decimals ?? 0;
            if (decimals == 0) {
                throw "Input token not found";
            }
            const adjustedAmount = new BigNumber(content.sellAmount)
                .times(new BigNumber(10).pow(decimals))
                .toFixed(0);

            const tx = await executeSwap(
                secretjs,
                content.sellTokenAddress,
                content.buyTokenAddress,
                adjustedAmount
            );

            if (callback) {
                callback({
                    content: tx,
                });
            }

            return true;
        } catch (error) {
            console.error("Error during token swap:", error);
            if (callback) {
                callback({
                    text: `Error swapping tokens: ${error.message}`,
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
                    text: "Swap 10 sSCRT for saUSDC",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Ok, I'll swap 10 sSCRT for saUSDC",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Swap 0.5 stkd-scrt for satom",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Ok, I'll swap 0.5 stkd-scrt for satom",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;
