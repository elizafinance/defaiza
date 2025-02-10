import { Plugin } from "@elizaos/core";
import transferToken from "./actions/transfer";
import swapTokens from "./actions/swap";

export const secretPlugin: Plugin = {
    name: "secret",
    description: "Secret Plugin for Eliza",
    actions: [transferToken, swapTokens],
};

export default secretPlugin;
