import { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@elizaos/core";

// Configuration
const CONFIG = {
    RPC_ENDPOINT: 'https://api.mainnet-beta.solana.com',
    CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000, // 1 second
};

// Interfaces
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

interface TokenBalance {
    mint: string;
    amount: number;
    symbol: string;
    price: number;
    value: number;
}

interface TokenMetadata {
    supply: number;
    decimals: number;
    marketCap?: number;
    symbol?: string;
}

// Error handling
class PortfolioError extends Error {
    code: string;
    details?: any;

    constructor(message: string, code: string, details?: any) {
        super(message);
        this.name = 'PortfolioError';
        this.code = code;
        this.details = details;
    }
}

// Cache implementation
class PortfolioCache {
    private cache: Map<string, { data: any; timestamp: number }>;

    constructor(private readonly cacheDuration: number = CONFIG.CACHE_DURATION) {
        this.cache = new Map();
    }

    get(key: string): any | null {
        const cached = this.cache.get(key);
        if (!cached) return null;

        if (Date.now() - cached.timestamp > this.cacheDuration) {
            this.cache.delete(key);
            return null;
        }

        return cached.data;
    }

    set(key: string, data: any): void {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    clear(): void {
        this.cache.clear();
    }
}

// Utility functions
async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retry<T>(
    operation: () => Promise<T>,
    attempts: number = CONFIG.RETRY_ATTEMPTS,
    delay: number = CONFIG.RETRY_DELAY
): Promise<T> {
    let lastError: any;

    for (let i = 0; i < attempts; i++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (i < attempts - 1) {
                await sleep(delay * (i + 1)); // Exponential backoff
            }
        }
    }

    throw lastError;
}

// Portfolio Data Fetcher
class PortfolioDataFetcher {
    private cache: PortfolioCache;
    private priceCache: Map<string, { price: number; timestamp: number }>;

    constructor() {
        this.cache = new PortfolioCache();
        this.priceCache = new Map();
    }

    async fetchPortfolioData(walletAddress: string): Promise<PortfolioMetrics> {
        try {
            // Check cache first
            const cached = this.cache.get(walletAddress);
            if (cached) return cached;

            // Fetch token accounts
            const tokenAccounts = await this.fetchTokenAccounts(walletAddress);

            // Process balances
            const balances = await this.processTokenBalances(tokenAccounts);

            // Get transaction history
            const transactions = await this.fetchTransactionHistory(walletAddress);

            // Calculate metrics
            const metrics = await this.calculateMetrics(balances, transactions);

            // Cache results
            this.cache.set(walletAddress, metrics);

            return metrics;
        } catch (error) {
            console.error('Error fetching portfolio data:', error);
            throw new PortfolioError('Failed to fetch portfolio data', 'DATA_FETCH_ERROR', error);
        }
    }

    private async fetchTokenAccounts(walletAddress: string): Promise<any[]> {
        return await retry(async () => {
            const response = await fetch(CONFIG.RPC_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getTokenAccountsByOwner',
                    params: [
                        walletAddress,
                        { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
                        { encoding: 'jsonParsed' }
                    ]
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            if (data.error) {
                throw new Error(data.error.message);
            }

            return data.result.value;
        });
    }

    private async getTokenPrice(mint: string): Promise<number> {
        // Check price cache
        const cached = this.priceCache.get(mint);
        if (cached && Date.now() - cached.timestamp < 300000) { // 5 minutes cache
            return cached.price;
        }

        try {
            // Try DexScreener first
            try {
                const dexScreenerResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
                if (dexScreenerResponse.ok) {
                    const data = await dexScreenerResponse.json();
                    if (data.pairs && data.pairs.length > 0) {
                        const price = parseFloat(data.pairs[0].priceUsd);
                        if (price > 0) {
                            this.priceCache.set(mint, { price, timestamp: Date.now() });
                            return price;
                        }
                    }
                }
            } catch (error) {
                console.warn('Failed to fetch price from DexScreener:', error);
            }

            // Fallback sources
            const sources = [
                `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${mint}&vs_currencies=usd`,
                `https://public-api.solscan.io/token/meta?tokenAddress=${mint}`
            ];

            for (const source of sources) {
                try {
                    const response = await fetch(source);
                    if (!response.ok) continue;

                    const data = await response.json();
                    let price = 0;

                    if (source.includes('coingecko')) {
                        price = data[mint]?.usd || 0;
                    } else if (source.includes('solscan')) {
                        price = data.priceUsdt || 0;
                    }

                    if (price > 0) {
                        this.priceCache.set(mint, { price, timestamp: Date.now() });
                        return price;
                    }
                } catch (error) {
                    console.warn(`Failed to fetch price from ${source}:`, error);
                    continue;
                }
            }

            // Fallback to token metadata
            const metadata = await this.getTokenMetadata(mint);
            if (metadata?.marketCap && metadata?.supply) {
                const price = metadata.marketCap / metadata.supply;
                this.priceCache.set(mint, { price, timestamp: Date.now() });
                return price;
            }

            return 0;
        } catch (error) {
            console.error('Error in price fetching:', error);
            return 0;
        }
    }

    private async getTokenMetadata(mint: string): Promise<TokenMetadata | null> {
        try {
            const response = await fetch(CONFIG.RPC_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getTokenSupply',
                    params: [mint]
                })
            });

            if (!response.ok) {
                throw new Error('Failed to fetch token metadata');
            }

            const data = await response.json();

            return {
                supply: data.result?.value?.uiAmount || 0,
                decimals: data.result?.value?.decimals || 0
            };
        } catch (error) {
            console.error('Error fetching token metadata:', error);
            return null;
        }
    }

    private async processTokenBalances(accounts: any[]): Promise<TokenBalance[]> {
        const balances: TokenBalance[] = [];
        const errors: string[] = [];

        for (const account of accounts) {
            try {
                const tokenData = account.account.data.parsed.info;
                if (tokenData.tokenAmount.uiAmount > 0) {
                    const price = await retry(() => this.getTokenPrice(tokenData.mint));

                    balances.push({
                        mint: tokenData.mint,
                        amount: tokenData.tokenAmount.uiAmount,
                        symbol: await this.getTokenSymbol(tokenData.mint),
                        price,
                        value: price * tokenData.tokenAmount.uiAmount
                    });
                }
            } catch (error) {
                errors.push(`Failed to process token ${account.account.data.parsed.info?.mint}: ${error.message}`);
                continue;
            }
        }

        if (errors.length > 0) {
            console.warn('Some tokens failed to process:', errors);
        }

        return balances;
    }

    private async getTokenSymbol(mint: string): Promise<string> {
        try {
            const metadata = await this.getTokenMetadata(mint);
            return metadata?.symbol || `${mint.slice(0, 4)}...${mint.slice(-4)}`;
        } catch {
            return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
        }
    }

    private async fetchTransactionHistory(walletAddress: string): Promise<any[]> {
        try {
            const response = await retry(() =>
                fetch(CONFIG.RPC_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'getSignaturesForAddress',
                        params: [walletAddress, { limit: 100 }]
                    })
                })
            );

            const data = await response.json();
            return data.result || [];
        } catch (error) {
            console.error('Error fetching transaction history:', error);
            return [];
        }
    }

    private async calculateMetrics(balances: TokenBalance[], transactions: any[]): Promise<PortfolioMetrics> {
        // Calculate base metrics with proper error handling
        const diversification = this.calculateDiversificationScore(balances) || 0;
        const riskScore = this.calculateRiskScore(balances) || 0;
        const gasScore = this.calculateGasScore(transactions) || 0;
        const liquidityScore = this.calculateLiquidityScore(balances) || 0;
        const performanceMetrics = await this.calculatePerformanceMetrics(balances, transactions);

        // Calculate DEFAI score with validation
        const scoreComponents = [diversification, riskScore, performanceMetrics.daily, liquidityScore]
            .filter(score => !isNaN(score) && score !== null);

        const defaiScore = scoreComponents.length > 0
            ? Math.round(scoreComponents.reduce((sum, score) => sum + score, 0) / scoreComponents.length)
            : 0;

        // Calculate capital management with validation
        const capitalManagement = Math.round(
            ((diversification || 0) + (this.calculateGasScore(transactions) || 0)) / 2
        );

        return {
            defaiScore,
            risk: riskScore,
            entryScore: this.calculateEntryScore(transactions),
            exitScore: this.calculateExitScore(transactions),
            gasScore,
            trendScore: performanceMetrics.trendScore,
            volatilityScore: performanceMetrics.volatilityScore,
            alphaScore: performanceMetrics.alphaScore,
            protocolScore: this.calculateProtocolScore(transactions),
            yieldScore: this.calculateYieldScore(balances),
            contractScore: this.calculateContractScore(balances),
            liquidity: liquidityScore,
            diversification,
            metrics: {
                capitalManagement,
                degenIndex: this.calculateDegenIndex(balances),
                defiSavviness: this.calculateDefiSavviness(balances, transactions)
            },
            performance: {
                daily: performanceMetrics.daily || 0,
                vsCMC100: performanceMetrics.vsCMC100 || 0
            },
            topHoldings: balances
                .sort((a, b) => b.value - a.value)
                .slice(0, 5)
                .map(b => b.symbol || b.mint.slice(0, 4) + '...' + b.mint.slice(-4)),
            aiAnalysis: '',
            comparisonPercentile: 75
        };
    }

    private calculateDiversificationScore(balances: TokenBalance[]): number {
        if (balances.length === 0) return 0;

        const totalValue = balances.reduce((sum, b) => sum + b.value, 0);
        if (totalValue === 0) return 0;

        // Calculate Herfindahl-Hirschman Index (HHI)
        const weights = balances.map(b => (b.value / totalValue));
        const hhi = weights.reduce((sum, w) => sum + (w * w), 0);

        // Normalize score: 1/n ≤ HHI ≤ 1, where n is number of assets
        // Convert to 0-100 scale where higher is better (more diversified)
        const minHHI = 1 / balances.length;
        const normalizedScore = (1 - hhi) / (1 - minHHI) * 100;

        return Math.max(0, Math.min(100, normalizedScore));
    }

    private calculateRiskScore(balances: TokenBalance[]): number {
        if (balances.length === 0) return 0;

        const totalValue = balances.reduce((sum, b) => sum + b.value, 0);
        if (totalValue === 0) return 0;

        // Calculate concentration risk
        const maxPosition = Math.max(...balances.map(b => b.value));
        const concentrationRisk = (maxPosition / totalValue) * 100;

        // Calculate portfolio size risk
        const sizeRisk = Math.min(100, (totalValue / 10000) * 100); // Normalize to 100 if > $10k

        // Calculate asset count risk
        const assetCountRisk = Math.min(100, (balances.length / 10) * 100); // Normalize to 100 if > 10 assets

        // Combine risks (lower score means higher risk)
        const riskScore = (
            (100 - concentrationRisk) * 0.4 + // 40% weight to concentration
            sizeRisk * 0.3 + // 30% weight to portfolio size
            assetCountRisk * 0.3 // 30% weight to number of assets
        );

        return Math.max(0, Math.min(100, riskScore));
    }

    private calculateEntryScore(transactions: any[]): number {
        return transactions.length > 0 ? 70 : 50;
    }

    private calculateExitScore(transactions: any[]): number {
        return transactions.length > 0 ? 75 : 50;
    }

    private calculateGasScore(transactions: any[]): number {
        if (transactions.length === 0) return 0;
        return Math.min(85 + (transactions.length / 100) * 15, 100);
    }

    private async calculatePerformanceMetrics(balances: TokenBalance[], transactions: any[]) {
        try {
            const historicalPrices = await this.getHistoricalPrices(balances.map(b => b.mint));
            return {
                daily: this.calculateDailyReturn(historicalPrices),
                vsCMC100: 3.2, // Placeholder - would need CMC data
                trendScore: 80,
                volatilityScore: 60,
                alphaScore: transactions.length > 0 ? 75 : 50
            };
        } catch (error) {
            console.error('Error calculating performance metrics:', error);
            return {
                daily: 0,
                vsCMC100: 0,
                trendScore: 50,
                volatilityScore: 50,
                alphaScore: 50
            };
        }
    }

    private async getHistoricalPrices(mints: string[]): Promise<any> {
        // Implement historical price fetching
        return {};
    }

    private calculateDailyReturn(historicalPrices: any): number {
        // Implement daily return calculation
        return 0;
    }

    private calculateProtocolScore(transactions: any[]): number {
        return Math.min(50 + (transactions.length / 50) * 25, 100);
    }

    private calculateYieldScore(balances: TokenBalance[]): number {
        return balances.length > 0 ? 70 : 50;
    }

    private calculateContractScore(balances: TokenBalance[]): number {
        return balances.length > 0 ? 80 : 50;
    }

    private calculateLiquidityScore(balances: TokenBalance[]): number {
        if (balances.length === 0) return 0;

        const totalValue = balances.reduce((sum, b) => sum + b.value, 0);

        // Score based on total portfolio value
        // Scale: 0-100, where 100 = $100k or more
        const valueScore = Math.min(100, (totalValue / 1000)); // $1k = 1 point

        // Could also factor in number of assets and their individual liquidity
        // For now, using a simple calculation based on total value
        return Math.max(0, Math.min(100, valueScore));
    }

    private calculateCapitalManagement(balances: TokenBalance[], transactions: any[]): number {
        const diversification = this.calculateDiversificationScore(balances);
        const gasEfficiency = this.calculateGasScore(transactions);
        return Math.round((diversification + gasEfficiency) / 2);
    }

    private calculateDegenIndex(balances: TokenBalance[]): number {
        const riskScore = this.calculateRiskScore(balances) || 0;
        return Math.max(0, Math.min(100, 100 - riskScore));
    }

    private calculateDefiSavviness(balances: TokenBalance[], transactions: any[]): number {
        const protocolScore = this.calculateProtocolScore(transactions) || 0;
        const yieldScore = this.calculateYieldScore(balances) || 0;
        return Math.round((protocolScore + yieldScore) / 2);
    }
}

