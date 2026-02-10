const MockUSDC = artifacts.require("MockUSDC");
const PoolFactory = artifacts.require("PoolFactory");
const MockUniswapV2Factory = artifacts.require("MockUniswapV2Factory");
const MockUniswapV2Router02 = artifacts.require("MockUniswapV2Router02");

module.exports = async function (deployer, network, accounts) {
    let usdcAddress;
    let uniFactoryAddress;
    let uniRouterAddress;

    if (network === 'development' || network === 'test') {
        // Local: Deploy Mocks
        await deployer.deploy(MockUSDC);
        const usdc = await MockUSDC.deployed();
        usdcAddress = usdc.address;

        // Mint some USDC
        await usdc.mint(accounts[0], web3.utils.toWei('100000', 'ether'));

        await deployer.deploy(MockUniswapV2Factory);
        const factory = await MockUniswapV2Factory.deployed();
        uniFactoryAddress = factory.address;

        await deployer.deploy(MockUniswapV2Router02, uniFactoryAddress);
        const router = await MockUniswapV2Router02.deployed();
        uniRouterAddress = router.address;

        console.log("Deployed Mocks for Local Dev");
    } else if (network === 'sepolia') {
        // Sepolia: Use Existing Addresses
        // MockUSDC might need deployment if you don't have one, or use valid one.
        // For this demo, let's deploy a fresh MockUSDC on Sepolia too unless specified.
        await deployer.deploy(MockUSDC);
        const usdc = await MockUSDC.deployed();
        usdcAddress = usdc.address;

        // Provided Uniswap V2 Addresses on Sepolia
        uniFactoryAddress = "0xF62c03E08ada871A0bEb309762E260a7a6a880E6";
        uniRouterAddress = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3";

        console.log("Using Sepolia Uniswap V2 Addresses");
    }

    // Deploy Factory
    await deployer.deploy(PoolFactory, usdcAddress, uniFactoryAddress, uniRouterAddress);
    const factory = await PoolFactory.deployed();

    console.log("Deployed PoolFactory at:", factory.address);
};
