const HDWalletProvider = require('@truffle/hdwallet-provider');
require('dotenv').config();

module.exports = {
  networks: {
    development: {
      host: "127.0.0.1",     // Localhost (default: none)
      port: 8545,            // Standard Ethereum port (default: none)
      network_id: "*",       // Any network (default: none)
    },
    sepolia: {
      provider: () => new HDWalletProvider({
        mnemonic: { phrase: process.env.MNEMONIC },
        providerOrUrl: `https://ethereum-sepolia-rpc.publicnode.com`,
        pollingInterval: 15000 // 15 seconds to avoid rate limiting
      }),
      network_id: 11155111,
      gas: 10000000,        // Increase gas limit: PoolFactory is large
      confirmations: 1,
      timeoutBlocks: 500,
      skipDryRun: true,
      networkCheckTimeout: 60000
    },
  },

  // Set default mocha options here, use special reporters etc.
  mocha: {
    // timeout: 100000
  },

  // Configure your compilers
  compilers: {
    solc: {
      version: "0.8.21",      // Fetch exact version from solc-bin (default: truffle's version)
      settings: {          // See the solidity docs for advice about optimization and evmVersion
        optimizer: {
          enabled: true,
          runs: 200
        },
      }
    }
  },
};
