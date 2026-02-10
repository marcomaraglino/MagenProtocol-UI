const statusDiv = document.getElementById('status');
let web3;
let accounts;
let poolFactory;
let mockUSDC, magenRouter, magenVault, outcomeSI, outcomeNO, uniswapPair;
let contracts = {};

// Chart Instance
let priceChart;

// Current Mode: 'coverage' | 'underwrite' | 'liquidity'
let currentMode = 'coverage';
let currentLiqMode = 'mint'; // 'mint' | 'add' | 'remove'

// ==========================================
// View System
// ==========================================

function showView(viewId) {
    document.getElementById('viewMarkets').style.display = 'none';
    document.getElementById('viewCreate').style.display = 'none';
    document.getElementById('viewDashboard').style.display = 'none';

    document.getElementById(viewId).style.display = 'block';

    if (viewId === 'viewMarkets') {
        loadMarkets();
    }
}

// ==========================================
// Initialization
// ==========================================

async function loadArtifact(name, address = null) {
    try {
        const response = await fetch(`../build/contracts/${name}.json?v=${Date.now()}`);
        if (!response.ok) throw new Error(`Failed to load ${name}`);
        const data = await response.json();

        if (address) {
            return new web3.eth.Contract(data.abi, address);
        }

        const netId = await web3.eth.net.getId();
        let deployedNetwork = data.networks[netId];

        if (!deployedNetwork) {
            alert(`Contract not found on network ID: ${netId}. Please switch MetaMask to Sepolia (11155111) or your local Ganache.`);
            statusDiv.innerText = `Incorrect Network (ID: ${netId})`;
            return null;
        }
        return new web3.eth.Contract(data.abi, deployedNetwork.address);
    } catch (e) {
        console.warn(`Could not load artifact: ${name}`, e);
        return null;
    }
}

async function init() {
    if (window.ethereum) {
        web3 = new Web3(window.ethereum);
        try {
            accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });

            // Connect Button Update
            const btn = document.getElementById('connectWalletBtn');
            if (btn) {
                btn.innerText = accounts[0].substring(0, 6) + '...' + accounts[0].substring(38);
                btn.classList.add('connected');
            }

            statusDiv.innerText = "Connected";

            // Load USDC & Factory
            mockUSDC = await loadArtifact("MockUSDC");
            poolFactory = await loadArtifact("PoolFactory");

            if (!poolFactory) {
                statusDiv.innerText = "Factory not found. Check network.";
                return;
            }

            // Initial view
            showView('viewMarkets');

            // Listeners
            window.ethereum.on('accountsChanged', function (newAccounts) {
                accounts = newAccounts;
                window.location.reload();
            });

            // Slider Listeners
            const riskSlider = document.getElementById('newPoolRisk');
            const riskDisplay = document.getElementById('newPoolRiskDisplay');
            if (riskSlider && riskDisplay) {
                riskSlider.addEventListener('input', (e) => {
                    riskDisplay.innerText = `${e.target.value}%`;
                });
            }

            const initRiskSlider = document.getElementById('initRisk');
            const initRiskDisplay = document.getElementById('initRiskDisplay');
            if (initRiskSlider && initRiskDisplay) {
                initRiskSlider.addEventListener('input', (e) => {
                    initRiskDisplay.innerText = `${e.target.value}%`;
                });
            }

        } catch (error) {
            console.error(error);
            statusDiv.innerText = "Connection Failed";
        }
    } else {
        statusDiv.innerText = "Please install MetaMask!";
    }
}

// ==========================================
// Factory & Pools
// ==========================================

