// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SimpleAMM is ReentrancyGuard, ERC20 {
    IERC20 public tokenSI;
    IERC20 public tokenNO;

    uint256 public reserveSI;
    uint256 public reserveNO;

    constructor(address _tokenSI, address _tokenNO) ERC20("Magen LP", "MLP") {
        tokenSI = IERC20(_tokenSI);
        tokenNO = IERC20(_tokenNO);
    }

    function addLiquidity(uint256 amountSI, uint256 amountNO) external returns (uint256 liquidity) {
        require(tokenSI.transferFrom(msg.sender, address(this), amountSI), "Transfer SI failed");
        require(tokenNO.transferFrom(msg.sender, address(this), amountNO), "Transfer NO failed");

        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            liquidity = sqrt(amountSI * amountNO);
        } else {
            uint256 liqSI = (amountSI * _totalSupply) / reserveSI;
            uint256 liqNO = (amountNO * _totalSupply) / reserveNO;
            liquidity = liqSI < liqNO ? liqSI : liqNO;
        }
        
        require(liquidity > 0, "Insufficient liquidity minted");
        _mint(msg.sender, liquidity);

        reserveSI += amountSI;
        reserveNO += amountNO;
    }

    function removeLiquidity(uint256 liquidity) external returns (uint256 amountSI, uint256 amountNO) {
        require(balanceOf(msg.sender) >= liquidity, "Insufficient LP balance");
        
        uint256 _totalSupply = totalSupply();
        amountSI = (liquidity * reserveSI) / _totalSupply;
        amountNO = (liquidity * reserveNO) / _totalSupply;
        
        _burn(msg.sender, liquidity);
        
        reserveSI -= amountSI;
        reserveNO -= amountNO;

        require(tokenSI.transfer(msg.sender, amountSI), "Transfer SI failed");
        require(tokenNO.transfer(msg.sender, amountNO), "Transfer NO failed");
    }

    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function getAmountOut(uint256 amountIn, bool isSIIn) public view returns (uint256) {
        // XY = K
        // (x + dx)(y - dy) = xy
        // dy = y(dx / (x + dx))
        
        uint256 reserveIn = isSIIn ? reserveSI : reserveNO;
        uint256 reserveOut = isSIIn ? reserveNO : reserveSI;

        require(reserveIn > 0 && reserveOut > 0, "Insufficient reserves");

        uint256 numerator = reserveOut * amountIn;
        uint256 denominator = reserveIn + amountIn;
        return numerator / denominator;
    }

    function swap(uint256 amountIn, bool isSIIn) external nonReentrant {
        require(amountIn > 0, "Invalid amount");

        uint256 amountOut = getAmountOut(amountIn, isSIIn);

        if (isSIIn) {
             require(tokenSI.transferFrom(msg.sender, address(this), amountIn), "Transfer SI failed");
             require(tokenNO.transfer(msg.sender, amountOut), "Transfer NO failed");
             reserveSI += amountIn;
             reserveNO -= amountOut;
        } else {
             require(tokenNO.transferFrom(msg.sender, address(this), amountIn), "Transfer NO failed");
             require(tokenSI.transfer(msg.sender, amountOut), "Transfer SI failed");
             reserveNO += amountIn;
             reserveSI -= amountOut;
        }
    }
}
