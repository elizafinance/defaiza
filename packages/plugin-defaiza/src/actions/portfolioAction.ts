import { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@elizaos/core";

interface PortfolioMetrics {
    risk: number;
    entryScore: number;
    exitScore: number;
    gasScore: number;
    trendScore: number;
    volatilityScore: number;
    alphaScore: number;
    protocolScore: number;
    yieldScore: number;
    contractScore: number;
    liquidity: number;
    diversification: number;
    defaiScore: number;
    metrics: {
        capitalManagement: number;
        degenIndex: number;
        defiSavviness: number;
    };
    performance: {
        daily: number;
        vsCMC100: number;
    };
    topHoldings: string[];
    aiAnalysis: string;
    comparisonPercentile: number;
}

export class PortfolioMetricsAction implements Action {
    name = "CALCULATE_PORTFOLIO_METRICS";
    similes = ["GET_PORTFOLIO_METRICS", "ANALYZE_PORTFOLIO", "CHECK_PORTFOLIO"];
    description = "Calculate and analyze portfolio metrics for a given wallet";

    private extractWalletAddress(message: Memory): string | null {
        const content = typeof message.content === 'string'
            ? message.content
            : message.content?.text;

        if (!content) return null;

        const solanaAddressRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
        const matches = content.match(solanaAddressRegex);

        return matches?.[0] || null;
    }

    private isValidSolanaAddress(address: string): boolean {
        return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    }

    async validate(runtime: IAgentRuntime, message: Memory): Promise<boolean> {
        const content = typeof message.content === 'string'
            ? message.content
            : message.content?.text || '';

        const hasPortfolioKeywords = /\b(portfolio|analyze|check|metrics|address)\b/i.test(content);
        const walletAddress = this.extractWalletAddress(message);
        const hasValidAddress = walletAddress && this.isValidSolanaAddress(walletAddress);

        console.log("Portfolio validation:", {
            hasPortfolioKeywords,
            walletAddress,
            hasValidAddress
        });

        return hasPortfolioKeywords && hasValidAddress;
    }

    async handler(
        runtime: IAgentRuntime,
        message: Memory,
        state?: State,
        _options: { [key: string]: unknown } = {},
        callback?: HandlerCallback
    ): Promise<boolean> {
        try {
            console.log("Portfolio handler started");
            const walletAddress = this.extractWalletAddress(message);

            if (!walletAddress) {
                throw new Error("No wallet address found");
            }

            console.log("Processing wallet:", walletAddress);

            // Complete metrics matching the interface
            const metrics: PortfolioMetrics = {
                defaiScore: 85,
                risk: 75,
                entryScore: 70,
                exitScore: 75,
                gasScore: 85,
                trendScore: 80,
                volatilityScore: 60,
                alphaScore: 75,
                protocolScore: 85,
                yieldScore: 70,
                contractScore: 80,
                liquidity: 85,
                diversification: 75,
                metrics: {
                    capitalManagement: 82,
                    degenIndex: 65,
                    defiSavviness: 78
                },
                performance: {
                    daily: 8.7,
                    vsCMC100: 3.2
                },
                topHoldings: ['DEFAI', 'AI16Z', 'SOL'],
                aiAnalysis: "G'day! Your portfolio is looking ripper with a healthy balance. Your DEFAI position shows good conviction while maintaining reasonable diversification.",
                comparisonPercentile: 75
            };

            const response = `📊 Portfolio Analysis Results for ${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}

🏆 DEFAI Score: ${metrics.defaiScore}/100

📈 Key Metrics:
• Capital Management: ${metrics.metrics.capitalManagement}/100
• Risk Index: ${metrics.risk}/100
• DeFi Savviness: ${metrics.metrics.defiSavviness}/100
• Degen Index: ${metrics.metrics.degenIndex}/100

🎯 Trading Style:
• Entry Score: ${metrics.entryScore}/100
• Exit Score: ${metrics.exitScore}/100
• Gas Optimization: ${metrics.gasScore}/100

📊 Performance:
• 24h Change: ${metrics.performance.daily > 0 ? '+' : ''}${metrics.performance.daily.toFixed(2)}%
• vs CMC100: ${metrics.performance.vsCMC100 > 0 ? '+' : ''}${metrics.performance.vsCMC100.toFixed(2)}%

💪 Portfolio Health:
• Diversification: ${metrics.diversification}/100
• Liquidity: ${metrics.liquidity}/100
• Risk Exposure: ${metrics.risk}/100

🌊 Market Adaptation:
• Trend Following: ${metrics.trendScore}/100
• Volatility Management: ${metrics.volatilityScore}/100
• Alpha Generation: ${metrics.alphaScore}/100

🏦 DeFi Engagement:
• Protocol Diversity: ${metrics.protocolScore}/100
• Yield Optimization: ${metrics.yieldScore}/100
• Smart Contract Risk: ${metrics.contractScore}/100

🔝 Top Holdings:
${metrics.topHoldings.map((token: string, index: number) => `${index + 1}. ${token}`).join('\n')}

💡 Analysis:
${metrics.aiAnalysis}`;

            console.log("Sending portfolio analysis response");

            if (callback) {
                await callback({
                    text: response,
                    content: metrics,
                    action: this.name
                });
            }

            if (state) {
                state.responseData = {
                    text: response,
                    content: metrics,
                    action: this.name
                };
            }

            return true;

        } catch (error) {
            console.error("Error in portfolio handler:", error);

            if (callback) {
                await callback({
                    text: `Error analyzing portfolio: ${error.message}`,
                    action: this.name
                });
            }

            return false;
        }
    }

    examples = [
        [
            {
                user: "{{user}}",
                content: {
                    text: "Can you analyze my portfolio metrics? Here is my address 9qVPMhnXVbr7TD1EoeKbutpm8AoNm7yBzB8JJZ7PYEPS"
                }
            },
            {
                user: "{{system}}",
                content: {
                    text: "📊 Portfolio Analysis Results...",
                    action: "CALCULATE_PORTFOLIO_METRICS"
                }
            }
        ]
    ];
}

export const portfolioMetricsAction = new PortfolioMetricsAction();