async function loadMarkets() {
    if (!poolFactory) return;
    const list = document.getElementById('marketsList');
    list.innerHTML = 'Loading...';

    try {
        const count = await poolFactory.methods.getPoolsLength().call();
        list.innerHTML = '';

        if (count == 0) {
            list.innerHTML = '<div class="glass-card" style="text-align:center;">No pools found. Create one!</div>';
            return;
        }

        for (let i = 0; i < count; i++) {
            const pool = await poolFactory.methods.getPool(i).call();
            // pool is struct { name, router, vault, ... }

            const card = document.createElement('div');
            card.className = 'glass-card';
            card.style.display = 'flex';
            card.style.justifyContent = 'space-between';
            card.style.alignItems = 'center';
            card.style.marginBottom = '20px'; // Add spacing

            card.innerHTML = `
                <div>
                    <h3 style="margin: 0 0 5px 0;">${pool.name}</h3>
                    <p style="color: var(--text-muted); font-size: 0.9em; margin: 0;">Status: Active</p>
                </div>
                <button class="action-btn btn-primary" style="width: auto; padding: 8px 16px;" 
                    onclick="openPool('${pool.router}', '${pool.vault}', '${pool.pair}', '${pool.name}')">
                    View Pool
                </button>
            `;
            list.appendChild(card);
        }
    } catch (e) {
        console.error("Error loading markets:", e);
        list.innerHTML = `<div class="glass-card" style="color: var(--danger); text-align: center;">
            Error loading markets: <br> ${e.message}
        </div>`;
    }
}

async function createPool() {
    const name = document.getElementById('newPoolName').value;
    const symSI = document.getElementById('newPoolSymbolSI').value;
    const symNO = document.getElementById('newPoolSymbolNO').value;
    const risk = document.getElementById('newPoolRisk').value;
    const liquidity = document.getElementById('newPoolLiquidity').value;

    const status = document.getElementById('createStatus');

    if (!name || !symSI || !symNO || !risk || !liquidity) {
        status.innerText = "Please fill all fields";
        return;
    }

    try {
        const weiLiquidity = web3.utils.toWei(liquidity, 'ether');
        const riskBN = web3.utils.toBN(risk);

        // 1. Create Pool
        status.innerText = "1/3 Deploying Pool Contracts... (Please Confirm)";
        const receipt = await poolFactory.methods.createPool(name, symSI, symNO).send({ from: accounts[0] });

        // Find new pool address from events
        let event = receipt.events.PoolCreated;
        if (Array.isArray(event)) {
            event = event[event.length - 1]; // Take the last one if multiple
        }

        const routerAddr = event.returnValues.router;

        status.innerText = `Pool Deployed at ${routerAddr.substring(0, 6)}...`;

        // 2. Approve USDC
        status.innerText = "2/3 Approving USDC... (Please Confirm)";
        await mockUSDC.methods.approve(routerAddr, weiLiquidity).send({ from: accounts[0] });

        // 3. Initialize
        status.innerText = "3/3 Initializing Pool... (Please Confirm)";
        const newRouter = await loadArtifact("MagenRouter", routerAddr);
        // Add listeners for debugging
        await newRouter.methods.initialize(weiLiquidity, riskBN).send({ from: accounts[0] })
            .on('transactionHash', Hash => console.log("Init Hash:", Hash));

        status.innerText = "Success! Pool Ready.";
        alert("Pool Created and Initialized Successfully!");

        // Clear inputs
        document.getElementById('newPoolName').value = '';
        document.getElementById('newPoolLiquidity').value = '';

        showView('viewMarkets');
    } catch (e) {
        console.error("Create Pool Failed:", e);
        status.innerText = "Failed: " + (e.message || e);
    }
}

async function openPool(routerAddr, vaultAddr, pairAddr, name) {
    document.getElementById('poolTitle').innerText = name;

    // Load Contracts for specific pool
    // Load Contracts for specific pool
    magenRouter = await loadArtifact("MagenRouter", routerAddr);
    magenVault = await loadArtifact("MagenVault", vaultAddr);
    uniswapPair = await loadArtifact("IUniswapV2Pair", pairAddr);

    // Load Tokens
    if (magenVault) {
        try {
            const siAddr = await magenVault.methods.tokenSI().call();
            const noAddr = await magenVault.methods.tokenNO().call();
            const siArt = await fetch(`../build/contracts/OutcomeToken.json`).then(r => r.json());
            outcomeSI = new web3.eth.Contract(siArt.abi, siAddr);
            outcomeNO = new web3.eth.Contract(siArt.abi, noAddr);
        } catch (e) { console.error("Error loading tokens", e); }
    }

    showView('viewDashboard');
    initChart();
    updateStats();
    // Default to coverage
    switchTab('coverage');
}

