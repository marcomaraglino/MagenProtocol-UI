const PoolFactory = artifacts.require("PoolFactory");
const MagenRouter = artifacts.require("MagenRouter");
const MagenVault = artifacts.require("MagenVault");
const SimpleAMM = artifacts.require("SimpleAMM");
const MockUSDC = artifacts.require("MockUSDC");
const OutcomeToken = artifacts.require("OutcomeToken");
const IERC20 = artifacts.require("IERC20");

module.exports = async function (callback) {
    try {
        console.log("Starting verification...");
        const accounts = await web3.eth.getAccounts();
        console.log("Accounts fetched:", accounts.length);
        const user = accounts[0];
        const provider = accounts[1];

        console.log("User:", user);
        console.log("Provider:", provider);

        // 1. Deploy Mock USDC
        console.log("Deploying MockUSDC...");
        const usdc = await MockUSDC.new();
        console.log("MockUSDC deployed at:", usdc.address);

        // 2. Deploy Factory
        console.log("Deploying PoolFactory...");
        const factory = await PoolFactory.new(usdc.address);
        console.log("PoolFactory deployed at:", factory.address);

        // 3. Create Pool
        console.log("Creating Pool...");
        await factory.createPool("Election", "YES", "NO");
        const pool = await factory.pools(0);
        console.log("Pool created:", pool);

        const router = await MagenRouter.at(pool.router);
        const vault = await MagenVault.at(pool.vault);
        const amm = await SimpleAMM.at(pool.amm);
        const tokenSI = await OutcomeToken.at(pool.tokenSI);
        const tokenNO = await OutcomeToken.at(pool.tokenNO);
        console.log("Contracts loaded.");
        console.log("Router Address:", router.address);

        // 4. Setup Liquidity (Provider)
        const liquidityAmount = web3.utils.toWei("1000", "ether");
        console.log("Minting USDC to provider...");
        await usdc.mint(provider, liquidityAmount);
        console.log("Approving Vault...");
        await usdc.approve(vault.address, liquidityAmount, { from: provider });

        console.log("Minting SI/NO...");
        await vault.mint(liquidityAmount, { from: provider });

        console.log("Adding Liquidity to AMM...");
        await tokenSI.approve(amm.address, liquidityAmount, { from: provider });
        await tokenNO.approve(amm.address, liquidityAmount, { from: provider });
        await amm.addLiquidity(liquidityAmount, liquidityAmount, { from: provider });
        console.log("Liquidity added by provider");

        // 5. User Buy SI
        const buyAmount = web3.utils.toWei("10", "ether"); // 10 USDC worth (smaller amount to avoid Huge slippage)
        console.log("Minting USDC to user...");
        await usdc.mint(user, buyAmount);
        console.log("Approving Router...");
        await usdc.approve(router.address, buyAmount, { from: user });

        console.log(`Buying SI with ${web3.utils.fromWei(buyAmount)} USDC...`);
        await router.buySI(buyAmount, { from: user });
        console.log("Buy executed.");

        const userSI = await tokenSI.balanceOf(user);
        const userNO = await tokenNO.balanceOf(user);
        const userUSDC = await usdc.balanceOf(user);

        console.log("User SI Balance:", web3.utils.fromWei(userSI));
        console.log("User NO Balance:", web3.utils.fromWei(userNO));
        console.log("User USDC Balance remaining:", web3.utils.fromWei(userUSDC));

        if (Number(userNO) > 0) throw new Error("User should have 0 NO tokens after buying SI");

        // 6. User Sell SI
        console.log("Selling ALL SI...");
        await tokenSI.approve(router.address, userSI, { from: user });
        await router.sellSI(userSI, { from: user });
        console.log("Sell executed.");

        const finalUSDC = await usdc.balanceOf(user);
        const finalSI = await tokenSI.balanceOf(user);

        console.log("Final USDC Balance:", web3.utils.fromWei(finalUSDC));
        console.log("Final SI Balance:", web3.utils.fromWei(finalSI));

        // Check result
        // Started with 0 USDC (minted 10). Spent 10.
        // Expect slightly less than 10 back due to slippage?
        // Buy: 10 USDC -> Mint 10 SI + 10 NO. Swap 10 NO -> ? SI.
        // Res: 1000 SI, 1000 NO. Input 10 NO.
        // out = (1000 * 10) / (1000 + 10) = 10000 / 1010 = 9.90099 SI.
        // User gets 10 + 9.90099 = 19.90099 SI.
        // Sell: 19.90099 SI.
        // Swap X SI -> X NO.
        // Need (19.90099 - X) = SwapOutput(X).
        // If we reverse perfectly, we should get back 10 USDC.
        // But AMM has fees? No, SimpleAMM has no fees logic in `getAmountOut`.
        // So it should be close to 10.

        if (Number(web3.utils.fromWei(finalUSDC)) < 9.5) throw new Error("Loss > 5%, something wrong with logic");
        if (Number(finalSI) > 1e15) throw new Error("Sell failed to clear clean SI balance");

        console.log("Verification Successful!");

    } catch (error) {
        console.error("Verification Failed:", error);
        callback(error);
    }
    callback();
};
