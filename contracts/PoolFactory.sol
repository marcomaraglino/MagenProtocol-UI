// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./MagenRouter.sol";
import "./MagenVault.sol";
import "./SimpleAMM.sol";
import "./OutcomeToken.sol";

contract PoolFactory {
    address public usdcToken;

    struct Pool {
        string name;
        address router;
        address vault;
        address amm;
        address tokenSI;
        address tokenNO;
    }

    Pool[] public pools;

    event PoolCreated(uint256 indexed poolId, string name, address router, address vault, address amm, address tokenSI, address tokenNO);

    constructor(address _usdcToken) {
        usdcToken = _usdcToken;
    }

    function createPool(string memory name, string memory symbolSI, string memory symbolNO) external {
        // 1. Deploy Outcome Tokens
        // Name construction could be better, but basic is fine.
        OutcomeToken si = new OutcomeToken(string(abi.encodePacked("Magen ", name, " SI")), symbolSI);
        OutcomeToken no = new OutcomeToken(string(abi.encodePacked("Magen ", name, " NO")), symbolNO);

        // 2. Deploy Vault
        MagenVault vault = new MagenVault(usdcToken, address(si), address(no));

        // 3. Deploy AMM
        SimpleAMM amm = new SimpleAMM(address(si), address(no));

        // 4. Deploy Router
        MagenRouter router = new MagenRouter(address(vault), address(amm), usdcToken, address(si), address(no));

        // 5. Transfer Ownership of Tokens to Vault (so Vault can mint/burn)
        si.transferOwnership(address(vault));
        no.transferOwnership(address(vault));

        // 6. Transfer Ownership of Vault to Msg.Sender (so Creator can Resolve)
        vault.transferOwnership(msg.sender);

        pools.push(Pool({
            name: name,
            router: address(router),
            vault: address(vault),
            amm: address(amm),
            tokenSI: address(si),
            tokenNO: address(no)
        }));

        emit PoolCreated(pools.length - 1, name, address(router), address(vault), address(amm), address(si), address(no));
    }

    function getPoolsLength() external view returns (uint256) {
        return pools.length;
    }
    
    function getPool(uint256 index) external view returns (Pool memory) {
        return pools[index];
    }
}