// ==========================================
// UI Logic: Tabs & Chart
// ==========================================

function switchTab(mode) {
    console.log("Switching tab to:", mode);
    currentMode = mode;

    // Update Buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.tab-btn[onclick="switchTab('${mode}')"]`).classList.add('active');

    // Toggle UI Sections
    if (mode === 'liquidity') {
        document.getElementById('tradeUI').style.display = 'none';
        document.getElementById('liquidityUI').style.display = 'block';
        setLiqMode('add'); // Default
    } else {
        document.getElementById('tradeUI').style.display = 'block';
        document.getElementById('liquidityUI').style.display = 'none';

        // Setup Trade Inputs
        const mainBtn = document.getElementById('actionBtnMain');
        const secBtn = document.getElementById('actionBtnSec');
        const inputVal = document.getElementById('inputAmount');
        inputVal.value = '';
        document.getElementById('estTokens').innerText = '0';

        if (mode === 'coverage') {
            mainBtn.innerText = "Buy Coverage";
            secBtn.innerText = "Sell Coverage";
            inputVal.placeholder = "USDC Amount (Buy) / SI Amount (Sell)";
            document.querySelector('#tradeDesc').innerText = "Trade Coverage Tokens (CT) to manage your exposure.";
        } else {
            mainBtn.innerText = "Buy Yield (NO)";
            secBtn.innerText = "Sell Yield";
            inputVal.placeholder = "USDC Amount (Buy) / NO Amount (Sell)";
            document.querySelector('#tradeDesc').innerText = "Buy No Tokens (NO) to earn yield from premiums.";
        }
    }
    updateStats();
}

function setLiqMode(mode) {
    currentLiqMode = mode;
    // Update Buttons
    document.querySelectorAll('.link-btn').forEach(btn => btn.classList.remove('active'));
    if (mode === 'add') document.getElementById('btnLiqAdd').classList.add('active');
    if (mode === 'remove') document.getElementById('btnLiqRemove').classList.add('active');

    // Show Sections
    document.getElementById('liqAdd').style.display = 'none';
    document.getElementById('liqRemove').style.display = 'none';

    if (mode === 'add') document.getElementById('liqAdd').style.display = 'block';
    if (mode === 'remove') document.getElementById('liqRemove').style.display = 'block';

    // Add Zap Out Mode visibility if we add a 3rd tab, or just put button in remove?
    // User asked for "button where I can swap my lptoken (the liquidity token to my usdc)"
    // Let's add it to the 'remove' section as an alternative action.
}

function initChart() {
    if (priceChart) priceChart.destroy();
    const ctx = document.getElementById('priceChart').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(56, 189, 248, 0.5)');
    gradient.addColorStop(1, 'rgba(56, 189, 248, 0)');

    const data = {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
        datasets: [{
            label: 'Coverage Price (SI)',
            data: [0.05, 0.08, 0.04, 0.12, 0.09, 0.15], // Dummy Data
            borderColor: '#38bdf8',
            backgroundColor: gradient,
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointRadius: 0
        }]
    };

    priceChart = new Chart(ctx, {
        type: 'line',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
            }
        }
    });
}

// ==========================================
// Interaction Logic
// ==========================================

