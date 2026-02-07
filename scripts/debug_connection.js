require('dotenv').config();
const https = require('https');

console.log("--- Debugging Connection ---");

const mnemonic = process.env.MNEMONIC;
const projectId = process.env.INFURA_PROJECT_ID;

console.log(`1. Checking Environment Variables:`);
console.log(`   - MNEMONIC: ${mnemonic && mnemonic.length > 10 ? "Found (Looks valid)" : "MISSING or too short"}`);
console.log(`   - INFURA_PROJECT_ID: ${projectId && projectId.length > 5 ? "Found" : "MISSING"}`);

if (!projectId) {
    console.error("ERROR: INFURA_PROJECT_ID is missing. Please check your .env file.");
    process.exit(1);
}

const url = `https://sepolia.infura.io/v3/${projectId}`;
console.log(`2. Testing Infura Connection to: ${url}`);

const data = JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_blockNumber",
    params: [],
    id: 1
});

const options = {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = https.request(url, options, (res) => {
    console.log(`   - Status Code: ${res.statusCode}`);

    let responseBody = '';

    res.on('data', (chunk) => {
        responseBody += chunk;
    });

    res.on('end', () => {
        if (res.statusCode === 200) {
            console.log("   - Response: Success! Connected to Sepolia.");
            try {
                const json = JSON.parse(responseBody);
                console.log(`   - Latest Block: ${parseInt(json.result, 16)}`);
            } catch (e) {
                console.log("   - Could not parse JSON response.");
            }
        } else {
            console.error(`   - ERROR: Connection Failed. Infura returned status ${res.statusCode}.`);
            console.error(`   - Response Body: ${responseBody}`);
            if (res.statusCode === 401) {
                console.error("   -> Check your INFURA_PROJECT_ID. It might be invalid.");
            }
        }
    });
});

req.on('error', (error) => {
    console.error(`   - Network Error: ${error.message}`);
});

req.write(data);
req.end();
