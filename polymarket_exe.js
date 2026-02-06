const { ClobClient, Side, OrderType } = require("@polymarket/clob-client");
const { Wallet } = require("ethers");

const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

const privateKey =  process.env.privateKey || ""; //https://reveal.magic.link/polymarket
const funder = process.env.funder || "";  //localStorage.getItem('polymarket.auth.proxyWallet')

var poly_client={};
async function poly_init() {
  const signer = new Wallet(privateKey); 

  // אם יש לך API creds מהדפדפן, שים אותם כאן:
  const creds = {
    key: process.env.POLY_API_KEY || "",
    secret: process.env.POLY_SECRET || "",
    passphrase: process.env.POLY_PASSPHRASE || ""
  };

  // אם אין creds מהדפדפן, צור חדשים:
  let finalCreds = creds;
  if (!creds.key) {
    const tempClient = new ClobClient(HOST, CHAIN_ID, signer);
    finalCreds = await tempClient.createOrDeriveApiKey();
    console.log("Created new creds:", JSON.stringify(finalCreds, null, 2));
  }

  poly_client = new ClobClient(
    HOST,
    CHAIN_ID,
    signer,
    finalCreds,
    1,      // signatureType: 1 = POLY_GNOSIS_SAFE
    funder  // כתובת ה-Proxy שבה יש את ה-USDC
  );

}


poly_init().then(async () => {

  console.log("Polymarket client initialized.");

  // בדיקת API key
  try {
    const apiKeys = await poly_client.getApiKeys();
    console.log("API Keys:", JSON.stringify(apiKeys, null, 2));
  } catch (e) {
    console.log("Error getting API keys:", e.message);
  }

  // בדיקת יתרה
  try {
    const balance = await poly_client.getBalanceAllowance({ asset_type: "USDC" });
    console.log("Balance:", JSON.stringify(balance, null, 2));
  } catch (e) {
    console.log("Error getting balance:", e.message);
  }

  
  
}).catch(console.error);





setInterval(async () => { 
 
}, 1000);