async function handleMainAction() {
    if (!accounts) {
        statusDiv.innerText = "Please Connect Wallet First";
        return;
    }

    const amt = document.getElementById('inputAmount').value;
    if (!amt || parseFloat(amt) <= 0) {
        statusDiv.innerText = "Please enter a valid amount";
        return;
    }

    const weiAmt = web3.utils.toWei(amt, 'ether');
    statusDiv.innerText = "Processing...";

    try {
        // Buy SI or Buy NO
        await mockUSDC.methods.approve(magenRouter.options.address, weiAmt).send({ from: accounts[0] });

        if (currentMode === 'coverage') {
            statusDiv.innerText = "Buying Coverage (SI)...";
            await magenRouter.methods.buySI(weiAmt).send({ from: accounts[0] });
            statusDiv.innerText = "Coverage Purchased!";
        } else if (currentMode === 'underwrite') {
            statusDiv.innerText = "Underwriting (Buying NO)...";
            await magenRouter.methods.buyNO(weiAmt).send({ from: accounts[0] });
            statusDiv.innerText = "Underwritten Successful!";
        }
        updateStats();
    } catch (e) {
        console.error(e);
        statusDiv.innerText = "Transaction Failed: " + (e.message || e);
    }
}

async function handleSecondaryAction() {
    if (!accounts) {
        statusDiv.innerText = "Please Connect Wallet First";
        return;
    }
    const amt = document.getElementById('inputAmount').value;
    if (!amt || parseFloat(amt) <= 0) {
        statusDiv.innerText = "Please enter a valid amount";
        return;
    }

    statusDiv.innerText = "Selling...";
    const weiAmt = web3.utils.toWei(amt, 'ether');

    try {
        if (currentMode === 'coverage') {
            // Sell SI
            statusDiv.innerText = "Approving SI...";
            await outcomeSI.methods.approve(magenRouter.options.address, weiAmt).send({ from: accounts[0] });
            statusDiv.innerText = "Selling SI...";
            await magenRouter.methods.sellSI(weiAmt).send({ from: accounts[0] });
            statusDiv.innerText = "Sold SI for USDC!";
        } else if (currentMode === 'underwrite') {
            // Sell NO
            statusDiv.innerText = "Approving NO...";
            await outcomeNO.methods.approve(magenRouter.options.address, weiAmt).send({ from: accounts[0] });
            statusDiv.innerText = "Selling NO...";
            await magenRouter.methods.sellNO(weiAmt).send({ from: accounts[0] });
            statusDiv.innerText = "Sold NO for USDC!";
        }
        updateStats();
    } catch (e) {
        console.error(e);
        statusDiv.innerText = "Sell Failed: " + (e.message || e);
    }
}

// --- LIQUIDITY HANDLERS ---

async function handleLiqAddZap() {
    const amt = document.getElementById('addLiquidityUSDC').value;
    if (!amt) return;
    statusDiv.innerText = "Adding Liquidity...";
    try {
        const wei = web3.utils.toWei(amt, 'ether');
        // 1. Approve USDC to Router
        statusDiv.innerText = "Approving USDC...";
        await mockUSDC.methods.approve(magenRouter.options.address, wei).send({ from: accounts[0] });

        // 2. Add Liquidity (Smart)
        statusDiv.innerText = "Adding Liquidity...";
        await magenRouter.methods.addLiquidity(wei).send({ from: accounts[0] });

        statusDiv.innerText = "Liquidity Added!";
        updateStats();
    } catch (e) { statusDiv.innerText = "Add Liq Failed: " + e.message; }
}


async function handleLiqRemove() {
    const lp = document.getElementById('removeLP').value;
    if (!lp) return;

    statusDiv.innerText = "Removing Liquidity...";
    try {
        const weiLP = web3.utils.toWei(lp, 'ether');

        // Check Balance
        const bal = await uniswapPair.methods.balanceOf(accounts[0]).call();
        if (web3.utils.toBN(bal).lt(web3.utils.toBN(weiLP))) {
            throw new Error("Insufficient LP Balance");
        }

        // Get Uniswap Router Address
        const routerAddr = await magenRouter.methods.uniswapRouter().call();
        const uniRouter = await loadArtifact("IUniswapV2Router02", routerAddr);

        // Approve Router to spend LP
        statusDiv.innerText = "Approving LP...";
        await uniswapPair.methods.approve(routerAddr, weiLP).send({ from: accounts[0] });

        statusDiv.innerText = "Removing Liquidity (Uniswap)...";

        // Remove Liquidity
        // min amounts 0 for MVP
        const deadline = Math.floor(Date.now() / 1000) + 300;
        await uniRouter.methods.removeLiquidity(
            outcomeSI.options.address,
            outcomeNO.options.address,
            weiLP,
            0,
            0,
            accounts[0],
            deadline
        ).send({ from: accounts[0] });

        statusDiv.innerText = "Liquidity Removed! (Received SI + NO)";
        updateStats();
    } catch (e) { statusDiv.innerText = "Remove LP Failed: " + e.message; }
}