// Portfolio Analyzer
class PortfolioAnalyzer {
    analyzePortfolio(metrics: PortfolioMetrics): string {
        const analysis: string[] = [];

        analysis.push(this.getOverallHealthAnalysis(metrics));
        analysis.push(this.getRiskAnalysis(metrics));
        analysis.push(this.getPerformanceAnalysis(metrics));
        analysis.push(this.getRecommendations(metrics));

        return analysis.join('\n\n');
    }

    private getOverallHealthAnalysis(metrics: PortfolioMetrics): string {
        const healthLevel = metrics.defaiScore >= 80 ? 'excellent' :
            metrics.defaiScore >= 70 ? 'good' :
            metrics.defaiScore >= 60 ? 'fair' : 'needs attention';

        return `Your portfolio shows ${healthLevel} overall health with a DEFAI score of ${metrics.defaiScore}. ` +
               `Diversification is ${this.getQualitativeRating(metrics.diversification)} ` +
               `and liquidity is ${this.getQualitativeRating(metrics.liquidity)}.`;
    }

    private getRiskAnalysis(metrics: PortfolioMetrics): string {
        const riskLevel = metrics.risk >= 80 ? 'high' :
            metrics.risk >= 60 ? 'moderate' :
            metrics.risk >= 40 ? 'balanced' : 'conservative';

        return `Your risk profile appears ${riskLevel}. ` +
               `Entry timing is ${this.getQualitativeRating(metrics.entryScore)} ` +
               `and exit execution is ${this.getQualitativeRating(metrics.exitScore)}. ` +
               `Gas optimization is ${this.getQualitativeRating(metrics.gasScore)}.`;
    }

