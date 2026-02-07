// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./MagenVault.sol";
import "./SimpleAMM.sol";

contract MagenRouter {
    MagenVault public vault;
    SimpleAMM public amm;
    IERC20 public usdc;
    IERC20 public tokenSI;
    IERC20 public tokenNO;

    constructor(address _vault, address _amm, address _usdc, address _tokenSI, address _tokenNO) {
        vault = MagenVault(_vault);
        amm = SimpleAMM(_amm);
        usdc = IERC20(_usdc);
        tokenSI = IERC20(_tokenSI);
        tokenNO = IERC20(_tokenNO);
    }

    function initialize(uint256 amount, uint256 riskPercentage) external {
        // riskPercentage is 0-100.
        // Price SI = riskPercentage / 100.
        // Price NO = (100 - riskPercentage) / 100.
        // Ratio R_NO / R_SI = P_SI / P_NO = risk / (100 - risk).
        
        require(riskPercentage > 0 && riskPercentage < 100, "Invalid risk");

        // 1. Transfer USDC from User to Router
        require(usdc.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");
        
        // 2. Approve Vault
        usdc.approve(address(vault), amount);

        // 3. Router calls mint. Vault pulls USDC from Router. Mints SI/NO to Router.
        vault.mint(amount);

        // 4. Create Pool using MAX liquidity (Zap Style)
        // Strategy: Use as much minted SI/NO as possible to satisfy the risk ratio.
        
        uint256 liqSI;
        uint256 liqNO;
        
        // Ratio R_NO / R_SI = risk / (100 - risk)
        // If risk <= 50, then risk / (100-risk) <= 1. So NO <= SI.
        // We use all SI, and a fraction of NO.
        // Wait, check: if risk = 10. Ratio = 10/90 = 1/9. 
        // 1 SI requires 1/9 NO. 
        // We have 100 SI, 100 NO. 
        // We use 100 SI. We need 11.11 NO. We have 100 NO. OK.
        
        if (riskPercentage <= 50) {
             liqSI = amount;
             liqNO = (liqSI * riskPercentage) / (100 - riskPercentage);
        } else {
             // risk > 50. Ratio > 1. NO > SI.
             // We use all NO.
             liqNO = amount;
             liqSI = (liqNO * (100 - riskPercentage)) / riskPercentage;
        }

        tokenSI.approve(address(amm), liqSI);
        tokenNO.approve(address(amm), liqNO);
        amm.addLiquidity(liqSI, liqNO);
        
        // 5. Send LP tokens to User
        if (amm.balanceOf(address(this)) > 0) {
            amm.transfer(msg.sender, amm.balanceOf(address(this)));
        }

        // 6. Refund remaining SI/NO to User
        uint256 remSI = tokenSI.balanceOf(address(this));
        uint256 remNO = tokenNO.balanceOf(address(this));
        
        if (remSI > 0) tokenSI.transfer(msg.sender, remSI);
        if (remNO > 0) tokenNO.transfer(msg.sender, remNO);
    }

    function buySI(uint256 usdcIn) external {
        // 1. User -> USDC -> Router
        require(usdc.transferFrom(msg.sender, address(this), usdcIn), "USDC transfer failed");
        
        // 2. Router -> Vault Mint
        usdc.approve(address(vault), usdcIn);
        vault.mint(usdcIn); // Router gets SI/NO
        
        // 3. Swap NO for SI
        uint256 amountNO = tokenNO.balanceOf(address(this));
        if (amountNO > 0) {
             tokenNO.approve(address(amm), amountNO);
             // Swap NO -> SI
             amm.swap(amountNO, false); // isSIIn = false (selling NO)
        }

        // 4. Send all SI to User
        uint256 totalSI = tokenSI.balanceOf(address(this));
        tokenSI.transfer(msg.sender, totalSI);
    }
    
    function buyNO(uint256 usdcIn) external {
        // 1. User -> USDC -> Router
        require(usdc.transferFrom(msg.sender, address(this), usdcIn), "USDC transfer failed");
        
        // 2. Router -> Vault Mint
        usdc.approve(address(vault), usdcIn);
        vault.mint(usdcIn); // Router gets SI/NO
        
        // 3. Swap SI for NO
        uint256 amountSI = tokenSI.balanceOf(address(this));
        if (amountSI > 0) {
            tokenSI.approve(address(amm), amountSI);
            // Swap SI -> NO
            amm.swap(amountSI, true); // isSIIn = true (selling SI)
        }

        // 4. Send all NO to User
        uint256 totalNO = tokenNO.balanceOf(address(this));
        tokenNO.transfer(msg.sender, totalNO);
    }

    function sellSI(uint256 siIn) external {
        // 1. User -> SI -> Router
        require(tokenSI.transferFrom(msg.sender, address(this), siIn), "SI transfer failed");

        // 2. Sell part of SI for NO to match balances for burning.
        // Heuristic: swap roughly half to get the other side.
        // Optimally we'd calc exact capability, but 50% is close enough for MVP.
        uint256 sellAmount = siIn / 2;
        tokenSI.approve(address(amm), sellAmount);
        amm.swap(sellAmount, true); // isSIIn = true (selling SI)

        // 3. Burn what we have
        uint256 balSI = tokenSI.balanceOf(address(this));
        uint256 balNO = tokenNO.balanceOf(address(this));
        uint256 burnAmount = balSI < balNO ? balSI : balNO;
        
        if (burnAmount > 0) {
            vault.burn(burnAmount);
        }

        // 4. Send USDC to User + dust SI/NO
        uint256 usdcBal = usdc.balanceOf(address(this));
        if (usdcBal > 0) usdc.transfer(msg.sender, usdcBal);

        if (tokenSI.balanceOf(address(this)) > 0) tokenSI.transfer(msg.sender, tokenSI.balanceOf(address(this)));
        if (tokenNO.balanceOf(address(this)) > 0) tokenNO.transfer(msg.sender, tokenNO.balanceOf(address(this)));
    }

    function sellNO(uint256 noIn) external {
        // 1. User -> NO -> Router
        require(tokenNO.transferFrom(msg.sender, address(this), noIn), "NO transfer failed");

        // 2. Sell part of NO for SI
        uint256 sellAmount = noIn / 2;
        tokenNO.approve(address(amm), sellAmount);
        amm.swap(sellAmount, false); // isSIIn = false (selling NO)

        // 3. Burn what we have
        uint256 balSI = tokenSI.balanceOf(address(this));
        uint256 balNO = tokenNO.balanceOf(address(this));
        uint256 burnAmount = balSI < balNO ? balSI : balNO;
        
        if (burnAmount > 0) {
            vault.burn(burnAmount);
        }

        // 4. Send USDC to User + dust SI/NO
        uint256 usdcBal = usdc.balanceOf(address(this));
        if (usdcBal > 0) usdc.transfer(msg.sender, usdcBal);

        if (tokenSI.balanceOf(address(this)) > 0) tokenSI.transfer(msg.sender, tokenSI.balanceOf(address(this)));
        if (tokenNO.balanceOf(address(this)) > 0) tokenNO.transfer(msg.sender, tokenNO.balanceOf(address(this)));
    }
    function addLiquidityZap(uint256 usdcAmount) external {
        // 1. User -> USDC -> Router
        require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "USDC transfer failed");

        // 2. Mint SI + NO
        usdc.approve(address(vault), usdcAmount);
        vault.mint(usdcAmount); 

        // Current Balances
        uint256 balSI = tokenSI.balanceOf(address(this));
        uint256 balNO = tokenNO.balanceOf(address(this));

        uint256 rSI = tokenSI.balanceOf(address(amm));
        uint256 rNO = tokenNO.balanceOf(address(amm));

        uint256 amtSI = balSI;
        uint256 amtNO = balNO;

        if (rSI > 0 && rNO > 0) {
            // Check Optimal NO amount for the available SI
            uint256 optimalNO = (amtSI * rNO) / rSI;
            if (optimalNO <= amtNO) {
                // We have enough NO, so use all SI and optimal NO
                amtNO = optimalNO;
            } else {
                // We don't have enough NO, implies we have "too much" SI for the ratio? 
                // Wait. if optimalNO > amtNO, it means we need MORE NO than we have to match the SI.
                // So SI is the abundance. We should limit SI.
                uint256 optimalSI = (amtNO * rSI) / rNO;
                amtSI = optimalSI;
            }
        }

        // 3. Add Liquidity
        tokenSI.approve(address(amm), amtSI);
        tokenNO.approve(address(amm), amtNO);
        amm.addLiquidity(amtSI, amtNO);

        // 4. Send LP tokens to User
        uint256 lpBal = amm.balanceOf(address(this));
        if (lpBal > 0) {
            amm.transfer(msg.sender, lpBal);
        }

        // 5. Refund Dust/Difference
        if (tokenSI.balanceOf(address(this)) > 0) tokenSI.transfer(msg.sender, tokenSI.balanceOf(address(this)));
        if (tokenNO.balanceOf(address(this)) > 0) tokenNO.transfer(msg.sender, tokenNO.balanceOf(address(this)));
    }
}
