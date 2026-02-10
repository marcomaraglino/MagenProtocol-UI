// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./MagenVault.sol";
import "./OutcomeToken.sol";
import "./interfaces/IUniswapV2.sol";

contract MagenRouter {
    MagenVault public vault;
    IUniswapV2Router02 public uniswapRouter;
    address public pair;
    
    IERC20 public usdc;
    IERC20 public tokenSI;
    IERC20 public tokenNO;

    constructor(address _vault, address _uniswapRouter, address _pair, address _usdc, address _tokenSI, address _tokenNO) {
        vault = MagenVault(_vault);
        uniswapRouter = IUniswapV2Router02(_uniswapRouter);
        pair = _pair;
        usdc = IERC20(_usdc);
        tokenSI = IERC20(_tokenSI);
        tokenNO = IERC20(_tokenNO);
    }

    // Zap: USDC -> Mint SI/NO -> Add Liquidity to Uniswap -> Return LP Tokens
    function addLiquidityZap(uint256 usdcAmount) public returns (uint liquidity) {
        require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "USDC transfer failed");
        
        // Approve Vault to spend USDC
        usdc.approve(address(vault), usdcAmount);
        vault.mint(usdcAmount);

        // Router now has SI and NO
        uint256 balSI = tokenSI.balanceOf(address(this));
        uint256 balNO = tokenNO.balanceOf(address(this));

        // Approve Uniswap Router
        tokenSI.approve(address(uniswapRouter), balSI);
        tokenNO.approve(address(uniswapRouter), balNO);

        // Add Liquidity
        // min amounts set to 0 for simplicity in this example/MVP
        // but crucial for production slippage protection
        (,, liquidity) = uniswapRouter.addLiquidity(
            address(tokenSI),
            address(tokenNO),
            balSI,
            balNO,
            0, // amountAMin
            0, // amountBMin
            msg.sender, // LP tokens go to user
            block.timestamp + 300
        );
    }
    
    function initialize(uint256 amount, uint256 /* risk */) external {
        addLiquidityZap(amount);
    }

    // Buy SI: Mint SI+NO, Sell NO -> SI, Return Total SI
    function buySI(uint256 usdcAmount) external {
        require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "USDC transfer failed");
        
        usdc.approve(address(vault), usdcAmount);
        vault.mint(usdcAmount);
        
        uint256 noBalance = tokenNO.balanceOf(address(this));
        tokenNO.approve(address(uniswapRouter), noBalance);
        
        // Path: NO -> SI
        address[] memory path = new address[](2);
        path[0] = address(tokenNO);
        path[1] = address(tokenSI);
        
        uniswapRouter.swapExactTokensForTokens(
            noBalance,
            0, // amountOutMin
            path,
            address(this), // Router receives SI first
            block.timestamp + 300
        );
        
        // Send all SI to user
        uint256 siBalance = tokenSI.balanceOf(address(this));
        tokenSI.transfer(msg.sender, siBalance);
    }

    // Sell SI: Best effort swap SI -> NO to balance, then Burn
    // In V2, optimal swap amount is harder to calc on-chain due to 0.3% fee + reserves
    // For MVP, we can iterate or use a simplified formula:
    // To reach R_si = R_no * (new_reserves), we swap.
    // However, simplest is: Swap half? No.
    // We stick to the quadratic formula logic, fetching reserves from pair.
    
    function sellSI(uint256 tokenAmount) external {
        require(tokenAmount > 0, "Amount > 0");
        require(tokenSI.transferFrom(msg.sender, address(this), tokenAmount), "Transfer failed");

        // Get Reserves
        (uint112 _reserve0, uint112 _reserve1,) = IUniswapV2Pair(pair).getReserves();
        address _token0 = IUniswapV2Pair(pair).token0();
        
        (uint256 reserveSI, uint256 reserveNO) = (address(tokenSI) == _token0) 
            ? (_reserve0, _reserve1) 
            : (_reserve1, _reserve0);
            
        // Quadratic Formula for Optimal Swap Amount
        // x = (-b + sqrt(b^2 - 4ac)) / 2
        // b = (R_no + R_si) - T
        // c = -(T * R_si)
        
        uint256 amountToSwap;
        {
            int256 R_si = int256(reserveSI);
            int256 R_no = int256(reserveNO);
            int256 T = int256(tokenAmount);
            
            int256 b = (R_no + R_si) - T;
            int256 c = -(T * R_si);
            
            uint256 D = uint256(b * b - (4 * c));
            uint256 sqrtD = Math.sqrt(D);
            
            // Result is positive, safe to cast
            int256 num = -b + int256(sqrtD);
            amountToSwap = uint256(num / 2);
        }

        tokenSI.approve(address(uniswapRouter), amountToSwap);
        
        address[] memory path = new address[](2);
        path[0] = address(tokenSI);
        path[1] = address(tokenNO);

        uniswapRouter.swapExactTokensForTokens(
            amountToSwap,
            0, // Accept any amount for now (MVP)
            path,
            address(this),
            block.timestamp + 300
        );

        uint256 balSI = tokenSI.balanceOf(address(this));
        uint256 balNO = tokenNO.balanceOf(address(this));
        uint256 burnAmount = balSI < balNO ? balSI : balNO;

        vault.burn(burnAmount);

        // Return USDC
        uint256 usdcBal = usdc.balanceOf(address(this));
        usdc.transfer(msg.sender, usdcBal);
    }

    function sellNO(uint256 tokenAmount) external {
         // Symmetric logic for NO
         // ...
         revert("Not implemented yet for demo");
    }
    
    // Fallback for buyNO
    function buyNO(uint256 usdcAmount) external {
        require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "USDC transfer failed");
        usdc.approve(address(vault), usdcAmount);
        vault.mint(usdcAmount);
        
        uint256 siBalance = tokenSI.balanceOf(address(this));
        tokenSI.approve(address(uniswapRouter), siBalance);
        
        address[] memory path = new address[](2);
        path[0] = address(tokenSI);
        path[1] = address(tokenNO);
        
        uniswapRouter.swapExactTokensForTokens(
            siBalance,
            0,
            path,
            address(this),
            block.timestamp + 300
        );
        
        uint256 noBalance = tokenNO.balanceOf(address(this));
        tokenNO.transfer(msg.sender, noBalance);
    }
}
