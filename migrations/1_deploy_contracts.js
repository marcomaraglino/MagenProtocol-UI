const MockUSDC = artifacts.require("MockUSDC");
const PoolFactory = artifacts.require("PoolFactory");

module.exports = async function (deployer, network, accounts) {
    // Deploy Mock USDC
    await deployer.deploy(MockUSDC);
    const usdc = await MockUSDC.deployed();

    // Mint some USDC to the deployer for testing
    await usdc.mint(accounts[0], web3.utils.toWei('100000', 'ether'));

    // Deploy Factory
    await deployer.deploy(PoolFactory, usdc.address);
    const factory = await PoolFactory.deployed();

    console.log("Deployed Factory at:", factory.address);

    // Create Default Pool: Aave V3
    console.log("Creating Aave V3 Pool...");
    await factory.createPool("Aave V3", "avSI", "avNO");

    // Create Secondary Pool: Uniswap V2
    console.log("Creating Uniswap V2 Pool...");
    await factory.createPool("Uniswap V2", "uniSI", "uniNO");
};
