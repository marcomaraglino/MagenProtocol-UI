const PoolFactory = artifacts.require("PoolFactory");
const MagenRouter = artifacts.require("MagenRouter");
const MagenVault = artifacts.require("MagenVault");
const MockUSDC = artifacts.require("MockUSDC");
const OutcomeToken = artifacts.require("OutcomeToken");
const MockUniswapV2Factory = artifacts.require("MockUniswapV2Factory");
const MockUniswapV2Router02 = artifacts.require("MockUniswapV2Router02");
const IUniswapV2Pair = artifacts.require("IUniswapV2Pair");

module.exports = async function (callback) {
    try {
        console.log("Starting Uniswap V2 Verification...");
        const accounts = await web3.eth.getAccounts();
        const user = accounts[0];
        const provider = accounts[1];

        console.log("User:", user);
        console.log("Provider:", provider);

        // 1. Deploy Mocks
        console.log("Deploying MockUSDC...");
        const usdc = await MockUSDC.new();

        console.log("Deploying Mock Uniswap...");
        const uniFactory = await MockUniswapV2Factory.new();
        const uniRouter = await MockUniswapV2Router02.new(uniFactory.address);

        console.log("UniFactory:", uniFactory.address);
        console.log("UniRouter:", uniRouter.address);

        // 2. Deploy Factory
        console.log("Deploying PoolFactory...");
        const factory = await PoolFactory.new(usdc.address, uniFactory.address, uniRouter.address);
        console.log("PoolFactory deployed at:", factory.address);

        // 3. Create Pool
        console.log("Creating Pool...");
        await factory.createPool("Election", "YES", "NO");
        const pool = await factory.pools(0);
        console.log("Pool created:", pool.name);

        const router = await MagenRouter.at(pool.router);
        const vault = await MagenVault.at(pool.vault);
        const tokenSI = await OutcomeToken.at(pool.tokenSI);
        const tokenNO = await OutcomeToken.at(pool.tokenNO);

        // 4. Setup Liquidity (Provider)
        const liquidityAmount = web3.utils.toWei("1000", "ether");
        console.log("Minting USDC to provider...");
        await usdc.mint(provider, liquidityAmount);
        await usdc.approve(router.address, liquidityAmount, { from: provider });

        console.log("Adding Liquidity Zap...");
        await router.addLiquidityZap(liquidityAmount, { from: provider });
        console.log("Liquidity Added.");

        // Check Reserves
        const pairAddr = pool.pair;
        const pair = await IUniswapV2Pair.at(pairAddr);
        const reserves = await pair.getReserves();
        console.log("Pair Reserves:", web3.utils.fromWei(reserves[0]), web3.utils.fromWei(reserves[1]));

        // 5. User Buy SI
        const buyAmount = web3.utils.toWei("10", "ether");
        console.log("Minting USDC to user...");
        await usdc.mint(user, buyAmount);
        await usdc.approve(router.address, buyAmount, { from: user });

        console.log("Buying SI with 10 USDC...");
        await router.buySI(buyAmount, { from: user });

        const userSI = await tokenSI.balanceOf(user);
        const userNO = await tokenNO.balanceOf(user);
        console.log("User SI Balance:", web3.utils.fromWei(userSI));
        console.log("User NO Balance:", web3.utils.fromWei(userNO));

        if (Number(web3.utils.fromWei(userSI)) <= 10) throw new Error("Buy SI output too low");

        // 6. User Sell SI
        console.log("Selling ALL SI...");
        await tokenSI.approve(router.address, userSI, { from: user });
        await router.sellSI(userSI, { from: user });

        const finalUSDC = await usdc.balanceOf(user);
        console.log("Final USDC Balance:", web3.utils.fromWei(finalUSDC));

        if (Number(web3.utils.fromWei(finalUSDC)) < 9.0) throw new Error("Sell return too low (imbalanced swap?)");

        console.log("Verification Successful!");

    } catch (error) {
        console.error("Verification Failed:", error);
        callback(error);
    }
    callback();
};