async function setMaxLP() {
    if (!uniswapPair) return;
    const bal = await uniswapPair.methods.balanceOf(accounts[0]).call();
    const balFmt = web3.utils.fromWei(bal, 'ether');
    document.getElementById('removeLP').value = balFmt;
}

// ---------------------------

async function updateStats() {
    if (!uniswapPair || !web3) return;

    try {
        // Get Reserves from Uniswap Pair
        const reserves = await uniswapPair.methods.getReserves().call();
        const token0 = await uniswapPair.methods.token0().call();
        const tokenSIAddr = outcomeSI.options.address;

        // Identify which reserve is SI
        const isToken0SI = (token0.toLowerCase() === tokenSIAddr.toLowerCase());
        const rawResSI = isToken0SI ? reserves[0] : reserves[1];
        const rawResNO = isToken0SI ? reserves[1] : reserves[0];

        const rSI = parseFloat(web3.utils.fromWei(rawResSI, 'ether'));
        const rNO = parseFloat(web3.utils.fromWei(rawResNO, 'ether'));

        // TOTAL LIQUIDITY (USDC in Vault) - still valid metric for Magen Protocol
        const vaultUSDC = await mockUSDC.methods.balanceOf(magenVault.options.address).call();
        const tvlUSDC = parseFloat(web3.utils.fromWei(vaultUSDC, 'ether'));

        const elTVL = document.getElementById('statTVL');
        if (elTVL) elTVL.innerText = `$${tvlUSDC.toFixed(2)}`;

        const elComp = document.getElementById('poolComp');
        if (elComp) elComp.innerText = `${rSI.toFixed(2)} SI / ${rNO.toFixed(2)} NO`;

        // Balances
        if (accounts) {
            const lpBal = await uniswapPair.methods.balanceOf(accounts[0]).call();
            const lpBalFmt = parseFloat(web3.utils.fromWei(lpBal, 'ether')).toFixed(2);
            if (document.getElementById('displayLPBal')) document.getElementById('displayLPBal').innerText = lpBalFmt;

            const usdcBal = await mockUSDC.methods.balanceOf(accounts[0]).call();
            const usdcBalFmt = parseFloat(web3.utils.fromWei(usdcBal, 'ether')).toFixed(2);

            const siBal = await outcomeSI.methods.balanceOf(accounts[0]).call();
            const siBalFmt = parseFloat(web3.utils.fromWei(siBal, 'ether')).toFixed(2);

            const noBal = await outcomeNO.methods.balanceOf(accounts[0]).call();
            const noBalFmt = parseFloat(web3.utils.fromWei(noBal, 'ether')).toFixed(2);

            // Display Token Info
            const infoEl = document.getElementById('tokenInfoContent');
            if (infoEl) {
                const shortAddr = (addr) => addr ? `${addr.substring(0, 6)}...${addr.substring(38)}` : 'N/A';

                infoEl.innerHTML = `
                    <div style="margin-bottom: 8px;">
                        <strong>USDC:</strong> ${shortAddr(mockUSDC.options.address)} <br>
                        <span style="color: var(--primary);">Bal: ${usdcBalFmt}</span>
                    </div>
                    <div style="margin-bottom: 8px;">
                        <strong>SI Token (Yes):</strong> ${shortAddr(outcomeSI.options.address)} <br>
                        <span style="color: var(--primary);">Bal: ${siBalFmt}</span>
                    </div>
                    <div style="margin-bottom: 8px;">
                         <strong>NO Token (Yield):</strong> ${shortAddr(outcomeNO.options.address)} <br>
                         <span style="color: var(--primary);">Bal: ${noBalFmt}</span>
                    </div>
                    <div style="margin-bottom: 8px;">
                         <strong>LP Token (Uni V2):</strong> ${shortAddr(uniswapPair.options.address)} <br>
                         <span style="color: var(--primary);">Bal: ${lpBalFmt}</span>
                    </div>
                `;
            }
        }

        // Trade Estimations (Coverage/Underwrite only)
        if (currentMode !== 'liquidity') {
            const inputVal = parseFloat(document.getElementById('inputAmount').value) || 0;
            const estEl = document.getElementById('estTokens');
            const premEl = document.getElementById('currentPremium');

            if (rSI > 0 && rNO > 0) {
                const probSI = rNO / (rSI + rNO);
                const probNO = rSI / (rSI + rNO);
                const impliedYield = ((1 - probNO) / probNO) * 100;

                if (currentMode === 'coverage') {
                    const est = inputVal / probSI;
                    estEl.innerText = `${est.toFixed(2)} CT`;
                    premEl.innerText = `${(probSI * 100).toFixed(2)}%`;
                } else if (currentMode === 'underwrite') {
                    const est = inputVal / probNO;
                    estEl.innerText = `${est.toFixed(2)} NO`;
                    premEl.innerText = `${impliedYield.toFixed(2)}% APY`;
                }
            } else {
                premEl.innerText = "Pool Empty";
                estEl.innerText = "0";
            }
        }

    } catch (e) {
        console.error("Stats update error", e);
    }
}

