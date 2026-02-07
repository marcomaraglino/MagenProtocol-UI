const PoolFactory = artifacts.require("PoolFactory");
const MockUSDC = artifacts.require("MockUSDC");
const MagenRouter = artifacts.require("MagenRouter");
const SimpleAMM = artifacts.require("SimpleAMM");
const OutcomeToken = artifacts.require("OutcomeToken");

module.exports = async function (callback) {
    try {
        const accounts = await web3.eth.getAccounts();
        const user = accounts[0];
        console.log("Testing with account:", user);

        const usdc = await MockUSDC.deployed();
        const factory = await PoolFactory.deployed();

        // 1. Create Pool
        console.log("Creating Pool...");
        const tx = await factory.createPool("TestPool", "tSI", "tNO", { from: user });
        const poolId = tx.logs[0].args.poolId;
        const routerAddr = tx.logs[0].args.router;
        const ammAddr = tx.logs[0].args.amm;
        console.log("Pool Created. Router:", routerAddr);

        const router = await MagenRouter.at(routerAddr);
        const amm = await SimpleAMM.at(ammAddr);

        // 2. Approve
        const amountRef = web3.utils.toWei('1000', 'ether');
        await usdc.approve(routerAddr, amountRef, { from: user });
        console.log("Approved USDC");

        // 3. Initialize
        console.log("Initializing...");
        await router.initialize(amountRef, 5, { from: user }); // 5% Risk

        // 4. Check LP Amount
        const lpBalance = await amm.balanceOf(user); // Wait, earlier I said User gets LP.
        console.log("User LP Balance:", web3.utils.fromWei(lpBalance));

        // 5. Check Router LP Balance (Target: 0, should transfer all)
        const routerLpBalance = await amm.balanceOf(routerAddr);
        console.log("Router LP Balance:", web3.utils.fromWei(routerLpBalance));

        // 6. Check Liquidity in AMM
        const resSI = await amm.reserveSI();
        const resNO = await amm.reserveNO();
        console.log("AMM Reserve SI:", web3.utils.fromWei(resSI));
        console.log("AMM Reserve NO:", web3.utils.fromWei(resNO));

        if (parseFloat(web3.utils.fromWei(lpBalance)) > 0) {
            console.log("SUCCESS: User received LP tokens.");
        } else {
            console.log("FAILURE: User did NOT receive LP tokens.");
        }

    } catch (e) {
        console.error("Test Failed:", e);
    }
    callback();
};
