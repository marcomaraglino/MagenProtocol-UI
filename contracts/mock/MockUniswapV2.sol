// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/IUniswapV2.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUniswapV2Pair is ERC20 {
    address public token0;
    address public token1;
    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;

    constructor() ERC20("Uniswap V2", "UNI-V2") {}

    function initialize(address _token0, address _token1) external {
        token0 = _token0;
        token1 = _token1;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    function mint(address to) external returns (uint liquidity) {
        uint balance0 = IERC20(token0).balanceOf(address(this));
        uint balance1 = IERC20(token1).balanceOf(address(this));
        uint amount0 = balance0 - reserve0;
        uint amount1 = balance1 - reserve1;
        
        liquidity = amount0; // Simplified
        _mint(to, liquidity);
        
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
    }

    function burn(address to) external returns (uint amount0, uint amount1) {
        uint balance0 = IERC20(token0).balanceOf(address(this));
        uint balance1 = IERC20(token1).balanceOf(address(this));
        uint liquidity = balanceOf(address(this));

        amount0 = (liquidity * balance0) / totalSupply();
        amount1 = (liquidity * balance1) / totalSupply();
        
        _burn(address(this), liquidity);
        
        IERC20(token0).transfer(to, amount0);
        IERC20(token1).transfer(to, amount1);
        
        reserve0 = uint112(IERC20(token0).balanceOf(address(this)));
        reserve1 = uint112(IERC20(token1).balanceOf(address(this)));
    }

    function swap(uint amount0Out, uint amount1Out, address to, bytes calldata) external {
        if (amount0Out > 0) IERC20(token0).transfer(to, amount0Out);
        if (amount1Out > 0) IERC20(token1).transfer(to, amount1Out);
        
        reserve0 = uint112(IERC20(token0).balanceOf(address(this)));
        reserve1 = uint112(IERC20(token1).balanceOf(address(this)));
    }
}

contract MockUniswapV2Factory {
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        MockUniswapV2Pair newPair = new MockUniswapV2Pair();
        newPair.initialize(tokenA, tokenB);
        pair = address(newPair);
        getPair[tokenA][tokenB] = pair;
        getPair[tokenB][tokenA] = pair;
        allPairs.push(pair);
    }
}

contract MockUniswapV2Router02 {
    address public factory;
    address public WETH;

    constructor(address _factory) {
        factory = _factory;
        WETH = address(0); 
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint, uint, address to, uint
    ) external returns (uint amountA, uint amountB, uint liquidity) {
        address pair = MockUniswapV2Factory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) {
            pair = MockUniswapV2Factory(factory).createPair(tokenA, tokenB);
        }
        
        IERC20(tokenA).transferFrom(msg.sender, pair, amountADesired);
        IERC20(tokenB).transferFrom(msg.sender, pair, amountBDesired);
        
        liquidity = MockUniswapV2Pair(pair).mint(to);
        amountA = amountADesired;
        amountB = amountBDesired;
    }

    function swapExactTokensForTokens(
        uint amountIn,
        uint,
        address[] calldata path,
        address to,
        uint
    ) external returns (uint[] memory amounts) {
        address pair = MockUniswapV2Factory(factory).getPair(path[0], path[1]);
        require(pair != address(0), "Pair not found");

        // Transfer Input to Pair
        IERC20(path[0]).transferFrom(msg.sender, pair, amountIn);
        
        // Simplified CPAMM Swap Logic (No Fee for Mock)
        // y_out = (x_in * R_y) / (R_x + x_in)
        
        (uint112 r0, uint112 r1,) = MockUniswapV2Pair(pair).getReserves();
        address t0 = MockUniswapV2Pair(pair).token0();
        
        (uint reserveIn, uint reserveOut) = (path[0] == t0) ? (uint(r0), uint(r1)) : (uint(r1), uint(r0));
        
        require(reserveIn > 0 && reserveOut > 0, "Insufficient reserves");

        amounts = new uint[](2);
        amounts[0] = amountIn;
        amounts[1] = (amountIn * reserveOut) / (reserveIn + amountIn);
        
        (uint amount0Out, uint amount1Out) = (path[0] == t0) ? (uint(0), amounts[1]) : (amounts[1], uint(0));
        
        MockUniswapV2Pair(pair).swap(amount0Out, amount1Out, to, "");
    }
}
