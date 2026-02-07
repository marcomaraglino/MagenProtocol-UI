# Magen Protocol

A decentralized insurance protocol on Ethereum (Sepolia Testnet).

## Features
- Create Insurance Pools (Risk/Reward markets)
- Buy Coverage (Protect against events)
- Provide Capital (Underwrite risk for yield)
- Liquidity Provision (Zap functionality)

## Logic
- **SI Token (Yes)**: Represents coverage (Safe/Insurance).
- **NO Token (Yield)**: Represents collateral/risk.
- **LP Token**: Represents liquidity in the AMM.

## Deployment
### Smart Contracts (Sepolia)
Deployed via Truffle.
- Factory Address: Check `build/contracts/PoolFactory.json` (network 11155111)

### Frontend
Built with vanilla HTML/JS/Web3.js.
Configured for Vercel deployment.

## How to Run Locally
1. `npm install`
2. `npx ganache` (or connect to Sepolia)
3. `npx truffle migrate` (if local)
4. `npx http-server .`
