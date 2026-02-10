const PoolFactory = artifacts.require("PoolFactory");
const MagenRouter = artifacts.require("MagenRouter");
const MagenVault = artifacts.require("MagenVault");
const SimpleAMM = artifacts.require("SimpleAMM");
const MockUSDC = artifacts.require("MockUSDC");
const OutcomeToken = artifacts.require("OutcomeToken");

module.exports = async function (callback) {
    try {
        console.log("Starting Zap verification...");
        const accounts = await web3.eth.getAccounts();
        const user = accounts[0];

        console.log("User:", user);

        // 1. Deploy & Setup
        console.log("Deploying MockUSDC...");
        const usdc = await MockUSDC.new();
        console.log("Deploying PoolFactory...");
        const factory = await PoolFactory.new(usdc.address);

        console.log("Creating Pool...");
        await factory.createPool("Election", "YES", "NO");
        const pool = await factory.pools(0);

        const router = await MagenRouter.at(pool.router);
        const amm = await SimpleAMM.at(pool.amm);

        console.log("Router:", router.address);
        console.log("AMM:", amm.address);

        // 2. Mint USDC to Use
        const zapAmount = web3.utils.toWei("100", "ether");
        console.log("Minting 100 USDC to user...");
        await usdc.mint(user, zapAmount);

        console.log("Approving Router...");
        await usdc.approve(router.address, zapAmount, { from: user });

        // 3. Execute Zap
        console.log("Executing addLiquidityZap...");
        await router.addLiquidityZap(zapAmount, { from: user });
        console.log("Zap executed.");

        // 4. Verify Results
        const lpBalance = await amm.balanceOf(user);
        console.log("User LP Balance:", web3.utils.fromWei(lpBalance));

        const reserveSI = await amm.reserveSI();
        const reserveNO = await amm.reserveNO();
        console.log("AMM Reserve SI:", web3.utils.fromWei(reserveSI));
        console.log("AMM Reserve NO:", web3.utils.fromWei(reserveNO));

        if (Number(web3.utils.fromWei(lpBalance)) <= 0) throw new Error("User received no LP tokens");
        if (Number(web3.utils.fromWei(reserveSI)) < 99) throw new Error("AMM reserves too low");

        console.log("Zap Verification Successful!");

    } catch (error) {
        console.error("Zap Verification Failed:", error);
        callback(error);
    }
    callback();
};
