import { Plugin } from "@elizaos/core";
import { portfolioMetricsAction } from "./actions/portfolioAction";

export * as actions from "./actions";
export * as evaluators from "./evaluators";
export * as providers from "./providers";

export const defaizaPlugin: Plugin = {
    name: "defaiza",
    description: "Defaiza plugin that provides portfolio analysis",
    actions: [portfolioMetricsAction],
    evaluators: [],
    providers: [],
};
export default defaizaPlugin;
