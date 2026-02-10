// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./MagenRouter.sol";
import "./MagenVault.sol";
import "./OutcomeToken.sol";
import "./interfaces/IUniswapV2.sol";

contract PoolFactory {
    address public usdcToken;
    address public uniswapFactory;
    address public uniswapRouter;

    struct Pool {
        string name;
        address router;     // MagenRouter
        address vault;
        address pair;       // Uniswap Pair (SI/NO)
        address tokenSI;
        address tokenNO;
    }

    Pool[] public pools;

    event PoolCreated(uint256 indexed poolId, string name, address router, address vault, address pair, address tokenSI, address tokenNO);

    constructor(address _usdcToken, address _uniswapFactory, address _uniswapRouter) {
        usdcToken = _usdcToken;
        uniswapFactory = _uniswapFactory;
        uniswapRouter = _uniswapRouter;
    }

    function createPool(string memory name, string memory symbolSI, string memory symbolNO) external {
        // 1. Deploy Outcome Tokens
        OutcomeToken si = new OutcomeToken(string(abi.encodePacked("Magen ", name, " SI")), symbolSI);
        OutcomeToken no = new OutcomeToken(string(abi.encodePacked("Magen ", name, " NO")), symbolNO);

        // 2. Deploy Vault
        MagenVault vault = new MagenVault(usdcToken, address(si), address(no));

        // 3. Create Uniswap Pair for SI/NO
        address pair = IUniswapV2Factory(uniswapFactory).createPair(address(si), address(no));

        // 4. Deploy Router (MagenRouter wrapping UniswapRouter)
        MagenRouter router = new MagenRouter(address(vault), uniswapRouter, pair, usdcToken, address(si), address(no));

        // 5. Transfer Ownership of Tokens to Vault
        si.transferOwnership(address(vault));
        no.transferOwnership(address(vault));

        // 6. Transfer Ownership of Vault to Msg.Sender
        vault.transferOwnership(msg.sender);

        pools.push(Pool({
            name: name,
            router: address(router),
            vault: address(vault),
            pair: pair,
            tokenSI: address(si),
            tokenNO: address(no)
        }));

        emit PoolCreated(pools.length - 1, name, address(router), address(vault), pair, address(si), address(no));
    }

    function getPoolsLength() external view returns (uint256) {
        return pools.length;
    }
    
    function getPool(uint256 index) external view returns (Pool memory) {
        return pools[index];
    }
}