    private getPerformanceAnalysis(metrics: PortfolioMetrics): string {
        const performanceVsCMC = metrics.performance.vsCMC100 > 0 ?
            `outperforming` : `underperforming`;

        return `Your portfolio is ${performanceVsCMC} the CMC100 by ${Math.abs(metrics.performance.vsCMC100)}%. ` +
               `Alpha generation is ${this.getQualitativeRating(metrics.alphaScore)} ` +
               `and trend following is ${this.getQualitativeRating(metrics.trendScore)}.`;
    }

    private getRecommendations(metrics: PortfolioMetrics): string {
        const recommendations: string[] = [];

        if (metrics.diversification < 70) {
            recommendations.push("Consider diversifying your holdings across more assets");
        }
        if (metrics.risk > 80) {
            recommendations.push("Consider reducing exposure to high-risk assets");
        }
        if (metrics.gasScore < 70) {
            recommendations.push("Look for opportunities to optimize transaction timing for better gas efficiency");
        }
        if (metrics.yieldScore < 70) {
            recommendations.push("Explore yield farming opportunities in stable protocols");
        }

        return recommendations.length > 0 ?
            `Recommendations:\n${recommendations.join('\n')}` :
            `Your portfolio is well-balanced. Continue monitoring market conditions and maintain your current strategy.`;
    }