async function initPool() {
    const amt = document.getElementById('initAmount').value;
    const risk = document.getElementById('initRisk').value;
    if (!amt || !risk) return;

    const weiAmt = web3.utils.toWei(amt, 'ether');
    const riskBN = web3.utils.toBN(risk);

    statusDiv.innerText = "Approving USDC for Init...";
    try {
        await mockUSDC.methods.approve(magenRouter.options.address, weiAmt).send({ from: accounts[0] });
        statusDiv.innerText = `Initializing Pool with ${risk}% Risk...`;
        await magenRouter.methods.initialize(weiAmt, riskBN).send({ from: accounts[0] });
        statusDiv.innerText = "Pool Initialized!";
        updateStats();
    } catch (e) {
        statusDiv.innerText = "Init failed: " + e.message;
    }
}

async function resolveMarket() {
    const scale = document.getElementById('resolveScale').value;
    if (!scale) return;
    const scaleBN = web3.utils.toBN(scale).mul(web3.utils.toBN(10).pow(web3.utils.toBN(16)));
    try {
        await magenVault.methods.resolve(scaleBN).send({ from: accounts[0] });
        statusDiv.innerText = "Market Resolved!";
    } catch (e) { statusDiv.innerText = "Error: " + e.message; }
}

async function claimSI() {
    try {
        const bal = await outcomeSI.methods.balanceOf(accounts[0]).call();
        if (bal > 0) await magenVault.methods.claim(bal, true).send({ from: accounts[0] });
        statusDiv.innerText = "Claimed All SI";
    } catch (e) { statusDiv.innerText = "Error: " + e.message; }
}

async function claimNO() {
    try {
        const bal = await outcomeNO.methods.balanceOf(accounts[0]).call();
        if (bal > 0) await magenVault.methods.claim(bal, false).send({ from: accounts[0] });
        statusDiv.innerText = "Claimed All NO";
    } catch (e) { statusDiv.innerText = "Error: " + e.message; }
}

async function faucetUSDC() {
    if (!mockUSDC || !accounts) return;
    try {
        const amt = web3.utils.toWei('1000', 'ether');
        statusDiv.innerText = "Requesting Faucet...";
        await mockUSDC.methods.mint(accounts[0], amt).send({ from: accounts[0] });
        statusDiv.innerText = "Faucet Success! +1,000 USDC";
        updateStats(); // Refresh balances
    } catch (e) {
        console.error(e);
        statusDiv.innerText = "Faucet Failed: " + e.message;
    }
}

window.init = init;
