const MockUSDC = artifacts.require("MockUSDC");
const MagenRouter = artifacts.require("MagenRouter");
const MagenVault = artifacts.require("MagenVault");
const OutcomeToken = artifacts.require("OutcomeToken");
const SimpleAMM = artifacts.require("SimpleAMM");

contract("Magen Protocol MVP", accounts => {
    const [lp, user1, user2] = accounts;
    let usdc, router, vault, tokenSI, tokenNO, amm;

    const toWei = (n) => web3.utils.toWei(n.toString(), 'ether');
    const fromWei = (n) => web3.utils.fromWei(n, 'ether');

    before(async () => {
        usdc = await MockUSDC.deployed();
        router = await MagenRouter.deployed();
        vault = await MagenVault.deployed();

        // Outcome tokens addresses
        const siAddr = await vault.tokenSI();
        const noAddr = await vault.tokenNO();
        tokenSI = await OutcomeToken.at(siAddr);
        tokenNO = await OutcomeToken.at(noAddr);

        amm = await SimpleAMM.deployed();

        // Mint USDC to LP and User
        await usdc.mint(lp, toWei(100000));
        await usdc.mint(user1, toWei(10000));
    });

    it("should initialize the pool via Router", async () => {
        const initAmount = toWei(10000);

        // Approve Router to spend LP's USDC
        await usdc.approve(router.address, initAmount, { from: lp });

        // Initialize
        await router.initialize(initAmount, { from: lp });

        // Check AMM reserves
        const reserveSI = await amm.reserveSI();
        const reserveNO = await amm.reserveNO();

        console.log("Initialized Reserves:");
        console.log("SI:", fromWei(reserveSI));
        console.log("NO:", fromWei(reserveNO));

        assert.isTrue(reserveSI.gt(web3.utils.toBN(0)), "Reserve SI should be > 0");
        assert.isTrue(reserveNO.gt(web3.utils.toBN(0)), "Reserve NO should be > 0");
    });

    it("should allow user to Buy SI (Protection)", async () => {
        const buyAmount = toWei(1000);

        // Approve Router
        await usdc.approve(router.address, buyAmount, { from: user1 });

        const balBefore = await tokenSI.balanceOf(user1);

        // Buy SI
        await router.buySI(buyAmount, { from: user1 });

        const balAfter = await tokenSI.balanceOf(user1);
        const gained = balAfter.sub(balBefore);

        console.log("User Bought SI using 1000 USDC. Received SI:", fromWei(gained));

        // Should have significantly more SI than 1000 because NO was swapped for SI?
        // 1000 USDC -> 1000 SI + 1000 NO. NO swapped for SI in AMM.
        assert.isTrue(gained.gt(web3.utils.toBN(toWei(1000))), "Should receive > 1000 SI");
    });

    it("should allow user to Sell SI", async () => {
        // User1 sells half their SI
        const balSI = await tokenSI.balanceOf(user1);
        const sellAmount = balSI.div(web3.utils.toBN(2));

        await tokenSI.approve(router.address, sellAmount, { from: user1 });

        const usdcBefore = await usdc.balanceOf(user1);

        await router.sellSI(sellAmount, { from: user1 });

        const usdcAfter = await usdc.balanceOf(user1);
        console.log("User Sold SI. Received USDC:", fromWei(usdcAfter.sub(usdcBefore)));

        assert.isTrue(usdcAfter.gt(usdcBefore), "Should receive USDC back");
    });

    it("should simulate hack resolution and claim", async () => {
        // Assume 80% hack (Scale = 0.8 * 1e18)
        // User still holding some SI?
        const balSI = await tokenSI.balanceOf(user1);
        const balNO = await tokenNO.balanceOf(user1);

        console.log(`User holds ${fromWei(balSI)} SI and ${fromWei(balNO)} NO before resolution`);

        // Resolve
        // 0.8 scale => SI worth 0.8 USDC, NO worth 0.2
        await vault.resolve(toWei(0.8));

        // Claim
        const usdcBefore = await usdc.balanceOf(user1);
        if (balSI.gt(web3.utils.toBN(0))) {
            await vault.claim(balSI, true, { from: user1 });
        }
        if (balNO.gt(web3.utils.toBN(0))) {
            await vault.claim(balNO, false, { from: user1 });
        }

        const usdcAfter = await usdc.balanceOf(user1);
        console.log("User claimed payout:", fromWei(usdcAfter.sub(usdcBefore)));
    });
});