    private getQualitativeRating(score: number): string {
        if (score >= 90) return 'excellent';
        if (score >= 80) return 'very good';
        if (score >= 70) return 'good';
        if (score >= 60) return 'fair';
        if (score >= 50) return 'moderate';
        return 'needs improvement';
    }
}

// Main Action Class
export class PortfolioMetricsAction implements Action {
    name = "CALCULATE_PORTFOLIO_METRICS";
    similes = ["GET_PORTFOLIO_METRICS", "ANALYZE_PORTFOLIO", "CHECK_PORTFOLIO"];
    description = "Calculate and analyze portfolio metrics for a given wallet";

    private dataFetcher: PortfolioDataFetcher;
    private analyzer: PortfolioAnalyzer;

    constructor() {
        this.dataFetcher = new PortfolioDataFetcher();
        this.analyzer = new PortfolioAnalyzer();
    }

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

            // Fetch portfolio data
            const metrics = await this.dataFetcher.fetchPortfolioData(walletAddress);

            // Generate analysis
            metrics.aiAnalysis = this.analyzer.analyzePortfolio(metrics);

            // Format response
            const response = this.formatResponse(walletAddress, metrics);

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
            const portfolioError = error instanceof PortfolioError ? error : new PortfolioError(
                error.message,
                'HANDLER_ERROR',
                error
            );

