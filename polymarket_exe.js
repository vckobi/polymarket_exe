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



function checkLiquidity(book, side, dollars, maxPrice = null) {
  // אם קונה - מסתכל על asks, אם מוכר - על bids
  let orders = side === "BUY" ? [...book.asks] : [...book.bids];

  // מיון: לקנייה - מהזול ליקר, למכירה - מהיקר לזול
  orders.sort((a, b) => {
    const priceA = parseFloat(a.price);
    const priceB = parseFloat(b.price);
    return side === "BUY" ? priceA - priceB : priceB - priceA;
  });

  let usedDollars = 0;
  let usedSize = 0;
  let availableDollars = 0;

  for (const order of orders) {
    const price = parseFloat(order.price);
    const size = parseFloat(order.size);

    // אם יש מחיר מקסימלי, דלג על הזמנות מחוץ לטווח
    if (maxPrice && side === "BUY" && price > maxPrice) continue;
    if (maxPrice && side === "SELL" && price < maxPrice) continue;

    const orderDollars = price * size;
    availableDollars += orderDollars;

    // חישוב כמה נשתמש מההזמנה הזו
    const remainingDollars = dollars - usedDollars;
    if (remainingDollars <= 0) break; // כבר הגענו לסכום המבוקש

    if (orderDollars <= remainingDollars) {
      // משתמשים בכל ההזמנה
      usedDollars += orderDollars;
      usedSize += size;
    } else {
      // משתמשים רק בחלק מההזמנה
      const neededSize = remainingDollars / price;
      usedDollars += remainingDollars;
      usedSize += neededSize;
      break;
    }
  }

  const avgPrice = usedSize > 0 ? usedDollars / usedSize : 0;

  return {
    availableDollars,
    usedDollars,
    usedSize,
    avgPrice,
    enough: availableDollars >= dollars
  };
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

  console.log("\nPlacing order..."); 
var decimalOdds = 1.22; // החלף בערך הסיכויים העשרוני הרצוי  
var dollars = 10; // החלף בסכום הדולרים הרצוי להמרה 
  var price = 1 / decimalOdds;
  price= Math.round(price * 100) / 100;
  var size =  Math.floor(dollars / price);
  var tokenID = "15165094412498917990838417528594317620016563826145254785476303394604806029992"; // החלף ב-tokenID של השוק הרצוי
  const book = await poly_client.getOrderBook(tokenID);
  
  
const check = checkLiquidity(book, "BUY", dollars, price);

console.log(`\n📊 בדיקת נזילות:`);
console.log(`   סכום מבוקש: $${dollars}`);
console.log(`   מחיר מקסימלי: ${price} (סיכוי ${decimalOdds})`);
console.log(`   נזילות זמינה בטווח: $${check.availableDollars.toFixed(2)}`);
console.log(`   סכום שישמש: $${check.usedDollars.toFixed(2)}`);
console.log(`   כמות מניות: ${check.usedSize.toFixed(2)}`);
console.log(`   מחיר ממוצע: ${check.avgPrice.toFixed(4)} (סיכוי ${(1/check.avgPrice).toFixed(3)})`);

if (check.enough) {
  console.log(`\n✓ יש מספיק נזילות לביצוע ההזמנה`);

  const orderSize = Math.floor(check.usedSize);
  const orderPrice = Math.round(price * 100) / 100;

  console.log(`\n📤 שולח הזמנה:`);
  console.log(`   tokenID: ${tokenID}`);
  console.log(`   price: ${orderPrice}`);
  console.log(`   size: ${orderSize}`);
  console.log(`   side: BUY`);

  return;
 
  const response = await poly_client.createAndPostOrder(
    {
      tokenID,
      price: orderPrice,
      side: Side.BUY,
      size: orderSize,
      orderType: "IOC"
    } 
  );


  

  /*
Order response: {
  "errorMsg": "",
  "orderID": "0xc0dc3d7b1524ffbc94b0ece9feef95b7470c7c16a56b786f86a6119e4987b426",
  "takingAmount": "12",
  "makingAmount": "9.24",
  "status": "matched",
  "transactionsHashes": [
    "0x7b8afd534024c298332aa8235237d2d13c6250299feab6968f1cc2caad7967a6"
  ],
  "success": true
}
*/

  console.log("\nOrder response:", JSON.stringify(response, null, 2));


} else {
  console.log(`\n✗ אין מספיק נזילות - חסרים $${(dollars - check.availableDollars).toFixed(2)}`);
}

 
}).catch(console.error);





setInterval(async () => { 
 
}, 1000);