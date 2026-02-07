require('dotenv').config();
const HDWalletProvider = require('@truffle/hdwallet-provider');
const Web3 = require('web3');

async function test() {
    console.log("Initializing Provider...");
    try {
        const provider = new HDWalletProvider({
            mnemonic: { phrase: process.env.MNEMONIC },
            providerOrUrl: `https://1rpc.io/sepolia`
        });

        console.log("Provider Initialized. Creating Web3...");
        const web3 = new Web3(provider);

        console.log("Getting Block Number...");
        const blockNumber = await web3.eth.getBlockNumber();
        console.log("Current Block:", blockNumber);

        console.log("Getting Accounts...");
        const accounts = await web3.eth.getAccounts();
        console.log("Account 0:", accounts[0]);

        const bal = await web3.eth.getBalance(accounts[0]);
        console.log("Balance:", web3.utils.fromWei(bal, 'ether'), "ETH");

        provider.engine.stop();
    } catch (e) {
        console.error("TEST FAILED:", e);
    }
}

test();
