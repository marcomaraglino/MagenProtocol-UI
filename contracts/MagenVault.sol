// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./OutcomeToken.sol";

contract MagenVault is Ownable {
    IERC20 public usdc;
    OutcomeToken public tokenSI;
    OutcomeToken public tokenNO;

    bool public resolved;
    uint256 public outcomeScale; // Scaled by 1e18, e.g. 0.8 * 1e18 for 80% SI

    event Minted(address indexed user, uint256 amount);
    event Burned(address indexed user, uint256 amount);
    event Resolved(uint256 scale);
    event Claimed(address indexed user, uint256 payout);

    constructor(address _usdc, address _tokenSI, address _tokenNO) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        tokenSI = OutcomeToken(_tokenSI);
        tokenNO = OutcomeToken(_tokenNO);
    }

    function mint(uint256 amount) external {
        require(!resolved, "Market resolved");
        require(usdc.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");
        
        tokenSI.mint(msg.sender, amount);
        tokenNO.mint(msg.sender, amount);

        emit Minted(msg.sender, amount);
    }

    function burn(uint256 amount) external {
        require(!resolved, "Market resolved");
        
        tokenSI.burn(msg.sender, amount);
        tokenNO.burn(msg.sender, amount);
        require(usdc.transfer(msg.sender, amount), "USDC return failed");

        emit Burned(msg.sender, amount);
    }

    function resolve(uint256 _scale) external onlyOwner {
        require(!resolved, "Already resolved");
        require(_scale <= 1e18, "Invalid scale");
        outcomeScale = _scale;
        resolved = true;
        emit Resolved(_scale);
    }

    function claim(uint256 amount, bool isSI) external {
        require(resolved, "Market not resolved");
        
        uint256 payout = 0;
        if (isSI) {
            tokenSI.burn(msg.sender, amount);
            // payout = amount * scale
            payout = (amount * outcomeScale) / 1e18;
        } else {
            tokenNO.burn(msg.sender, amount);
            // payout = amount * (1 - scale)
            payout = (amount * (1e18 - outcomeScale)) / 1e18;
        }

        require(usdc.transfer(msg.sender, payout), "Payout failed");
        emit Claimed(msg.sender, payout);
    }
}
