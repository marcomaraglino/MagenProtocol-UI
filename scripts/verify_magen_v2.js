const PoolFactory = artifacts.require("PoolFactory");
const MagenRouter = artifacts.require("MagenRouter");
const MagenVault = artifacts.require("MagenVault");
const MockUSDC = artifacts.require("MockUSDC");
const IUniswapV2Pair = artifacts.require("IUniswapV2Pair");

module.exports = async function (callback) {
    try {
        const accounts = await web3.eth.getAccounts();
        const lpUser = accounts[0];
        const user2 = accounts[1];

        console.log("Starting Verification V2...");

        // 1. Setup
        const usdc = await MockUSDC.deployed();
        const factory = await PoolFactory.deployed();

        console.log("USDC:", usdc.address);
        console.log("Factory:", factory.address);

        // Mint USDC to users
        await usdc.mint(lpUser, web3.utils.toWei("100000", "ether"));
        await usdc.mint(user2, web3.utils.toWei("100000", "ether"));

        // 2. Create Pool
        const poolName = "TestPoolV2_" + Math.floor(Date.now() / 1000);
        const risk = 5; // 5%
        const initialLiquidity = web3.utils.toWei("1000", "ether");

        console.log(`Creating Pool '${poolName}'...`);

        // createPool
        let tx = await factory.createPool(poolName, "TPSI", "TPNO");
        let event = tx.logs.find(e => e.event === "PoolCreated");
        if (!event) throw new Error("Pool Creation Failed");

        const routerAddr = event.args.router;
        const pairAddr = event.args.pair;
        const router = await MagenRouter.at(routerAddr);
        const pair = await IUniswapV2Pair.at(pairAddr);

        console.log("Pool Router:", routerAddr);

        // 3. Initialize
        await usdc.approve(routerAddr, initialLiquidity, { from: lpUser });
        console.log("Initializing...");
        tx = await router.initialize(initialLiquidity, risk, { from: lpUser });

        // Check Reserves
        let reserves = await pair.getReserves();
        // Access by index to be safe
        let r0 = reserves[0];
        let r1 = reserves[1];

        let token0 = await pair.token0();
        let tokenSI = await router.tokenSI();

        let resSI = (token0 == tokenSI) ? r0 : r1;
        let resNO = (token0 == tokenSI) ? r1 : r0;

        console.log(`Raw Reserves: SI=${resSI.toString()}, NO=${resNO.toString()}`);

        let resSI_fmt = web3.utils.fromWei(resSI.toString(), 'ether');
        let resNO_fmt = web3.utils.fromWei(resNO.toString(), 'ether');

        console.log(`Reserves: SI=${resSI_fmt}, NO=${resNO_fmt}`);

        // 4. Smart Add Liquidity
        const addAmt = web3.utils.toWei("100", "ether");
        await usdc.approve(routerAddr, addAmt, { from: user2 });

        console.log("User 2 Adding Liquidity...");
        tx = await router.addLiquidity(addAmt, { from: user2 });

        // Check new reserves
        reserves = await pair.getReserves();
        r0 = reserves[0];
        r1 = reserves[1];
        let resSI_new = (token0 == tokenSI) ? r0 : r1;
        let resNO_new = (token0 == tokenSI) ? r1 : r0;

        console.log(`New Reserves: SI=${web3.utils.fromWei(resSI_new.toString())}, NO=${web3.utils.fromWei(resNO_new.toString())}`);

        console.log("Verification Successful!");

    } catch (e) {
        console.error("Verification SCript Error:", e);
        callback(e);
    }
    callback();
}
