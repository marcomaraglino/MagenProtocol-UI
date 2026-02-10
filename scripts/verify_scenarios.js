const PoolFactory = artifacts.require("PoolFactory");
const MagenRouter = artifacts.require("MagenRouter");
const MagenVault = artifacts.require("MagenVault");
const MockUSDC = artifacts.require("MockUSDC");
const IUniswapV2Pair = artifacts.require("IUniswapV2Pair");
const OutcomeToken = artifacts.require("OutcomeToken");

module.exports = async function (callback) {
    try {
        const accounts = await web3.eth.getAccounts();
        const lpUser = accounts[0];
        const user2 = accounts[1];

        console.log("Starting Verification V2 - All Scenarios...");

        // 1. Setup
        const usdc = await MockUSDC.deployed();
        const factory = await PoolFactory.deployed();

        // Mint USDC to users
        await usdc.mint(lpUser, web3.utils.toWei("100000", "ether"));
        await usdc.mint(user2, web3.utils.toWei("100000", "ether"));

        // 2. Create Pool
        const poolName = "FullTest_" + Math.floor(Date.now() / 1000);
        const risk = 5; // 5%
        const initialLiquidity = web3.utils.toWei("10000", "ether"); // 10k Init

        console.log(`[1] Creating Pool '${poolName}' (Risk 5%)...`);

        let tx = await factory.createPool(poolName, "TPSI", "TPNO");
        let event = tx.logs.find(e => e.event === "PoolCreated");
        const routerAddr = event.args.router;
        const pairAddr = event.args.pair;
        const router = await MagenRouter.at(routerAddr);
        const pair = await IUniswapV2Pair.at(pairAddr);
        const tokenSI = await OutcomeToken.at(await router.tokenSI());
        const tokenNO = await OutcomeToken.at(await router.tokenNO());

        // 3. Initialize
        await usdc.approve(routerAddr, initialLiquidity, { from: lpUser });
        await router.initialize(initialLiquidity, risk, { from: lpUser });
        console.log("  > Initialized.");

        // 4. Scenario: Buy Coverage (CT/SI)
        // User 2 Buys 100 USDC worth of Coverage
        const buyAmt = web3.utils.toWei("100", "ether");
        await usdc.approve(routerAddr, buyAmt, { from: user2 });

        console.log(`[2] Buy Coverage (100 USDC)...`);
        await router.buySI(buyAmt, { from: user2 });

        let balSI = await tokenSI.balanceOf(user2);
        let balNO = await tokenNO.balanceOf(user2);
        console.log(`  > User 2 SI Balance (Coverage): ${web3.utils.fromWei(balSI)}`);
        console.log(`  > User 2 NO Balance: ${web3.utils.fromWei(balNO)} (Should be 0)`);

        if (balNO > 0) throw new Error("BuySI failed: User has NO tokens");
        if (balSI <= web3.utils.toWei("100")) throw new Error("BuySI failed: Should have > 100 SI (Swapped NO for more SI)");

        // 5. Scenario: Buy Yield (UT/NO)
        // User 2 Buys 100 USDC worth of Yield
        await usdc.approve(routerAddr, buyAmt, { from: user2 });
        console.log(`[3] Buy Yield (100 USDC)...`);
        await router.buyNO(buyAmt, { from: user2 });

        let balNO_2 = await tokenNO.balanceOf(user2);
        console.log(`  > User 2 NO Balance (Yield): ${web3.utils.fromWei(balNO_2)}`);
        if (balNO_2 <= web3.utils.toWei("100")) throw new Error("BuyNO failed: Should have > 100 NO");

        // 6. Scenario: Sell Coverage (SI)
        // User 2 Sells all their SI
        // Check USDC Balance before
        let usdcBefore = await usdc.balanceOf(user2);

        console.log(`[4] Sell Coverage (${web3.utils.fromWei(balSI)} SI)...`);
        await tokenSI.approve(routerAddr, balSI, { from: user2 });
        await router.sellSI(balSI, { from: user2 });

        let usdcAfter = await usdc.balanceOf(user2);
        let diff = usdcAfter.sub(usdcBefore);
        console.log(`  > Received: ${web3.utils.fromWei(diff)} USDC`);

        if (diff.isZero()) throw new Error("SellSI failed: Received 0 USDC");

        // 7. Scenario: Sell Yield (NO)
        // User 2 Sells all their NO
        usdcBefore = await usdc.balanceOf(user2);
        balNO_2 = await tokenNO.balanceOf(user2);

        console.log(`[5] Sell Yield (${web3.utils.fromWei(balNO_2)} NO)...`);
        await tokenNO.approve(routerAddr, balNO_2, { from: user2 });
        await router.sellNO(balNO_2, { from: user2 });

        usdcAfter = await usdc.balanceOf(user2);
        diff = usdcAfter.sub(usdcBefore);
        console.log(`  > Received: ${web3.utils.fromWei(diff)} USDC`);
        if (diff.isZero()) throw new Error("SellNO failed: Received 0 USDC");

        // 8. Scenario: Add Liquidity
        // User 2 Adds 500 USDC
        const liqAmt = web3.utils.toWei("500", "ether");
        await usdc.approve(routerAddr, liqAmt, { from: user2 });

        console.log(`[6] Add Liquidity (500 USDC)...`);
        tx = await router.addLiquidity(liqAmt, { from: user2 });
        console.log(`  > Gas Used: ${tx.receipt.gasUsed}`);

        let lpBal = await pair.balanceOf(user2);
        console.log(`  > LP Tokens Received: ${web3.utils.fromWei(lpBal)}`);
        if (lpBal.isZero()) throw new Error("AddLiquidity failed: 0 LP tokens");

        console.log("ALL SCENARIOS VERIFIED SUCCESSFULLY.");

    } catch (e) {
        console.error("Verification Error:", e);
        callback(e);
    }
    callback();
}
