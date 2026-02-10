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

    // Initialize Pool: Mint SI/NO, Deposit based on Risk (Initial Price)
    // Risk is probability (0-100)
    // Price SI = Risk%
    // Ratio Res_NO / Res_SI = P_si / P_no = p / (1-p)
    function initialize(uint256 amount, uint256 risk) external {
        require(risk > 0 && risk < 100, "Risk must be between 1 and 99");
        
        // 1. Mint SI/NO
        require(usdc.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");
        usdc.approve(address(vault), amount);
        vault.mint(amount);

        // 2. Calculate Token Distribution
        // We have `amount` of SI and `amount` of NO.
        // We want ratio: NO / SI = risk / (100 - risk)
        
        uint256 amountSI;
        uint256 amountNO;
        
        if (risk <= 50) {
             // Risk low -> Price SI low -> Need MORE SI in pool than NO
             // Ratio NO/SI is small.
             // Ratio < 1. SI is denominator.
             // We use Max SI = amount.
             amountSI = amount;
             // amountNO = amount * risk / (100 - risk)
             amountNO = (amount * risk) / (100 - risk);
        } else {
             // Risk high -> Price SI high -> Need LESS SI in pool (More NO)
             // Ratio NO/SI > 1.
             // We use Max NO = amount.
             amountNO = amount;
             // amountSI = amount * (100 - risk) / risk
             amountSI = (amount * (100 - risk)) / risk;
        }

        // 3. Approve and Add Liquidity
        tokenSI.approve(address(uniswapRouter), amountSI);
        tokenNO.approve(address(uniswapRouter), amountNO);

        uniswapRouter.addLiquidity(
            address(tokenSI),
            address(tokenNO),
            amountSI,
            amountNO,
            0, // minSI
            0, // minNO
            msg.sender,
            block.timestamp + 300
        );
        
        // 4. Refund remaining tokens to user
        uint256 remSI = tokenSI.balanceOf(address(this));
        if (remSI > 0) tokenSI.transfer(msg.sender, remSI);
        uint256 remNO = tokenNO.balanceOf(address(this));
        if (remNO > 0) tokenNO.transfer(msg.sender, remNO);
    }
    
    // Smart Add Liquidity: Mint -> Rebalance -> Deposit
    // Matches pool ratio to minimize impact/leftovers
    function addLiquidity(uint256 usdcAmount) external returns (uint liquidity) {
        require(usdcAmount > 0, "Amount > 0");
        
        // 1. Mint
        require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "USDC TF failed");
        usdc.approve(address(vault), usdcAmount);
        vault.mint(usdcAmount);
        
        // 2. Get Reserves
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();
        address t0 = IUniswapV2Pair(pair).token0();
        (uint256 rSI, uint256 rNO) = (address(tokenSI) == t0) ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        
        // 3. Calculate Rebalance
        // Current holding: usdcAmount of SI, usdcAmount of NO
        // Target Ratio: rSI / rNO
        // If rSI > rNO: We need more SI. Sell NO -> SI.
        // If rNO > rSI: We need more NO. Sell SI -> NO.
        
        // Use half-excess approximation for swap amount
        // x = (Amt_Have - Amt_Other * (R_Have/R_Other)) / 2
        
        if (rSI > rNO) {
             // Needed: More SI. Swap NO -> SI.
             // Excess NO.
             // Amt_Have = usdcAmount (NO)
             // Amt_Other = usdcAmount (SI)
             // R_Have = rNO, R_Other = rSI
             // But simpler: We have equal amounts A.
             // We want ratio K = rSI / rNO (> 1).
             // Swap x NO for y SI.
             // (A + y) / (A - x) = K.
             // Approximation: y approx x (price near 1? NO price is NOT near 1).
             // We must use Price. Price(NO in SI) = rSI / rNO.
             // y = x * (rSI / rNO).
             // (A + x(rSI/rNO)) / (A - x) = rSI / rNO.
             // Let R = rSI / rNO.
             // (A + xR) = R(A - x) = RA - Rx.
             // xR + Rx = RA - A.
             // 2Rx = A(R - 1).
             // x = A(R - 1) / 2R = A(1 - 1/R) / 2.
             // x = Amount * (1 - rNO/rSI) / 2.
             
             uint256 swapAmount = (usdcAmount * (rSI - rNO)) / rSI / 2;
             
             if (swapAmount > 0) {
                 tokenNO.approve(address(uniswapRouter), swapAmount);
                 address[] memory path = new address[](2);
                 path[0] = address(tokenNO);
                 path[1] = address(tokenSI);
                 uniswapRouter.swapExactTokensForTokens(swapAmount, 0, path, address(this), block.timestamp + 300);
             }
        } else if (rNO > rSI) {
             // Needed: More NO. Swap SI -> NO.
             // Excess SI? No, Ratio NO/SI > 1. SI is scarce?
             // target NO / SI = K > 1.
             // We have 1:1. We need more NO.
             // Swap SI -> NO.
             // x = Amount * (1 - rSI/rNO) / 2.
             
             uint256 swapAmount = (usdcAmount * (rNO - rSI)) / rNO / 2;
             
             if (swapAmount > 0) {
                 tokenSI.approve(address(uniswapRouter), swapAmount);
                 address[] memory path = new address[](2);
                 path[0] = address(tokenSI);
                 path[1] = address(tokenNO);
                 uniswapRouter.swapExactTokensForTokens(swapAmount, 0, path, address(this), block.timestamp + 300);
             }
        }
        
        // 4. Add Liquidity with whatever we have
        uint256 balSI = tokenSI.balanceOf(address(this));
        uint256 balNO = tokenNO.balanceOf(address(this));
        
        tokenSI.approve(address(uniswapRouter), balSI);
        tokenNO.approve(address(uniswapRouter), balNO);
        
        (,, liquidity) = uniswapRouter.addLiquidity(
            address(tokenSI),
            address(tokenNO),
            balSI,
            balNO,
            0,
            0,
            msg.sender,
            block.timestamp + 300
        );
        
        // Refund dust
        uint256 dustSI = tokenSI.balanceOf(address(this));
        if (dustSI > 0) tokenSI.transfer(msg.sender, dustSI);
        uint256 dustNO = tokenNO.balanceOf(address(this));
        if (dustNO > 0) tokenNO.transfer(msg.sender, dustNO);
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

    function sellNO(uint256 tokenAmount) external {
        require(tokenAmount > 0, "Amount > 0");
        require(tokenNO.transferFrom(msg.sender, address(this), tokenAmount), "Transfer failed");

        // Get Reserves
        (uint112 _reserve0, uint112 _reserve1,) = IUniswapV2Pair(pair).getReserves();
        address _token0 = IUniswapV2Pair(pair).token0();
        
        // Identify reserve order relative to our tokens
        (uint256 reserveSI, uint256 reserveNO) = (address(tokenSI) == _token0) 
            ? (_reserve0, _reserve1) 
            : (_reserve1, _reserve0);

        // We have `tokenAmount` of NO. We want `Final_SI == Final_NO`.
        // We swap NO -> SI.
        // Target: (Initial_NO - x) = GetAmountOut(NO->SI, x)
        // Same quadratic formula structure:
        // x^2 + (ResOut + ResIn - A)x - A*ResIn = 0
        // Here Input is NO (ResIn = reserveNO), Output is SI (ResOut = reserveSI).
        // A = tokenAmount.
        
        uint256 amountToSwap;
        {
            int256 R_in = int256(reserveNO);
            int256 R_out = int256(reserveSI);
            int256 T = int256(tokenAmount);
            
            int256 b = (R_out + R_in) - T;
            int256 c = -(T * R_in);
            
            uint256 D = uint256(b * b - (4 * c));
            uint256 sqrtD = Math.sqrt(D);
            
            int256 num = -b + int256(sqrtD);
            amountToSwap = uint256(num / 2);
        }
        
        if (amountToSwap > 0) {
            tokenNO.approve(address(uniswapRouter), amountToSwap);
            
            address[] memory path = new address[](2);
            path[0] = address(tokenNO);
            path[1] = address(tokenSI);
    
            uniswapRouter.swapExactTokensForTokens(
                amountToSwap,
                0, // Accept any amount for now (MVP)
                path,
                address(this),
                block.timestamp + 300
            );
        }

        uint256 balSI = tokenSI.balanceOf(address(this));
        uint256 balNO = tokenNO.balanceOf(address(this));
        uint256 burnAmount = balSI < balNO ? balSI : balNO;
        
        if (burnAmount > 0) {
            vault.burn(burnAmount);
            
            // Return USDC
            uint256 usdcBal = usdc.balanceOf(address(this));
            if (usdcBal > 0) {
                usdc.transfer(msg.sender, usdcBal);
            }
        }
    }
}