            if (callback) {
                await callback({
                    text: `Error analyzing portfolio: ${portfolioError.message}`,
                    action: this.name
                });
            }

            return false;
        }
    }

    private formatResponse(walletAddress: string, metrics: PortfolioMetrics): string {
        return `📊 Portfolio Analysis Results for ${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}

🏆 DEFAI Score: ${Math.round(metrics.defaiScore)}/100

📈 Key Metrics:
• Capital Management: ${Math.round(metrics.metrics.capitalManagement)}/100
• Risk Index: ${Math.round(metrics.risk)}/100
• DeFi Savviness: ${Math.round(metrics.metrics.defiSavviness)}/100
• Degen Index: ${Math.round(metrics.metrics.degenIndex)}/100

🎯 Trading Style:
• Entry Score: ${Math.round(metrics.entryScore)}/100
• Exit Score: ${Math.round(metrics.exitScore)}/100
• Gas Optimization: ${Math.round(metrics.gasScore)}/100

📊 Performance:
• 24h Change: ${metrics.performance.daily > 0 ? '+' : ''}${Math.round(metrics.performance.daily)}%
• vs CMC100: ${metrics.performance.vsCMC100 > 0 ? '+' : ''}${Math.round(metrics.performance.vsCMC100)}%

💪 Portfolio Health:
• Diversification: ${Math.round(metrics.diversification)}/100
• Liquidity: ${Math.round(metrics.liquidity)}/100
• Risk Exposure: ${Math.round(metrics.risk)}/100

🌊 Market Adaptation:
• Trend Following: ${Math.round(metrics.trendScore)}/100
• Volatility Management: ${Math.round(metrics.volatilityScore)}/100
• Alpha Generation: ${Math.round(metrics.alphaScore)}/100

🏦 DeFi Engagement:
• Protocol Diversity: ${Math.round(metrics.protocolScore)}/100
• Yield Optimization: ${Math.round(metrics.yieldScore)}/100
• Smart Contract Risk: ${Math.round(metrics.contractScore)}/100

🔝 Top Holdings:
${metrics.topHoldings.map((token: string, index: number) => `${index + 1}. ${token}`).join('\n')}

💡 Analysis:
${metrics.aiAnalysis}`;
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

// Export the action
export const portfolioMetricsAction = new PortfolioMetricsAction();